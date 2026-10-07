import type { FinancialMutationContinuation } from '@/lib/collections/financial-mutation-reconciliation-server'
import 'server-only'

import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { claimCollectionAccess, collectionAccessCurrencyContext } from '@/lib/collections/access-context-server'
import { resolveCollectionsCurrencyAccess } from '@/lib/billing/collections-access'
import { loadCollectionsCurrencyContext } from '@/lib/collections/currency-context-server'
import { resolveXeroAuthoritativeSnapshot, snapshotFromCollectionAccessContext } from '@/lib/xero/authoritative-snapshot'
import { validateDisputableInvoice, type DisputeAccountingInvoice } from '@/lib/collections/invoice-disputes'
import { compareDecimalValues, normalizeCurrencyCode, sumDecimalValues } from '@/lib/money/currency'
import { completePromiseResource, derivePromiseTimeContext, exactPromiseAmount, validPromiseDate,
  type PromiseLifecycleRecord, type PromiseAccountingObservation, type PromisePaymentEvidence, type PromiseCashEvidence } from '@/lib/collections/promise-evidence'
import { qualifyPromisePayments } from '@/lib/collections/promise-payment-qualification'
import { resolvePromiseOutcome, type PromiseCurrencyValuation } from '@/lib/collections/promise-outcome-resolution'

type Admin = ReturnType<typeof createSupabaseAdminClient>
type StoredPromise = Omit<PromiseLifecycleRecord, 'revision'> & {
  revision: string; note: string | null; updated_at: string; resolved_at: string | null;
  evaluated_sync_run_id: string | null; evaluated_at: string | null
}
type Event = { id: string; event_sequence: string; event_type: string; occurred_at: string; effective_at: string | null;
  before_terms: unknown; after_terms: unknown; actor_kind: string }
type Held = { sync_run_id: string; digest: string; invoice: (DisputeAccountingInvoice & {
  sync_run_id: string; currency_conversion_status: PromiseCurrencyValuation['currency_conversion_status'] }) | null;
  promise: StoredPromise | null; observation: PromiseAccountingObservation; payment_ids: string[];
  evidence: { payments: PromisePaymentEvidence[]; cash: PromiseCashEvidence[] } | null }
type Committed = { promise: StoredPromise; events: Event[]; replayed: boolean }
export type PromiseRequestIntent = {
  operation: 'create' | 'edit' | 'cancel'; invoiceSourceId?: string; promiseId?: string; expectedRevision?: string;
  amount?: string; promisedDate?: string; note?: string | null
}
export class InvoicePromiseOperationError extends Error {
  constructor(readonly code: 'unauthorized' | 'forbidden' | 'not_found' | 'invalid_input' | 'conflict' | 'temporarily_unavailable') {
    super(code); this.name = 'InvoicePromiseOperationError'
  }
}
const invalid = () => { throw new InvoicePromiseOperationError('invalid_input') }
function identity(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) return invalid()
  return value.trim()
}
function uuid(value: unknown) {
  const id = identity(value)
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) return invalid()
  return id.toLowerCase()
}
function revision(value: unknown) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) return invalid()
  return value
}
/** Normalize user intent before any accounting fetch; omitted amount never cancels. */
export function parsePromiseRequest(body: unknown): { tenantId: string; commandId: string; intent: PromiseRequestIntent } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid()
  const input = body as Record<string, unknown>
  if (Object.keys(input).some(key => !['tenantId','commandId','operation','invoiceSourceId','promiseId','expectedRevision','amount','promisedDate','note'].includes(key))) return invalid()
  const tenantId = identity(input.tenantId), commandId = uuid(input.commandId)
  if (!['create','edit','cancel'].includes(String(input.operation))) return invalid()
  const intent: PromiseRequestIntent = { operation: input.operation as PromiseRequestIntent['operation'] }
  if (intent.operation === 'create') {
    if ('promiseId' in input || 'expectedRevision' in input) return invalid()
    intent.invoiceSourceId = identity(input.invoiceSourceId)
  } else {
    if ('invoiceSourceId' in input) return invalid()
    intent.promiseId = uuid(input.promiseId); intent.expectedRevision = revision(input.expectedRevision)
  }
  if ('amount' in input) {
    const empty = input.amount === null || input.amount === 0 || (typeof input.amount === 'string' && !input.amount.trim())
    if (empty) { if (intent.operation === 'create') return invalid(); intent.operation = 'cancel' }
    else {
      if (typeof input.amount !== 'string' || !/^\d+(?:\.\d+)?$/.test(input.amount.trim()) || input.amount.length > 100) return invalid()
      const amount = exactPromiseAmount(input.amount.trim())
      if (amount === null) return invalid()
      if (amount === '0') { if (intent.operation === 'create') return invalid(); intent.operation = 'cancel' }
      else intent.amount = amount
    }
  }
  if (intent.operation === 'cancel') {
    if (intent.amount !== undefined) return invalid()
    // Cancellation deliberately requires and consumes no date/note.
    return { tenantId, commandId, intent }
  }
  if ('promisedDate' in input) {
    if (!validPromiseDate(input.promisedDate)) return invalid()
    intent.promisedDate = input.promisedDate
  }
  if ('note' in input) {
    if (input.note !== null && (typeof input.note !== 'string' || input.note.length > 2000)) return invalid()
    intent.note = typeof input.note === 'string' ? input.note.trim() || null : null
  }
  if (intent.operation === 'create' && (!intent.amount || !intent.promisedDate)) return invalid()
  if (intent.operation === 'create') intent.note ??= null
  if (intent.operation === 'edit' && intent.amount === undefined && intent.promisedDate === undefined && intent.note === undefined) return invalid()
  return { tenantId, commandId, intent }
}

export async function authenticatePromiseTenant(tenantInput: string) {
  const tenantId = identity(tenantInput)
  const supabase = await createServerSupabaseClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) throw new InvoicePromiseOperationError('unauthorized')
  const admin = createSupabaseAdminClient()
  const access = await claimCollectionAccess({ admin, userId: user.id, tenantId, supabase })
  const entitlement = access.entitlement
  if (!entitlement.hasActionsAccess || entitlement.tenantId !== tenantId) throw new InvoicePromiseOperationError('forbidden')
  const snapshot = access.context ? snapshotFromCollectionAccessContext(access.context, { userId: user.id, tenantId })
    : await resolveXeroAuthoritativeSnapshot({ supabaseAdmin: admin, userId: user.id, tenantId })
  const currencyContext = access.context ? collectionAccessCurrencyContext(access.context)
    : await loadCollectionsCurrencyContext({ supabaseAdmin: admin, userId: user.id, tenantId, snapshot })
  if (!resolveCollectionsCurrencyAccess({ entitlement, currencyContext }).allowed) throw new InvoicePromiseOperationError('forbidden')
  return { admin, userId: user.id, tenantId, snapshot, entitlement }
}
async function rpc<T>(admin: Admin, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(name, args)
  if (error) {
    const code = error.code === 'P0002' ? 'not_found' : error.code === '55000' ? 'temporarily_unavailable' :
      ['40001','23505','23503','23514'].includes(error.code ?? '') ? 'conflict' : error.code === '22023' ? 'invalid_input' : null
    if (code) throw new InvoicePromiseOperationError(code)
    throw new Error('Promise persistence unavailable')
  }
  return data as T
}
export function promiseDTO(row: StoredPromise) {
  return { id: row.id, invoiceSourceId: row.invoice_source_id, currencyCode: row.currency_code,
    promisedAmountNative: row.promised_amount_native, qualifyingPaidAmountNative: row.qualifying_paid_amount_native,
    promisedDate: row.promised_date, note: row.note, status: row.status, revision: String(row.revision),
    createdAt: row.created_at, updatedAt: row.updated_at, resolvedAt: row.resolved_at,
    evaluatedAt: row.evaluated_at }
}
function eventDTO(row: Event) {
  return { id: row.id, sequence: row.event_sequence, type: row.event_type, occurredAt: row.occurred_at,
    effectiveAt: row.effective_at, beforeTerms: row.before_terms, afterTerms: row.after_terms, actorKind: row.actor_kind }
}
function mutationDTO(result: Committed, held: Held | null) {
  return { promise: promiseDTO(result.promise), events: result.events.map(eventDTO), replayed: result.replayed,
    invoice: held?.invoice ? { invoiceSourceId: held.invoice.source_id, currencyCode: held.invoice.transaction_currency_code,
      outstandingAmountNative: held.invoice.amount_due_native } : null }
}
/** Pure server validation/planning. SQL rechecks this exact held snapshot at commit. */
export function planPromiseMutation(held: Held, intent: PromiseRequestIntent, now: string) {
  const steps: Array<{ operation: string; payload: Record<string, unknown> }> = []
  let evaluation: Record<string, unknown> | null = null
  const row = held.promise
  if (intent.operation !== 'create' && (!row || row.status !== 'active' || row.revision !== intent.expectedRevision)) throw new InvoicePromiseOperationError('conflict')
  if (row && held.invoice && (held.invoice.customer_source_id !== row.customer_source_id || held.invoice.transaction_currency_code !== row.currency_code || held.invoice.source_system !== row.source_system)) throw new InvoicePromiseOperationError('conflict')
  if (intent.operation === 'cancel') return { steps: [{ operation: 'cancel', payload: {} }], evaluation }
  const financial = intent.operation === 'create' || intent.amount !== undefined || intent.promisedDate !== undefined
  if (!financial) return { steps: [{ operation: 'change_note', payload: { note: intent.note } }], evaluation }
  if (!held.invoice) throw new InvoicePromiseOperationError('conflict')
  let due: string
  try { due = validateDisputableInvoice(held.invoice) } catch { throw new InvoicePromiseOperationError('conflict') }
  if (!held.invoice.customer_source_id?.trim() || !normalizeCurrencyCode(held.invoice.transaction_currency_code)) throw new InvoicePromiseOperationError('conflict')
  if (!held.observation.ready) throw new InvoicePromiseOperationError('temporarily_unavailable')
  const amount = intent.amount ?? row!.promised_amount_native, date = intent.promisedDate ?? row!.promised_date
  try { new Intl.DateTimeFormat('en', { timeZone: held.observation.timezone_iana ?? '' }).format(new Date(now)) } catch { throw new InvoicePromiseOperationError('temporarily_unavailable') }
  if (!held.observation.timezone_iana) throw new InvoicePromiseOperationError('temporarily_unavailable')
  // Creation requires today/future. Editing preserves the original creation
  // window; the existing resolver alone decides an elapsed edited deadline.
  if (!derivePromiseTimeContext(intent.operation === 'create' ? now : row!.created_at, date, held.observation.timezone_iana)) return invalid()
  if (intent.operation === 'create') {
    if (compareDecimalValues(amount, due) === 1) return invalid()
    const observed = completePromiseResource(held.observation, 'payments')
    if (!observed || new Set(held.payment_ids).size !== held.payment_ids.length || held.payment_ids.some(id => !id.trim())) throw new InvoicePromiseOperationError('temporarily_unavailable')
    steps.push({ operation: 'create', payload: { source_system: 'xero', invoice_source_id: held.invoice.source_id,
      customer_source_id: held.invoice.customer_source_id, currency_code: held.invoice.transaction_currency_code,
      promised_amount_native: amount, promised_date: date, note: intent.note ?? null, creation_sync_run_id: held.sync_run_id,
      payment_baseline: { version: 1, payment_ids: held.payment_ids, observation_started_at: observed.started_at, observation_completed_at: observed.completed_at } } })
  } else {
    if (!held.evidence) throw new InvoicePromiseOperationError('temporarily_unavailable')
    const promise: PromiseLifecycleRecord = { ...row!, revision: Number(row!.revision), promised_amount_native: amount, promised_date: date }
    const qualified = qualifyPromisePayments({ promise, observation: held.observation, payments: held.evidence.payments })
    if (!qualified.valid && (qualified.reason !== 'observation_invalid' || compareDecimalValues(row!.qualifying_paid_amount_native, '0') !== 0)) throw new InvoicePromiseOperationError('temporarily_unavailable')
    const paid = qualified.valid ? qualified.qualifying_paid_amount_native! : row!.qualifying_paid_amount_native
    const remainder = sumDecimalValues([amount, `-${paid}`])!
    if (compareDecimalValues(remainder, due) === 1) return invalid()
    if (amount !== row!.promised_amount_native || date !== row!.promised_date) steps.push({ operation: 'change_terms', payload: { promised_amount_native: amount, promised_date: date } })
    if (intent.note !== undefined && intent.note !== row!.note) steps.push({ operation: 'change_note', payload: { note: intent.note } })
    const invoice = held.invoice
    const result = resolvePromiseOutcome({ promise, observation: held.observation, qualifiedPayments: qualified, cash: held.evidence.cash,
      promiseValuation: { ...invoice, invoice_source_id: invoice.source_id, currency_code: invoice.transaction_currency_code!, xero_currency_rate: typeof invoice.xero_currency_rate === 'string' ? invoice.xero_currency_rate : null, sync_run_id: held.sync_run_id } })
    if (result.transition_required && ['kept','missed','unclear'].includes(result.decision)) steps.push({ operation: 'resolve', payload: {
      status: result.decision, qualifying_paid_amount_native: result.qualifying_paid_amount_native, evaluated_sync_run_id: result.source_sync_run_id,
      evaluated_at: result.evaluated_at, resolution_reason_code: result.reason_code, resolution_contract_version: result.resolver_version,
      effective_at: result.effective_at, evidence: result.evidence } })
    else if (result.payment_evaluation_valid) evaluation = { qualifying_paid_amount_native: result.qualifying_paid_amount_native, evaluated_at: result.evaluated_at }
    if (!steps.length) return invalid()
  }
  return { steps, evaluation }
}
export async function mutateInvoicePromise(body: unknown, afterCommit?: FinancialMutationContinuation) {
  const { tenantId, commandId, intent } = parsePromiseRequest(body)
  const context = await authenticatePromiseTenant(tenantId)
  const args = { p_user: context.userId, p_tenant: tenantId, p_command: commandId, p_intent: intent }
  const replay = await rpc<Committed | null>(context.admin, 'read_invoice_promise_request', args)
  if (replay) {
    // Receipt replay never rebuilds a baseline or revalidates the old intent.
    // A scoped context read is optional when accounting is currently unavailable.
    const current = await rpc<Held>(context.admin, 'prepare_invoice_promise_request', {
      p_user: context.userId, p_tenant: tenantId, p_invoice: null, p_promise: replay.promise.id, p_financial: false,
    }).catch(() => null)
    await afterCommit?.(context, replay.promise.customer_source_id).catch(() => undefined)
    return mutationDTO(replay, current?.sync_run_id === context.snapshot.syncRunId ? current : null)
  }
  const held = await rpc<Held>(context.admin, 'prepare_invoice_promise_request', { p_user: context.userId, p_tenant: tenantId,
    p_invoice: intent.invoiceSourceId ?? null, p_promise: intent.promiseId ?? null,
    p_financial: intent.operation === 'edit' && (intent.amount !== undefined || intent.promisedDate !== undefined) })
  if (context.snapshot.mode !== 'generation') throw new InvoicePromiseOperationError('temporarily_unavailable')
  if (held.sync_run_id !== context.snapshot.syncRunId) throw new InvoicePromiseOperationError('conflict')
  const plan = planPromiseMutation(held, intent, new Date().toISOString())
  const committed = await rpc<Committed>(context.admin, 'commit_invoice_promise_request', {
    ...args, p_run: held.sync_run_id, p_digest: held.digest, p_steps: plan.steps, p_evaluation: plan.evaluation })
  const metadataOnly = Boolean(held.promise && held.promise.status === committed.promise.status &&
    held.promise.promised_amount_native === committed.promise.promised_amount_native &&
    held.promise.qualifying_paid_amount_native === committed.promise.qualifying_paid_amount_native)
  await afterCommit?.({ ...context, metadataOnly }, committed.promise.customer_source_id).catch(() => undefined)
  return mutationDTO(committed, held)
}
export async function readInvoicePromiseContext(params: { tenantId: string; invoiceSourceId: string; includeHistory?: boolean }) {
  const context = await authenticatePromiseTenant(params.tenantId)
  const rows = await rpc<StoredPromise[]>(context.admin, 'read_invoice_promises', { p_user: context.userId, p_tenant: context.tenantId,
    p_invoice: identity(params.invoiceSourceId), p_history: params.includeHistory === true, p_limit: 50 })
  return { activePromise: rows.find(row => row.status === 'active') ? promiseDTO(rows.find(row => row.status === 'active')!) : null,
    promises: rows.map(promiseDTO) }
}
export async function readInvoicePromiseHistory(params: { tenantId: string; promiseId: string }) {
  const context = await authenticatePromiseTenant(params.tenantId)
  const events = await rpc<Event[]>(context.admin, 'read_invoice_promise_history', { p_user: context.userId, p_tenant: context.tenantId, p_promise: uuid(params.promiseId), p_limit: 100 })
  return events.map(eventDTO)
}
