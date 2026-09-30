import 'server-only'

import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { claimActionsEntitlementStatus } from '@/lib/billing/entitlements'
import { resolveXeroAuthoritativeSnapshot, applyXeroAuthoritativeSnapshot } from '@/lib/xero/authoritative-snapshot'
import { identity, sourceSystem } from '@/lib/collections/action-history'
import { decodeCustomerHistoryCursor, encodeCustomerHistoryCursor,
  projectCustomerHistoryEvent, type RawCustomerHistoryEvent } from '@/lib/collections/customer-history'

export class CustomerHistoryOperationError extends Error {
  constructor(readonly code: 'unauthorized' | 'forbidden' | 'not_found' | 'invalid_input') {
    super(code)
    this.name = 'CustomerHistoryOperationError'
  }
}

function historyLimit(value: unknown) {
  if (value === null || value === undefined) return 30
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new CustomerHistoryOperationError('invalid_input')
  }
  return Math.min(Number(value), 50)
}

export async function readCustomerHistory(input: {
  tenantId: unknown; sourceSystem: unknown; customerSourceId: unknown;
  limit?: unknown; cursor?: unknown
}) {
  let tenantId: string, customerSourceId: string
  try {
    tenantId = identity(input.tenantId, 'tenant_id')
    customerSourceId = identity(input.customerSourceId, 'customer_source_id')
    sourceSystem(input.sourceSystem)
  } catch { throw new CustomerHistoryOperationError('invalid_input') }
  const limit = historyLimit(input.limit)
  let cursor: ReturnType<typeof decodeCustomerHistoryCursor>
  try { cursor = decodeCustomerHistoryCursor(input.cursor) }
  catch { throw new CustomerHistoryOperationError('invalid_input') }

  const supabase = await createServerSupabaseClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) throw new CustomerHistoryOperationError('unauthorized')
  const entitlement = await claimActionsEntitlementStatus({
    userId: user.id, preferredTenantId: tenantId, supabase,
  })
  if (entitlement.tenantId !== tenantId || !entitlement.hasActionsAccess) {
    throw new CustomerHistoryOperationError('forbidden')
  }

  const admin = createSupabaseAdminClient()
  const snapshot = await resolveXeroAuthoritativeSnapshot({
    supabaseAdmin: admin, userId: user.id, tenantId,
  })
  const { data: customer, error: customerError } = await applyXeroAuthoritativeSnapshot(
    admin.from('canonical_customers').select('source_id, name')
      .eq('user_id', user.id).eq('tenant_id', tenantId)
      .eq('source_system', 'xero').eq('source_id', customerSourceId), snapshot
  ).maybeSingle<{ source_id: string; name: string }>()
  if (customerError) throw customerError
  if (!customer) throw new CustomerHistoryOperationError('not_found')

  const { data, error } = await admin.rpc('read_customer_collection_history', {
    p_user: user.id, p_tenant: tenantId, p_source: 'xero', p_customer: customerSourceId,
    p_sync_run: snapshot.syncRunId,
    p_before_timestamp: cursor?.timestamp ?? null, p_before_event_id: cursor?.id ?? null,
    p_limit: limit + 1,
  })
  if (error) throw error
  const rows = (data ?? []) as RawCustomerHistoryEvent[]
  const page = rows.slice(0, limit)
  const events = page.map(projectCustomerHistoryEvent)

  // Current invoice numbers are a convenience, never historical terms. One
  // snapshot-scoped batch supplies names without a query per event or invoice.
  const invoiceIds = [...new Set(events.map(event => event.invoiceSourceId).filter(
    (value): value is string => Boolean(value)
  ))]
  if (invoiceIds.length) {
    const { data: invoices, error: invoiceError } = await applyXeroAuthoritativeSnapshot(
      admin.from('canonical_invoices').select('source_id, invoice_number')
        .eq('user_id', user.id).eq('tenant_id', tenantId)
        .eq('source_system', 'xero').eq('customer_source_id', customerSourceId)
        .in('source_id', invoiceIds), snapshot
    )
    if (invoiceError) throw invoiceError
    const references = new Map((invoices ?? []).map(row => [row.source_id, row.invoice_number]))
    for (const event of events) {
      if (event.invoiceSourceId) event.invoiceReference = references.get(event.invoiceSourceId) || null
    }
  }
  const last = page.at(-1)
  return {
    customer: { sourceSystem: 'xero', sourceId: customer.source_id, name: customer.name },
    events,
    nextCursor: rows.length > limit && last
      ? encodeCustomerHistoryCursor({ timestamp: last.occurred_at, id: last.event_id }) : null,
  }
}
