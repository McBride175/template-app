import 'server-only'

import type { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type { PromiseView } from '@/lib/collections/promise-presentation'
import type { InvoicePromiseRecord } from '@/lib/collections/invoice-promises'
import { compareDecimalValues, normalizeCurrencyCode, normalizeDecimalValue } from '@/lib/money/currency'
import {
  assertXeroSnapshotIdentity,
  resolveXeroAuthoritativeSnapshot,
  type XeroAuthoritativeSnapshot,
} from '@/lib/xero/authoritative-snapshot'

const PAGE_SIZE = 1000
// PostgREST casts in SELECT preserve PostgreSQL numeric text before JSON parsing.
const DOMAIN_COLUMNS = 'id, user_id, tenant_id, source_system, invoice_source_id, customer_source_id, currency_code, status, promised_amount_native::text, qualifying_paid_amount_native::text'

type ReadContext = {
  admin: ReturnType<typeof createSupabaseAdminClient>
  userId: string
  tenantId: string
  snapshot: XeroAuthoritativeSnapshot
}
export interface ActiveInvoicePromise extends InvoicePromiseRecord {
  promised_date?: string
  revision?: string
  note?: string | null
}

/** One paginated operational read per scope; never reads events or accounting evidence. */
export async function loadActiveInvoicePromises(params: ReadContext & {
  customerSourceId?: string
  invoiceSourceId?: string
  includePresentation?: boolean
}): Promise<Map<string, ActiveInvoicePromise>> {
  assertXeroSnapshotIdentity(params.snapshot, params)
  const result = new Map<string, ActiveInvoicePromise>()
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = params.admin.from('invoice_promises')
      .select(DOMAIN_COLUMNS + (params.includePresentation ? ', promised_date, revision::text, note' : ''))
      .eq('user_id', params.userId).eq('tenant_id', params.tenantId)
      .eq('source_system', 'xero').eq('status', 'active')
    if (params.invoiceSourceId) query = query.eq('invoice_source_id', params.invoiceSourceId)
    if (params.customerSourceId) query = query.eq('customer_source_id', params.customerSourceId)
    const { data, error } = await query.order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('Promise operational state unavailable')
    const batch = data as unknown as ActiveInvoicePromise[]
    for (const row of batch) {
      if (row.user_id !== params.userId || row.tenant_id !== params.tenantId ||
          row.source_system !== 'xero' || row.status !== 'active' || !row.invoice_source_id ||
          (params.customerSourceId && row.customer_source_id !== params.customerSourceId) ||
          (params.invoiceSourceId && row.invoice_source_id !== params.invoiceSourceId) ||
          typeof row.promised_amount_native !== 'string' ||
          typeof row.qualifying_paid_amount_native !== 'string' ||
          normalizeDecimalValue(row.promised_amount_native) === null ||
          normalizeDecimalValue(row.qualifying_paid_amount_native) === null ||
          result.has(row.invoice_source_id)) {
        throw new Error('Invalid scoped Promise operational state')
      }
      result.set(row.invoice_source_id, row)
    }
    if (batch.length < PAGE_SIZE) return result
  }
}

/** Promotion atomically changes live Promise state. Reject a read spanning that publication. */
export async function assertInvoicePromiseSnapshotCurrent(params: ReadContext) {
  const current = await resolveXeroAuthoritativeSnapshot({
    supabaseAdmin: params.admin, userId: params.userId, tenantId: params.tenantId,
  })
  if (current.mode !== params.snapshot.mode || current.syncRunId !== params.snapshot.syncRunId) {
    throw new Error('Accounting snapshot changed while reading Promise actionability; refresh required')
  }
}

/** Customer UI only: latest retained commitment per invoice, including settled/terminal history. */
export async function loadLatestInvoicePromisePresentation(params: ReadContext & { customerSourceId: string; invoiceSourceId?: string }) {
  assertXeroSnapshotIdentity(params.snapshot, params)
  type PresentedRow = ActiveInvoicePromise & { created_at: string; resolved_at: string | null }
  const result = new Map<string, PromiseView>()
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = params.admin.from('invoice_promises')
      .select(DOMAIN_COLUMNS + ', promised_date, note, revision::text, created_at, resolved_at')
      .eq('user_id', params.userId).eq('tenant_id', params.tenantId).eq('source_system', 'xero')
      .eq('customer_source_id', params.customerSourceId)
    if (params.invoiceSourceId) query = query.eq('invoice_source_id', params.invoiceSourceId)
    const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('Promise presentation unavailable')
    for (const row of data as unknown as PresentedRow[]) {
      if (row.user_id !== params.userId || row.tenant_id !== params.tenantId || row.source_system !== 'xero' ||
          row.customer_source_id !== params.customerSourceId || !row.invoice_source_id ||
          (params.invoiceSourceId && row.invoice_source_id !== params.invoiceSourceId) ||
          !['active', 'kept', 'missed', 'unclear', 'cancelled'].includes(row.status) ||
          typeof row.promised_amount_native !== 'string' || typeof row.qualifying_paid_amount_native !== 'string' ||
          compareDecimalValues(row.promised_amount_native, '0') !== 1 || compareDecimalValues(row.qualifying_paid_amount_native, '0') === -1 ||
          normalizeDecimalValue(row.qualifying_paid_amount_native) === null || !normalizeCurrencyCode(row.currency_code)) throw new Error('Invalid Promise presentation scope')
      const previous = result.get(row.invoice_source_id)
      if (previous?.status === 'active' && row.status === 'active') throw new Error('Duplicate Active Promise')
      if (!previous || row.status === 'active') result.set(row.invoice_source_id, {
        id: row.id, invoiceSourceId: row.invoice_source_id, currencyCode: row.currency_code,
        status: row.status, revision: String(row.revision), promisedAmountNative: row.promised_amount_native,
        qualifyingPaidAmountNative: row.qualifying_paid_amount_native, promisedDate: row.promised_date,
        note: row.note, createdAt: row.created_at, resolvedAt: row.resolved_at,
      })
    }
    if (data.length < PAGE_SIZE) return result
  }
}
