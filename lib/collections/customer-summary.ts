import 'server-only'

import { createServerSupabaseClient } from '@/lib/supabase-server'
import {
  calculateCustomerFinancialFeatures,
  type CustomerFinancialFeaturesResult,
  type CollectionOrganisationInput as CanonicalOrganisationRow,
  type CollectionCustomerInput as CanonicalCustomerRow,
  type CollectionInvoiceInput as CanonicalInvoiceRow,
  type CollectionPaymentInput as CanonicalPaymentRow,
} from '@/lib/collections/customer-features'
import {
  CUSTOMER_CREDIT_CONTRACT_VERSION,
  INVOICE_EXACT_MONEY_CONTRACT_VERSION,
  type CustomerCreditCertificate,
  type CustomerCreditEvidenceRow,
} from '@/lib/collections/customer-credit-actionability'
import { loadActiveInvoicePromises, assertInvoicePromiseSnapshotCurrent } from '@/lib/collections/invoice-promises-loading'
import { loadInvoiceDisputesForSnapshot } from '@/lib/collections/invoice-disputes-server'
import {
  applyXeroAuthoritativeSnapshot,
  assertXeroSnapshotIdentity,
  resolveXeroAuthoritativeSnapshot,
  toXeroSnapshotReference,
  type XeroAuthoritativeSnapshot,
  type XeroSnapshotReference,
} from '@/lib/xero/authoritative-snapshot'

// Compatibility exports keep all existing server/UI consumers on the same contract.
export type {
  CustomerFinancialFeatures as CustomerCollectionsSummaryRow,
  NativeCurrencyBreakdown,
  CollectibleNativeCurrencyBreakdown,
  CurrencyReviewRequiredCustomer,
} from '@/lib/collections/customer-features'
export type CustomerCollectionsSummaryResult = CustomerFinancialFeaturesResult & { snapshot: XeroSnapshotReference }

type ServerSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>
const PAGE_SIZE = 1000
const IDENTITY_BATCH_SIZE = 100

function getTodayContext() {
  const now = new Date()
  const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const todayIso = new Date(todayUtcMs).toISOString().slice(0, 10)
  return { todayIso, todayUtcMs }
}

async function fetchCanonicalCustomers(
  supabase: ServerSupabaseClient,
  snapshot: XeroAuthoritativeSnapshot,
  customerSourceId?: string
) {
  const rows: CanonicalCustomerRow[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('canonical_customers')
      .select('source_id, name, email, is_customer, is_supplier, status')
      .eq('user_id', snapshot.userId)
      .eq('tenant_id', snapshot.tenantId)
      .eq('source_system', 'xero')
    if (customerSourceId) query = query.eq('source_id', customerSourceId)
    const { data, error } = await applyXeroAuthoritativeSnapshot(query, snapshot)
      .order('source_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      throw new Error(`Failed to load canonical customers: ${error.message}`)
    }

    const batch = (data ?? []) as CanonicalCustomerRow[]
    rows.push(...batch)

    if (batch.length < PAGE_SIZE) break
  }

  return rows
}

async function fetchCanonicalOrganisations(
  supabase: ServerSupabaseClient,
  snapshot: XeroAuthoritativeSnapshot
) {
  const query = supabase
    .from('canonical_organisations')
    .select('base_currency_code, source_timezone, country_code')
    .eq('user_id', snapshot.userId)
    .eq('tenant_id', snapshot.tenantId)
    .eq('source_system', 'xero')
  const { data, error } = await applyXeroAuthoritativeSnapshot(query, snapshot)
    .order('source_retrieved_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to load canonical organisation currency: ${error.message}`)
  }

  return (data ?? []) as CanonicalOrganisationRow[]
}

async function fetchCanonicalInvoices(
  supabase: ServerSupabaseClient,
  snapshot: XeroAuthoritativeSnapshot,
  customerSourceId?: string
) {
  const rows: CanonicalInvoiceRow[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('canonical_invoices')
      .select(
        'user_id, tenant_id, source_system, source_id, customer_source_id, type, status, issue_date, due_date, fully_paid_date, transaction_currency_code, organisation_base_currency_code, xero_currency_rate::text, total_native::text, amount_paid_native::text, amount_due_native::text, amount_credited_native::text, amount_due_base::text, currency_conversion_status, currency_conversion_failure_reason'
      )
      .eq('user_id', snapshot.userId)
      .eq('tenant_id', snapshot.tenantId)
      .eq('source_system', 'xero')
    if (customerSourceId) query = query.eq('customer_source_id', customerSourceId)
    const { data, error } = await applyXeroAuthoritativeSnapshot(query, snapshot)
      .order('source_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      throw new Error(`Failed to load canonical invoices: ${error.message}`)
    }

    const batch = (data ?? []) as CanonicalInvoiceRow[]
    rows.push(...batch)

    if (batch.length < PAGE_SIZE) break
  }

  return rows
}

async function fetchCanonicalPayments(
  supabase: ServerSupabaseClient,
  snapshot: XeroAuthoritativeSnapshot,
  customerSourceId?: string,
  invoiceSourceIds?: string[]
) {
  const rows: CanonicalPaymentRow[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('canonical_payments')
      .select('invoice_source_id, customer_source_id, payment_date')
      .eq('user_id', snapshot.userId)
      .eq('tenant_id', snapshot.tenantId)
      .eq('source_system', 'xero')
    if (customerSourceId) query = query.eq('customer_source_id', customerSourceId)
    if (invoiceSourceIds) query = query.in('invoice_source_id', invoiceSourceIds).is('customer_source_id', null)
    const { data, error } = await applyXeroAuthoritativeSnapshot(query, snapshot)
      .order('source_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      throw new Error(`Failed to load canonical payments: ${error.message}`)
    }

    const batch = (data ?? []) as CanonicalPaymentRow[]
    rows.push(...batch)

    if (batch.length < PAGE_SIZE) break
  }

  return rows
}

/** Optional credit evidence is held to the same authoritative generation as invoices. */
async function fetchHeldCustomerCredit(
  supabase: ServerSupabaseClient,
  snapshot: XeroAuthoritativeSnapshot,
  customerSourceId?: string
): Promise<{ certificate: CustomerCreditCertificate | null; rows: CustomerCreditEvidenceRow[] }> {
  const unavailable = { certificate: null, rows: [] }
  if (snapshot.mode !== 'generation') return unavailable
  try {
    const certificateQuery = supabase.from('xero_customer_credit_validations')
      .select('sync_run_id, user_id, tenant_id, source_system, contract_version, invoice_money_contract_version, readiness_state, reason_code, consistency_result, resource_observations')
      .eq('user_id', snapshot.userId).eq('tenant_id', snapshot.tenantId).eq('source_system', 'xero')
    const { data, error } = await applyXeroAuthoritativeSnapshot(certificateQuery, snapshot)
      .maybeSingle<CustomerCreditCertificate & { resource_observations: unknown }>()
    if (error || !data) return unavailable
    const certificate = data as CustomerCreditCertificate
    if (certificate.readiness_state !== 'ready' || certificate.sync_run_id !== snapshot.syncRunId ||
      certificate.user_id !== snapshot.userId || certificate.tenant_id !== snapshot.tenantId ||
      certificate.source_system !== 'xero' || certificate.contract_version !== CUSTOMER_CREDIT_CONTRACT_VERSION ||
      certificate.invoice_money_contract_version !== INVOICE_EXACT_MONEY_CONTRACT_VERSION ||
      certificate.reason_code !== 'stable_observation' || certificate.consistency_result !== 'matched') {
      return { certificate, rows: [] }
    }
    const initial = (data.resource_observations as { initial?: Record<string, { count?: unknown }> } | null)?.initial
    const expectedCounts = {
      overpayment: initial?.overpayments?.count,
      prepayment: initial?.prepayments?.count,
      credit_note: initial?.creditnotes?.count,
    }
    if (Object.values(expectedCounts).some(count => typeof count !== 'number' ||
      !Number.isSafeInteger(count) || count < 0)) return unavailable
    if (customerSourceId) {
      const countQuery = supabase.from('canonical_customer_credit_evidence_exact')
        .select('source_id', { count: 'exact', head: true })
        .eq('user_id', snapshot.userId).eq('tenant_id', snapshot.tenantId).eq('source_system', 'xero')
      const { count, error: countError } = await applyXeroAuthoritativeSnapshot(countQuery, snapshot)
      if (countError || count !== Object.values(expectedCounts).reduce<number>((sum, value) => sum + (value as number), 0)) {
        return unavailable
      }
    }

    const rows: CustomerCreditEvidenceRow[] = []
    for (let from = 0; ; from += PAGE_SIZE) {
      let query = supabase.from('canonical_customer_credit_evidence_exact')
        .select('sync_run_id, user_id, tenant_id, source_system, source_kind, source_id, customer_source_id, provider_type, status, residual_state, remaining_credit_native, currency_code, organisation_base_currency_code, xero_currency_rate')
        .eq('user_id', snapshot.userId).eq('tenant_id', snapshot.tenantId).eq('source_system', 'xero')
      if (customerSourceId) query = query.eq('customer_source_id', customerSourceId)
      const { data: batch, error: readError } = await applyXeroAuthoritativeSnapshot(query, snapshot)
        .order('source_kind', { ascending: true }).order('source_id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1)
      if (readError || !Array.isArray(batch)) return unavailable
      rows.push(...batch as CustomerCreditEvidenceRow[])
      if (batch.length < PAGE_SIZE) break
    }
    const seen = new Set<string>()
    for (const row of rows) {
      if (row.sync_run_id !== snapshot.syncRunId || row.user_id !== snapshot.userId ||
        row.tenant_id !== snapshot.tenantId || row.source_system !== 'xero' ||
        !row.customer_source_id || (customerSourceId && row.customer_source_id !== customerSourceId)) {
        return unavailable
      }
      const identity = `${row.source_kind}:${row.source_id}`
      if (!row.source_id || seen.has(identity)) return unavailable
      seen.add(identity)
    }
    if (!customerSourceId) {
      for (const [kind, expected] of Object.entries(expectedCounts)) {
        if (rows.filter(row => row.source_kind === kind).length !== expected) return unavailable
      }
    }
    return { certificate, rows }
  } catch {
    // The new feature is optional; a failed credit read never means observed zero.
    return unavailable
  }
}

export async function loadCustomerCollectionsSummaryWithMetadata(
  supabase: ServerSupabaseClient,
  userId: string,
  tenantId: string,
  scope?: { customerSourceId: string; snapshot: XeroAuthoritativeSnapshot }
): Promise<CustomerCollectionsSummaryResult> {
  const { todayIso } = getTodayContext()
  const snapshot = scope?.snapshot ?? await resolveXeroAuthoritativeSnapshot({
    supabaseAdmin: supabase,
    userId,
    tenantId,
  })

  assertXeroSnapshotIdentity(snapshot, { userId, tenantId })

  // The customer refresh uses the same canonical aggregation, scoped before any broad reads.
  const scopedInvoices = scope ? await fetchCanonicalInvoices(supabase, snapshot, scope.customerSourceId) : null
  const scopedInvoiceIds = scopedInvoices?.map(invoice => invoice.source_id)
  const [organisations, customers, invoices, payments, disputes, promises, customerCredit] = await Promise.all([
    fetchCanonicalOrganisations(supabase, snapshot),
    fetchCanonicalCustomers(supabase, snapshot, scope?.customerSourceId),
    scopedInvoices ?? fetchCanonicalInvoices(supabase, snapshot),
    scope ? (async () => {
      const direct = await fetchCanonicalPayments(supabase, snapshot, scope.customerSourceId)
      for (let from = 0; from < scopedInvoiceIds!.length; from += IDENTITY_BATCH_SIZE) {
        direct.push(...await fetchCanonicalPayments(supabase, snapshot, undefined, scopedInvoiceIds!.slice(from, from + IDENTITY_BATCH_SIZE)))
      }
      return direct
    })() : fetchCanonicalPayments(supabase, snapshot),
    loadInvoiceDisputesForSnapshot({ admin: supabase, userId, tenantId, snapshot, invoiceSourceIds: scopedInvoiceIds }),
    loadActiveInvoicePromises({ admin: supabase, userId, tenantId, snapshot, customerSourceId: scope?.customerSourceId }),
    fetchHeldCustomerCredit(supabase, snapshot, scope?.customerSourceId),
  ])

  await assertInvoicePromiseSnapshotCurrent({ admin: supabase, userId, tenantId, snapshot })
  return {
    ...calculateCustomerFinancialFeatures({
      evaluationDate: todayIso,
      userId,
      tenantId,
      snapshot: { syncRunId: snapshot.syncRunId },
      organisations, customers, invoices, payments, disputes, promises, customerCredit,
    }),
    snapshot: toXeroSnapshotReference(snapshot),
  }
}

export async function loadCustomerCollectionsSummary(
  supabase: ServerSupabaseClient,
  userId: string,
  tenantId: string
) {
  const result = await loadCustomerCollectionsSummaryWithMetadata(supabase, userId, tenantId)
  return result.rows
}
