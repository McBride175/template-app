import 'server-only'

import { authenticateDisputeTenant, loadInvoiceDisputesForSnapshot } from '@/lib/collections/invoice-disputes-server'
import { applyXeroAuthoritativeSnapshot } from '@/lib/xero/authoritative-snapshot'
import { deriveInvoiceDispute, type DisputeAccountingInvoice } from '@/lib/collections/invoice-disputes'
import { evaluateCollectionsCurrencyHealth, type CollectionsInvoiceCurrencyRow } from '@/lib/collections/currency-health'
import { disputeInvoiceOverdueDays, selectDisputeWorklistRows,
  type DisputeWorklistQuery, type DisputeWorklistResponse, type DisputeWorklistRow } from '@/lib/collections/dispute-worklist'

interface Invoice extends DisputeAccountingInvoice, CollectionsInvoiceCurrencyRow {
  invoice_number: string | null
  reference: string | null
  issue_date: string | null
  due_date: string | null
}
interface Customer { source_id: string; name: string }
type Context = Awaited<ReturnType<typeof authenticateDisputeTenant>>
const INVOICE_COLUMNS = 'user_id, tenant_id, source_system, source_id, customer_source_id, invoice_number, reference, issue_date, due_date, type, status, amount_due_native, amount_due_base, transaction_currency_code, organisation_base_currency_code, xero_currency_rate, currency_conversion_status, currency_conversion_failure_reason'

/** Bounded identity batches and database pages, never one lookup per dispute. */
async function loadIdentityRows<T>(context: Context, table: 'canonical_invoices' | 'canonical_customers',
  ids: string[], columns: string, current: boolean): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; offset < ids.length; offset += 200) {
    for (let from = 0; ; from += 1000) {
      let query = context.admin.from(table).select(columns)
        .eq('user_id', context.userId).eq('tenant_id', context.tenantId)
        .eq('source_system', 'xero').in('source_id', ids.slice(offset, offset + 200))
      if (current) query = applyXeroAuthoritativeSnapshot(query, context.snapshot)
      // Historical rows supply ONLY last-known labels, never current accounting truth.
      const { data, error } = await query.order('updated_at', { ascending: false })
        .order('id', { ascending: true }).range(from, from + 999)
      if (error) throw error
      const batch = (data ?? []) as T[]
      rows.push(...batch)
      if (batch.length < 1000) break
    }
  }
  return rows
}

function firstByIdentity<T extends { source_id: string }>(rows: T[]) {
  const result = new Map<string, T>()
  for (const row of rows) if (!result.has(row.source_id)) result.set(row.source_id, row)
  return result
}

export async function loadDisputeWorklist(params: {
  tenantId: string | null
  query: DisputeWorklistQuery
}): Promise<DisputeWorklistResponse> {
  const context = await authenticateDisputeTenant(params.tenantId)
  const disputes = (await loadInvoiceDisputesForSnapshot(context))
    .filter((row) => row.source_system === 'xero')
  const ids = disputes.map((row) => row.invoice_source_id)
  const [invoices, organisationResult] = await Promise.all([
    loadIdentityRows<Invoice>(context, 'canonical_invoices', ids, INVOICE_COLUMNS, true),
    applyXeroAuthoritativeSnapshot(context.admin.from('canonical_organisations')
      .select('base_currency_code').eq('user_id', context.userId)
      .eq('tenant_id', context.tenantId), context.snapshot),
  ])
  if (organisationResult.error) throw organisationResult.error
  const currentById = firstByIdentity(invoices)
  const missingIds = ids.filter((id) => !currentById.has(id))
  const previousById = firstByIdentity(await loadIdentityRows<Invoice>(context,
    'canonical_invoices', missingIds, INVOICE_COLUMNS, false))
  const customerIds = [...new Set([...invoices, ...previousById.values()]
    .map((row) => row.customer_source_id).filter((id): id is string => Boolean(id)))]
  const customerById = firstByIdentity(await loadIdentityRows<Customer>(context,
    'canonical_customers', customerIds, 'source_id, name', true))
  const absentCustomerIds = customerIds.filter((id) => !customerById.has(id))
  const previousCustomers = firstByIdentity(await loadIdentityRows<Customer>(context,
    'canonical_customers', absentCustomerIds, 'source_id, name', false))
  const valuation = evaluateCollectionsCurrencyHealth({
    organisations: organisationResult.data ?? [], invoices,
  })
  const invalidValuations = new Set(valuation.currencyIssues.map((issue) => issue.invoiceSourceId))
  const today = new Date().toISOString().slice(0, 10)
  const rows: DisputeWorklistRow[] = disputes.map((dispute) => {
    const invoice = currentById.get(dispute.invoice_source_id) ?? null
    const lastKnown = invoice ?? previousById.get(dispute.invoice_source_id) ?? null
    const debt = deriveInvoiceDispute(invoice, dispute)
    const customerId = lastKnown?.customer_source_id ?? null
    const customer = customerId ? customerById.get(customerId) ?? previousCustomers.get(customerId) : null
    const baseValid = invoice !== null &&
      (debt.invoiceState === 'open' || debt.currentAmountDueNative === '0') &&
      valuation.currencyHealth.status !== 'unavailable' &&
      !invalidValuations.has(invoice.source_id)
    return {
      disputeId: dispute.id, revision: String(dispute.revision), sourceSystem: dispute.source_system,
      invoiceSourceId: dispute.invoice_source_id,
      invoiceNumber: lastKnown?.invoice_number ?? null, reference: lastKnown?.reference ?? null,
      issueDate: lastKnown?.issue_date ?? null, dueDate: lastKnown?.due_date ?? null,
      currencyCode: lastKnown?.transaction_currency_code ?? null,
      customerSourceId: customerId, customerName: customer?.name ?? customerId,
      contextFromPreviousSnapshot: (!invoice && Boolean(lastKnown)) ||
        Boolean(customerId && !customerById.has(customerId) && previousCustomers.has(customerId)),
      overdueDays: invoice ? disputeInvoiceOverdueDays(invoice.due_date, today) : null,
      createdAt: dispute.created_at, resolvedAt: dispute.resolved_at, note: dispute.note,
      invoiceState: debt.invoiceState, disputeMode: debt.disputeMode,
      isActive: debt.isActive, isResolved: debt.isResolved,
      isOperationallySettled: debt.isOperationallySettled, needsReview: debt.needsReview,
      currentAmountDueNative: debt.currentAmountDueNative,
      recordedDisputedAmountNative: debt.recordedDisputedAmountNative,
      effectiveDisputedAmountNative: invoice ? debt.effectiveDisputedAmountNative : null,
      collectibleAmountNative: invoice ? debt.collectibleAmountNative : null,
      grossOutstandingBase: baseValid ? debt.grossOpenAmountBase : null,
      effectiveDisputedBase: baseValid ? debt.effectiveDisputedAmountBase : null,
      collectibleBase: baseValid ? debt.collectibleAmountBase : null,
      customerHref: customerId && (invoice || customerById.has(customerId))
        ? `/customers?tenantId=${encodeURIComponent(context.tenantId)}&customerSourceId=${encodeURIComponent(customerId)}` : null,
    }
  })
  const customers = customerIds.map((sourceId) => ({ sourceId,
    name: customerById.get(sourceId)?.name ?? previousCustomers.get(sourceId)?.name ?? sourceId,
  })).sort((a, b) => a.name.localeCompare(b.name) || a.sourceId.localeCompare(b.sourceId))
  return { ok: true, tenantId: context.tenantId,
    organisationBaseCurrency: valuation.organisationBaseCurrency, customers,
    ...selectDisputeWorklistRows(rows, params.query) }
}
