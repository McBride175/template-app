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
  deriveInvoiceDispute,
  InvoiceDisputeDomainError,
  validateDisputableInvoice,
  validateNewPartialDisputedAmount,
  type DisputeAccountingInvoice,
  type InvoiceDisputeRecord,
  type InvoiceDisputeMode,
} from '@/lib/collections/invoice-disputes'

const SOURCE_SYSTEM = 'xero'
const PAGE_SIZE = 1000
const DISPUTE_COLUMNS = 'id, user_id, tenant_id, source_system, invoice_source_id, dispute_mode, recorded_disputed_amount_native, amount_due_at_last_review_native, note, is_active, resolved_at, created_at, updated_at, revision'
const INVOICE_COLUMNS = 'user_id, tenant_id, source_id, source_system, customer_source_id, type, status, amount_due_native, amount_due_base, transaction_currency_code, organisation_base_currency_code, xero_currency_rate'
const CUSTOMER_INVOICE_COLUMNS = `${INVOICE_COLUMNS}, invoice_number, reference, issue_date, due_date`

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

interface CustomerDisputeInvoice extends DisputeAccountingInvoice {
  invoice_number: string | null
  reference: string | null
  issue_date: string | null
  due_date: string | null
}

function activeDisputeValues(params: {
  userId: string
  tenantId: string
  invoiceSourceId: string
  mode: InvoiceDisputeMode
  currentDue: string
  partialAmountNative?: string
  note: string | null
}) {
  return {
    user_id: params.userId,
    tenant_id: params.tenantId,
    source_system: SOURCE_SYSTEM,
    invoice_source_id: params.invoiceSourceId,
    dispute_mode: params.mode,
    recorded_disputed_amount_native: params.mode === 'full'
      ? params.currentDue
      : validateNewPartialDisputedAmount(params.partialAmountNative, params.currentDue),
    amount_due_at_last_review_native: params.currentDue,
    note: params.note,
    is_active: true,
    resolved_at: null,
  }
}

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

function requireRevision(value: string | undefined) {
  if (!value || !/^[1-9]\d*$/.test(value) || BigInt(value) > BigInt('9223372036854775807')) {
    throw new InvoiceDisputeOperationError('invalid_input')
  }
  return value
}

function assertRevision(dispute: InvoiceDisputeRecord, expectedRevision: string) {
  if (String(dispute.revision) !== expectedRevision) throw new InvoiceDisputeOperationError('conflict')
}

function isProviderIdentityConflict(error: { code?: string } | null) {
  return error?.code === '23505'
}

export async function authenticateDisputeTenant(tenantIdInput: string | null) {
  const requestedTenantId = tenantIdInput === null ? null : requiredIdentity(tenantIdInput)
  const supabase = await createServerSupabaseClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) throw new InvoiceDisputeOperationError('unauthorized')

  const entitlement = await claimActionsEntitlementStatus({
    userId: user.id,
    preferredTenantId: requestedTenantId,
    supabase,
  })
  // The existing tenant resolver may fall back to a different connected tenant.
  // Dispute operations must never accept such a fallback for a requested tenant.
  if (requestedTenantId !== null && entitlement.tenantId !== requestedTenantId) {
    throw new InvoiceDisputeOperationError('forbidden')
  }
  if (!entitlement.hasActionsAccess) throw new InvoiceDisputeOperationError('forbidden')
  const tenantId = entitlement.tenantId
  if (!tenantId) throw new InvoiceDisputeOperationError('forbidden')

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

async function loadCurrentCustomerInvoices(
  context: Awaited<ReturnType<typeof authenticateDisputeTenant>>,
  customerSourceId: string
) {
  const invoices: CustomerDisputeInvoice[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const query = context.admin.from('canonical_invoices')
      .select(CUSTOMER_INVOICE_COLUMNS)
      .eq('user_id', context.userId)
      .eq('tenant_id', context.tenantId)
      .eq('source_system', SOURCE_SYSTEM)
      .eq('customer_source_id', customerSourceId)
      .eq('type', 'ACCREC')
    const { data, error } = await applyXeroAuthoritativeSnapshot(query, context.snapshot)
      .order('source_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const batch = (data ?? []) as CustomerDisputeInvoice[]
    invoices.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  return invoices
}

/** Invoice context for the existing customer page, including paid/settled rows. */
export async function loadCustomerInvoiceDisputes(params: {
  tenantId: string
  customerSourceId: string
}) {
  const context = await authenticateDisputeTenant(params.tenantId)
  const customerSourceId = requiredIdentity(params.customerSourceId)
  const [invoices, disputes] = await Promise.all([
    loadCurrentCustomerInvoices(context, customerSourceId),
    loadInvoiceDisputesForSnapshot(context),
  ])
  const disputeByInvoiceId = new Map(
    disputes.filter((dispute) => dispute.source_system === SOURCE_SYSTEM)
      .map((dispute) => [dispute.invoice_source_id, dispute])
  )
  return invoices.map((invoice) => {
    const dispute = disputeByInvoiceId.get(invoice.source_id) ?? null
    const derived = deriveInvoiceDispute(invoice, dispute)
    return {
      invoiceSourceId: invoice.source_id,
      invoiceNumber: invoice.invoice_number,
      reference: invoice.reference,
      issueDate: invoice.issue_date,
      dueDate: invoice.due_date,
      currencyCode: invoice.transaction_currency_code,
      disputeId: dispute?.id ?? null,
      revision: dispute ? String(dispute.revision) : null,
      note: dispute?.note ?? null,
      invoiceState: derived.invoiceState,
      disputeMode: derived.disputeMode,
      isActive: derived.isActive,
      isResolved: derived.isResolved,
      needsReview: derived.needsReview,
      currentAmountDueNative: derived.currentAmountDueNative,
      recordedDisputedAmountNative: derived.recordedDisputedAmountNative,
      effectiveDisputedAmountNative: derived.effectiveDisputedAmountNative,
      collectibleAmountNative: derived.collectibleAmountNative,
    }
  }).filter((invoice) => invoice.invoiceState === 'open' || invoice.disputeId !== null)
}

/** Validate the full customer selection before one transactional database call. */
export async function setFullCustomerInvoiceDisputes(params: {
  tenantId: string
  customerSourceId: string
  invoiceSourceIds?: string[]
  expectedRevisions: Array<{ invoiceSourceId: string; revision: string }>
}) {
  const context = await authenticateDisputeTenant(params.tenantId)
  const customerSourceId = requiredIdentity(params.customerSourceId)
  const invoices = await loadCurrentCustomerInvoices(context, customerSourceId)
  const byId = new Map(invoices.map((invoice) => [invoice.source_id, invoice]))
  const selectedIds = params.invoiceSourceIds === undefined
    ? invoices.filter((invoice) => {
      try {
        validateDisputableInvoice(invoice)
        return true
      } catch (error) {
        if (error instanceof InvoiceDisputeDomainError && error.code === 'invalid_invoice') return false
        throw error
      }
    }).map((invoice) => invoice.source_id)
    : params.invoiceSourceIds.map(requiredIdentity)
  if (selectedIds.length === 0 || new Set(selectedIds).size !== selectedIds.length) {
    throw new InvoiceDisputeOperationError('invalid_input')
  }
  const selected = selectedIds.map((id) => {
    const invoice = byId.get(id)
    if (!invoice) throw new InvoiceDisputeOperationError('not_found')
    return { id, currentDue: validateDisputableInvoice(invoice) }
  })
  const revisions = new Map<string, string>()
  for (const entry of params.expectedRevisions) {
    const id = requiredIdentity(entry.invoiceSourceId)
    if (revisions.has(id) || !selectedIds.includes(id)) throw new InvoiceDisputeOperationError('invalid_input')
    revisions.set(id, requireRevision(entry.revision))
  }
  const { data, error } = await context.admin.rpc('apply_invoice_disputes_bulk_full', {
    p_user_id: context.userId,
    p_tenant_id: context.tenantId,
    p_source_system: SOURCE_SYSTEM,
    p_rows: selected.map(({ id, currentDue }) => ({
      invoice_source_id: id,
      amount_due_native: currentDue,
      expected_revision: revisions.get(id) ?? null,
    })),
  })
  if (error?.message?.includes('invoice_disputes_revision_conflict')) {
    throw new InvoiceDisputeOperationError('conflict')
  }
  if (error) throw error
  return data as InvoiceDisputeRecord[]
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
  expectedRevision: string,
  changes: Record<string, unknown>,
  expectedActive?: boolean
) {
  assertRevision(dispute, expectedRevision)
  let query = context.admin.from('invoice_disputes')
    .update(changes)
    .eq('id', dispute.id)
    .eq('user_id', context.userId)
    .eq('tenant_id', context.tenantId)
    .eq('source_system', dispute.source_system)
    .eq('invoice_source_id', dispute.invoice_source_id)
    .eq('revision', expectedRevision)
  if (expectedActive !== undefined) query = query.eq('is_active', expectedActive)
  const { data, error } = await query
    .select(DISPUTE_COLUMNS)
    .maybeSingle<InvoiceDisputeRecord>()
  if (error) throw error
  if (!data) throw new InvoiceDisputeOperationError('conflict')
  return data
}

async function setDispute(params: {
  tenantId: string
  invoiceSourceId: string
  mode: InvoiceDisputeMode
  partialAmountNative?: string
  note?: string | null
  expectedRevision?: string
}) {
  const context = await authenticateDisputeTenant(params.tenantId)
  const invoiceSourceId = requiredIdentity(params.invoiceSourceId)
  const { currentDue } = await requireCurrentOpenInvoice(context, invoiceSourceId)
  const { data: existing, error: existingError } = await context.admin
    .from('invoice_disputes')
    .select(DISPUTE_COLUMNS)
    .eq('user_id', context.userId)
    .eq('tenant_id', context.tenantId)
    .eq('source_system', SOURCE_SYSTEM)
    .eq('invoice_source_id', invoiceSourceId)
    .maybeSingle<InvoiceDisputeRecord>()
  if (existingError) throw existingError
  const values = activeDisputeValues({
    userId: context.userId,
    tenantId: context.tenantId,
    invoiceSourceId,
    mode: params.mode,
    currentDue,
    partialAmountNative: params.partialAmountNative,
    note: params.note === undefined ? existing?.note ?? null : normaliseNote(params.note),
  })
  if (params.expectedRevision !== undefined) {
    const expectedRevision = requireRevision(params.expectedRevision)
    if (!existing || !existing.is_active) throw new InvoiceDisputeOperationError('conflict')
    return updateOwnedDispute(context, existing, expectedRevision, {
      dispute_mode: values.dispute_mode,
      recorded_disputed_amount_native: values.recorded_disputed_amount_native,
      amount_due_at_last_review_native: currentDue,
      ...(params.note === undefined ? {} : { note: values.note }),
    }, true)
  }
  if (existing) throw new InvoiceDisputeOperationError('conflict')
  const { data, error } = await context.admin.from('invoice_disputes').insert(values)
    .select(DISPUTE_COLUMNS).single<InvoiceDisputeRecord>()
  if (isProviderIdentityConflict(error)) throw new InvoiceDisputeOperationError('conflict')
  if (error) throw error
  return data
}

export function setFullInvoiceDispute(params: {
  tenantId: string
  invoiceSourceId: string
  note?: string | null
  expectedRevision?: string
}) {
  return setDispute({ ...params, mode: 'full' })
}

export function setPartialInvoiceDispute(params: {
  tenantId: string
  invoiceSourceId: string
  disputedAmountNative: string
  note?: string | null
  expectedRevision?: string
}) {
  return setDispute({
    tenantId: params.tenantId,
    invoiceSourceId: params.invoiceSourceId,
    mode: 'partial',
    partialAmountNative: params.disputedAmountNative,
    note: params.note,
    expectedRevision: params.expectedRevision,
  })
}

export async function editInvoiceDisputeNote(params: {
  tenantId: string
  disputeId: string
  note: string | null
  expectedRevision: string
}) {
  const context = await authenticateDisputeTenant(params.tenantId)
  const dispute = await findOwnedDispute(context, params.disputeId)
  await checkCurrentInvoiceIfPresent(context, dispute)
  return updateOwnedDispute(context, dispute, requireRevision(params.expectedRevision), {
    note: normaliseNote(params.note),
  })
}

export async function resolveInvoiceDispute(params: {
  tenantId: string
  disputeId: string
  expectedRevision: string
}) {
  const context = await authenticateDisputeTenant(params.tenantId)
  const dispute = await findOwnedDispute(context, params.disputeId)
  await checkCurrentInvoiceIfPresent(context, dispute)
  if (!dispute.is_active) throw new InvoiceDisputeOperationError('conflict')
  return updateOwnedDispute(context, dispute, requireRevision(params.expectedRevision), {
    is_active: false,
    resolved_at: new Date().toISOString(),
  }, true)
}

export async function reactivateInvoiceDispute(params: {
  tenantId: string
  disputeId: string
  expectedRevision: string
}) {
  const context = await authenticateDisputeTenant(params.tenantId)
  const dispute = await findOwnedDispute(context, params.disputeId)
  if (dispute.is_active) throw new InvoiceDisputeOperationError('conflict')
  if (dispute.source_system !== SOURCE_SYSTEM) throw new InvoiceDisputeOperationError('invalid_input')
  const { currentDue } = await requireCurrentOpenInvoice(context, dispute.invoice_source_id)
  return updateOwnedDispute(context, dispute, requireRevision(params.expectedRevision), {
    is_active: true,
    resolved_at: null,
    amount_due_at_last_review_native: currentDue,
  }, false)
}

export async function confirmInvoiceDisputeReview(params: {
  tenantId: string
  disputeId: string
  expectedRevision: string
}) {
  const context = await authenticateDisputeTenant(params.tenantId)
  const dispute = await findOwnedDispute(context, params.disputeId)
  if (!dispute.is_active) throw new InvoiceDisputeOperationError('conflict')
  if (dispute.source_system !== SOURCE_SYSTEM) throw new InvoiceDisputeOperationError('invalid_input')
  const { currentDue } = await requireCurrentOpenInvoice(context, dispute.invoice_source_id)
  return updateOwnedDispute(context, dispute, requireRevision(params.expectedRevision), {
    amount_due_at_last_review_native: currentDue,
  }, true)
}
