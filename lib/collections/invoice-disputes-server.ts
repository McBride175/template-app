import 'server-only'

import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { claimActionsEntitlementStatus } from '@/lib/billing/entitlements'
import {
  resolveCollectionsCurrencyAccess,
} from '@/lib/billing/collections-access'
import { loadCollectionsCurrencyContext } from '@/lib/collections/currency-context-server'
import {
  applyXeroAuthoritativeSnapshot,
  assertXeroSnapshotIdentity,
  resolveXeroAuthoritativeSnapshot,
  type XeroAuthoritativeSnapshot,
} from '@/lib/xero/authoritative-snapshot'
import {
  validateDisputableInvoice,
  validateNewPartialDisputedAmount,
  type DisputeAccountingInvoice,
  type InvoiceDisputeRecord,
  type InvoiceDisputeMode,
} from '@/lib/collections/invoice-disputes'

const SOURCE_SYSTEM = 'xero'
const PAGE_SIZE = 1000
const DISPUTE_COLUMNS = 'id, user_id, tenant_id, source_system, invoice_source_id, dispute_mode, recorded_disputed_amount_native, amount_due_at_last_review_native, note, is_active, resolved_at, created_at, updated_at'
const INVOICE_COLUMNS = 'user_id, tenant_id, source_id, source_system, customer_source_id, type, status, amount_due_native, amount_due_base, transaction_currency_code, organisation_base_currency_code, xero_currency_rate'

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

export class InvoiceDisputeOperationError extends Error {
  constructor(readonly code: 'unauthorized' | 'forbidden' | 'not_found' | 'invalid_input' | 'conflict') {
    super(code)
    this.name = 'InvoiceDisputeOperationError'
  }
}

function requiredIdentity(value: string) {
  const normalized = value?.trim()
  if (!normalized) throw new InvoiceDisputeOperationError('invalid_input')
  return normalized
}

function normaliseNote(value: string | null) {
  const normalized = value?.trim()
  return normalized || null
}

async function authenticateDisputeTenant(tenantIdInput: string) {
  const tenantId = requiredIdentity(tenantIdInput)
  const supabase = await createServerSupabaseClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) throw new InvoiceDisputeOperationError('unauthorized')

  const entitlement = await claimActionsEntitlementStatus({
    userId: user.id,
    preferredTenantId: tenantId,
    supabase,
  })
  // The existing tenant resolver may fall back to a different connected tenant.
  // Dispute operations must never accept such a fallback for a requested tenant.
  if (entitlement.tenantId !== tenantId) throw new InvoiceDisputeOperationError('forbidden')
  if (!entitlement.hasActionsAccess) throw new InvoiceDisputeOperationError('forbidden')

  const admin = createSupabaseAdminClient()
  const snapshot = await resolveXeroAuthoritativeSnapshot({
    supabaseAdmin: admin,
    userId: user.id,
    tenantId,
  })
  const currencyContext = await loadCollectionsCurrencyContext({
    supabaseAdmin: admin,
    userId: user.id,
    tenantId,
    snapshot,
  })
  if (!resolveCollectionsCurrencyAccess({ entitlement, currencyContext }).allowed) {
    throw new InvoiceDisputeOperationError('forbidden')
  }
  return { admin, userId: user.id, tenantId, snapshot }
}

/** Use only after server authentication; the snapshot is held for this lookup. */
export async function loadAuthoritativeDisputeInvoice(params: {
  admin: AdminClient
  userId: string
  tenantId: string
  snapshot: XeroAuthoritativeSnapshot
  invoiceSourceId: string
}): Promise<DisputeAccountingInvoice | null> {
  assertXeroSnapshotIdentity(params.snapshot, {
    userId: params.userId,
    tenantId: params.tenantId,
  })
  const query = params.admin.from('canonical_invoices')
    .select(INVOICE_COLUMNS)
    .eq('user_id', params.userId)
    .eq('tenant_id', params.tenantId)
    .eq('source_system', SOURCE_SYSTEM)
    .eq('source_id', requiredIdentity(params.invoiceSourceId))
  const { data, error } = await applyXeroAuthoritativeSnapshot(query, params.snapshot)
    .maybeSingle<DisputeAccountingInvoice>()
  if (error) throw error
  return data
}

/** Scoped read for Phase 3 aggregation and the later worklist. */
export async function loadInvoiceDisputesForSnapshot(params: {
  admin: AdminClient
  userId: string
  tenantId: string
  snapshot: XeroAuthoritativeSnapshot
}): Promise<InvoiceDisputeRecord[]> {
  assertXeroSnapshotIdentity(params.snapshot, {
    userId: params.userId,
    tenantId: params.tenantId,
  })
  const disputes: InvoiceDisputeRecord[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await params.admin.from('invoice_disputes')
      .select(DISPUTE_COLUMNS)
      .eq('user_id', params.userId)
      .eq('tenant_id', params.tenantId)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const batch = (data ?? []) as InvoiceDisputeRecord[]
    disputes.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  return disputes
}

async function requireCurrentOpenInvoice(
  context: Awaited<ReturnType<typeof authenticateDisputeTenant>>,
  invoiceSourceId: string
) {
  const invoice = await loadAuthoritativeDisputeInvoice({
    ...context,
    invoiceSourceId,
  })
  if (!invoice) throw new InvoiceDisputeOperationError('not_found')
  return { invoice, currentDue: validateDisputableInvoice(invoice) }
}

async function findOwnedDispute(
  context: Awaited<ReturnType<typeof authenticateDisputeTenant>>,
  id: string
) {
  const { data, error } = await context.admin.from('invoice_disputes')
    .select(DISPUTE_COLUMNS)
    .eq('id', requiredIdentity(id))
    .eq('user_id', context.userId)
    .eq('tenant_id', context.tenantId)
    .maybeSingle<InvoiceDisputeRecord>()
  if (error) throw error
  if (!data) throw new InvoiceDisputeOperationError('not_found')
  return data
}

async function checkCurrentInvoiceIfPresent(
  context: Awaited<ReturnType<typeof authenticateDisputeTenant>>,
  dispute: InvoiceDisputeRecord
) {
  if (dispute.source_system !== SOURCE_SYSTEM) {
    throw new InvoiceDisputeOperationError('invalid_input')
  }
  // An absent invoice is not proof of payment and must not prevent note edits or
  // an explicit resolution of the retained user record.
  return loadAuthoritativeDisputeInvoice({
    ...context,
    invoiceSourceId: dispute.invoice_source_id,
  })
}

async function updateOwnedDispute(
  context: Awaited<ReturnType<typeof authenticateDisputeTenant>>,
  dispute: InvoiceDisputeRecord,
  changes: Record<string, unknown>
) {
  const { data, error } = await context.admin.from('invoice_disputes')
    .update(changes)
    .eq('id', dispute.id)
    .eq('user_id', context.userId)
    .eq('tenant_id', context.tenantId)
    .eq('source_system', dispute.source_system)
    .eq('invoice_source_id', dispute.invoice_source_id)
    .select(DISPUTE_COLUMNS)
    .maybeSingle<InvoiceDisputeRecord>()
  if (error) throw error
  if (!data) throw new InvoiceDisputeOperationError('not_found')
  return data
}

async function setDispute(params: {
  tenantId: string
  invoiceSourceId: string
  mode: InvoiceDisputeMode
  partialAmountNative?: string
  note?: string | null
}) {
  const context = await authenticateDisputeTenant(params.tenantId)
  const invoiceSourceId = requiredIdentity(params.invoiceSourceId)
  const { currentDue } = await requireCurrentOpenInvoice(context, invoiceSourceId)
  const recorded = params.mode === 'full'
    ? currentDue
    : validateNewPartialDisputedAmount(params.partialAmountNative, currentDue)
  const { data: existing, error: existingError } = await context.admin
    .from('invoice_disputes')
    .select(DISPUTE_COLUMNS)
    .eq('user_id', context.userId)
    .eq('tenant_id', context.tenantId)
    .eq('source_system', SOURCE_SYSTEM)
    .eq('invoice_source_id', invoiceSourceId)
    .maybeSingle<InvoiceDisputeRecord>()
  if (existingError) throw existingError

  const { data, error } = await context.admin.from('invoice_disputes').upsert({
    user_id: context.userId,
    tenant_id: context.tenantId,
    source_system: SOURCE_SYSTEM,
    invoice_source_id: invoiceSourceId,
    dispute_mode: params.mode,
    recorded_disputed_amount_native: recorded,
    amount_due_at_last_review_native: currentDue,
    note: params.note === undefined ? existing?.note ?? null : normaliseNote(params.note),
    is_active: true,
    resolved_at: null,
  }, { onConflict: 'user_id,tenant_id,source_system,invoice_source_id' })
    .select(DISPUTE_COLUMNS)
    .single<InvoiceDisputeRecord>()
  if (error) throw error
  return data
}

export function setFullInvoiceDispute(params: {
  tenantId: string
  invoiceSourceId: string
  note?: string | null
}) {
  return setDispute({ ...params, mode: 'full' })
}

export function setPartialInvoiceDispute(params: {
  tenantId: string
  invoiceSourceId: string
  disputedAmountNative: string
  note?: string | null
}) {
  return setDispute({
    tenantId: params.tenantId,
    invoiceSourceId: params.invoiceSourceId,
    mode: 'partial',
    partialAmountNative: params.disputedAmountNative,
    note: params.note,
  })
}

export async function editInvoiceDisputeNote(params: {
  tenantId: string
  disputeId: string
  note: string | null
}) {
  const context = await authenticateDisputeTenant(params.tenantId)
  const dispute = await findOwnedDispute(context, params.disputeId)
  await checkCurrentInvoiceIfPresent(context, dispute)
  return updateOwnedDispute(context, dispute, { note: normaliseNote(params.note) })
}

export async function resolveInvoiceDispute(params: {
  tenantId: string
  disputeId: string
}) {
  const context = await authenticateDisputeTenant(params.tenantId)
  const dispute = await findOwnedDispute(context, params.disputeId)
  await checkCurrentInvoiceIfPresent(context, dispute)
  if (!dispute.is_active) throw new InvoiceDisputeOperationError('conflict')
  return updateOwnedDispute(context, dispute, {
    is_active: false,
    resolved_at: new Date().toISOString(),
  })
}

export async function reactivateInvoiceDispute(params: {
  tenantId: string
  disputeId: string
}) {
  const context = await authenticateDisputeTenant(params.tenantId)
  const dispute = await findOwnedDispute(context, params.disputeId)
  if (dispute.is_active) throw new InvoiceDisputeOperationError('conflict')
  if (dispute.source_system !== SOURCE_SYSTEM) throw new InvoiceDisputeOperationError('invalid_input')
  const { currentDue } = await requireCurrentOpenInvoice(context, dispute.invoice_source_id)
  return updateOwnedDispute(context, dispute, {
    is_active: true,
    resolved_at: null,
    amount_due_at_last_review_native: currentDue,
  })
}

export async function confirmInvoiceDisputeReview(params: {
  tenantId: string
  disputeId: string
}) {
  const context = await authenticateDisputeTenant(params.tenantId)
  const dispute = await findOwnedDispute(context, params.disputeId)
  if (!dispute.is_active) throw new InvoiceDisputeOperationError('conflict')
  if (dispute.source_system !== SOURCE_SYSTEM) throw new InvoiceDisputeOperationError('invalid_input')
  const { currentDue } = await requireCurrentOpenInvoice(context, dispute.invoice_source_id)
  return updateOwnedDispute(context, dispute, {
    amount_due_at_last_review_native: currentDue,
  })
}
