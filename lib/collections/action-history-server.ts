import 'server-only'

import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { claimCollectionAccess } from '@/lib/collections/access-context-server'
import { resolveXeroAuthoritativeSnapshot, applyXeroAuthoritativeSnapshot, snapshotFromCollectionAccessContext } from '@/lib/xero/authoritative-snapshot'
import { normalizeXeroOrganisationTimezone } from '@/lib/xero/organisation-timezone'
import {
  ActionHistoryInputError, dateOnly, decodeHistoryCursor, encodeHistoryCursor,
  followUpDate, identity, note, outcome, pageSize, sourceSystem, uuid,
} from '@/lib/collections/action-history'

type Admin = ReturnType<typeof createSupabaseAdminClient>

const ACTION_COLUMNS = 'id, user_id, tenant_id, source_system, customer_source_id, action_type, outcome, action_timestamp, created_at, note, next_action_date'

interface ActionRow {
  id: string
  user_id: string
  tenant_id: string
  source_system: string
  customer_source_id: string
  action_type: string
  outcome: string
  action_timestamp: string
  created_at: string
  note: string | null
  next_action_date: string
}

export class ActionHistoryOperationError extends Error {
  constructor(readonly code: 'unauthorized' | 'forbidden' | 'not_found' | 'conflict') {
    super(code)
    this.name = 'ActionHistoryOperationError'
  }
}

function actionDTO(row: ActionRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sourceSystem: row.source_system,
    customerSourceId: row.customer_source_id,
    outcome: row.outcome,
    actionTimestamp: row.action_timestamp,
    createdAt: row.created_at,
    note: row.note,
    nextActionDate: row.next_action_date,
  }
}

async function authenticate(tenantValue: unknown) {
  const tenantId = identity(tenantValue, 'tenant_id')
  const supabase = await createServerSupabaseClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) throw new ActionHistoryOperationError('unauthorized')
  const admin = createSupabaseAdminClient()
  const access = await claimCollectionAccess({ admin, userId: user.id, tenantId, supabase })
  const entitlement = access.entitlement
  // The tenant resolver may choose another connected tenant as fallback.
  if (entitlement.tenantId !== tenantId || !entitlement.hasActionsAccess) {
    throw new ActionHistoryOperationError('forbidden')
  }
  return { admin, userId: user.id, tenantId, entitlement, accessContext: access.context }
}

export type ActionHistoryCommandContext = Awaited<ReturnType<typeof authenticate>>
type AfterCommit = (context: ActionHistoryCommandContext) => Promise<Record<string, unknown>>
async function withCommittedProjection<T extends Record<string, unknown>>(
  result: T, context: ActionHistoryCommandContext, afterCommit?: AfterCommit
) {
  return afterCommit ? { ...result, ...await afterCommit(context) } : result
}

function scopedActions(admin: Admin, userId: string, tenantId: string, customerSourceId: string) {
  return admin.from('collection_actions').select(ACTION_COLUMNS)
    .eq('user_id', userId).eq('tenant_id', tenantId)
    .eq('source_system', 'xero').eq('customer_source_id', customerSourceId)
    .eq('action_type', 'outcome')
}

async function findActionById(admin: Admin, id: string, userId: string, tenantId: string) {
  const { data, error } = await admin.from('collection_actions').select(ACTION_COLUMNS)
    .eq('id', id).eq('user_id', userId).eq('tenant_id', tenantId)
    .maybeSingle<ActionRow>()
  if (error) throw error
  return data
}

async function assertOwnedCurrentCustomer(admin: Admin, userId: string, tenantId: string, customerSourceId: string, context?: ActionHistoryCommandContext) {
  const snapshot = context?.accessContext ? snapshotFromCollectionAccessContext(context.accessContext, { userId, tenantId }) : await resolveXeroAuthoritativeSnapshot({ supabaseAdmin: admin, userId, tenantId })
  const { data, error } = await applyXeroAuthoritativeSnapshot(
    admin.from('canonical_customers').select('source_id')
      .eq('user_id', userId).eq('tenant_id', tenantId)
      .eq('source_system', 'xero').eq('source_id', customerSourceId),
    snapshot
  ).maybeSingle<{ source_id: string }>()
  if (error) throw error
  if (!data) throw new ActionHistoryOperationError('not_found')
  return snapshot
}

async function organisationTimezone(admin: Admin, userId: string, tenantId: string,
  snapshot: Awaited<ReturnType<typeof resolveXeroAuthoritativeSnapshot>>) {
  const { data, error } = await applyXeroAuthoritativeSnapshot(
    admin.from('canonical_organisations').select('source_timezone, country_code')
      .eq('user_id', userId).eq('tenant_id', tenantId).eq('source_system', 'xero'),
    snapshot
  ).order('source_retrieved_at', { ascending: false }).limit(1)
  if (error) throw error
  const organisation = data?.[0]
  return normalizeXeroOrganisationTimezone(
    organisation?.source_timezone ?? null, organisation?.country_code ?? null
  )
}

export async function createActionHistory(input: Record<string, unknown>, now = new Date(), afterCommit?: AfterCommit) {
  const id = uuid(input.action_id, 'action_id')
  const tenantId = identity(input.tenant_id, 'tenant_id')
  const customerSourceId = identity(input.customer_source_id, 'customer_source_id')
  sourceSystem(input.source_system)
  const selectedOutcome = outcome(input.outcome)
  const actionNote = note(input.note)
  const explicitDate = input.next_action_date === undefined || input.next_action_date === null
    ? null : dateOnly(input.next_action_date)
  const context = await authenticate(tenantId)

  // The caller keeps this UUID across uncertain retries. Read the original
  // result before computing a new tomorrow, including a retry after midnight.
  const existing = await findActionById(context.admin, id, context.userId, tenantId)
  if (existing) {
    if (existing.user_id !== context.userId || existing.tenant_id !== tenantId ||
      existing.source_system !== 'xero' || existing.customer_source_id !== customerSourceId ||
      existing.action_type !== 'outcome' || existing.outcome !== selectedOutcome ||
      existing.note !== actionNote ||
      (explicitDate !== null && existing.next_action_date !== explicitDate)) {
      throw new ActionHistoryOperationError('conflict')
    }
    return withCommittedProjection({ action: actionDTO(existing), replayed: true }, context, afterCommit)
  }

  const snapshot = await assertOwnedCurrentCustomer(context.admin, context.userId, tenantId, customerSourceId, context)
  const timezone = context.accessContext ? normalizeXeroOrganisationTimezone(context.accessContext.organisation?.source_timezone, context.accessContext.organisation?.country_code) : await organisationTimezone(context.admin, context.userId, tenantId, snapshot)
  const schedule = followUpDate(explicitDate, timezone, now)
  const { data, error } = await context.admin.from('collection_actions').insert({
    id, user_id: context.userId, tenant_id: tenantId, source_system: 'xero',
    customer_source_id: customerSourceId, action_type: 'outcome',
    outcome: selectedOutcome, note: actionNote, next_action_date: schedule.date,
  }).select(ACTION_COLUMNS).single<ActionRow>()
  if (error?.code === '23505') {
    const raced = await findActionById(context.admin, id, context.userId, tenantId)
    if (raced && raced.user_id === context.userId && raced.tenant_id === tenantId &&
      raced.source_system === 'xero' && raced.customer_source_id === customerSourceId &&
      raced.action_type === 'outcome' && raced.outcome === selectedOutcome &&
      raced.note === actionNote &&
      (explicitDate === null || raced.next_action_date === explicitDate)) {
      return withCommittedProjection({ action: actionDTO(raced), replayed: true }, context, afterCommit)
    }
    throw new ActionHistoryOperationError('conflict')
  }
  if (error || !data) throw error ?? new Error('Action creation returned no row')
  return withCommittedProjection({ action: actionDTO(data), replayed: false }, context, afterCommit)
}

export async function readLatestActionHistory(input: Record<string, unknown>) {
  const customerSourceId = identity(input.customer_source_id, 'customer_source_id')
  sourceSystem(input.source_system)
  const context = await authenticate(input.tenant_id)
  const { data, error } = await scopedActions(context.admin, context.userId, context.tenantId, customerSourceId)
    .order('action_timestamp', { ascending: false }).order('id', { ascending: false })
    .limit(1).maybeSingle<ActionRow>()
  if (error) throw error
  return data ? actionDTO(data) : null
}

export async function readCustomerActionHistory(input: Record<string, unknown>) {
  const customerSourceId = identity(input.customer_source_id, 'customer_source_id')
  sourceSystem(input.source_system)
  const limit = pageSize(input.limit)
  const cursor = decodeHistoryCursor(input.cursor)
  const context = await authenticate(input.tenant_id)
  let query = scopedActions(context.admin, context.userId, context.tenantId, customerSourceId)
  if (cursor) {
    query = query.or(`action_timestamp.lt.${cursor.actionTimestamp},and(action_timestamp.eq.${cursor.actionTimestamp},id.lt.${cursor.id})`)
  }
  const { data, error } = await query.order('action_timestamp', { ascending: false })
    .order('id', { ascending: false }).limit(limit + 1)
  if (error) throw error
  const rows = (data ?? []) as ActionRow[]
  const page = rows.slice(0, limit)
  const last = page.at(-1)
  return {
    actions: page.map(actionDTO),
    nextCursor: rows.length > limit && last
      ? encodeHistoryCursor({ actionTimestamp: last.action_timestamp, id: last.id }) : null,
  }
}

export async function deleteActionHistory(input: Record<string, unknown>, afterCommit?: AfterCommit) {
  const id = uuid(input.action_id, 'action_id')
  const customerSourceId = identity(input.customer_source_id, 'customer_source_id')
  sourceSystem(input.source_system)
  const context = await authenticate(input.tenant_id)
  const { data, error } = await context.admin.from('collection_actions').delete()
    .eq('id', id).eq('user_id', context.userId).eq('tenant_id', context.tenantId)
    .eq('source_system', 'xero').eq('customer_source_id', customerSourceId)
    .eq('action_type', 'outcome').select('id').maybeSingle<{ id: string }>()
  if (error) throw error
  // Repeating the same deletion is successful and reveals no foreign row.
  return withCommittedProjection({ deleted: Boolean(data), actionId: id }, context, afterCommit)
}

export { ActionHistoryInputError }
