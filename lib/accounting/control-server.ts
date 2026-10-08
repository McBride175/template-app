import 'server-only'
import type { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { accountingFailureCode, accountingIdentity, accountingProvider, accountingRefreshTrigger, type AccountingConnectionRef, type AccountingRefreshJob, type AccountingRefreshRequest, type AccountingRefreshFailureClass, type AccountingRetrySource } from './refresh'

export type AccountingControlClient = ReturnType<typeof createSupabaseAdminClient>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export class AccountingControlError extends Error {
  constructor(readonly code: 'unauthorized' | 'invalid_input' | 'not_found' | 'unsupported_provider' | 'connection_unavailable' | 'conflict' | 'unavailable') {
    super(code); this.name = 'AccountingControlError'
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AccountingControlError('unavailable')
  return value as Record<string, unknown>
}
export function parseAccountingConnection(value: unknown): AccountingConnectionRef {
  const row = object(value)
  if (typeof row.connectionId !== 'string' || !UUID.test(row.connectionId) ||
    typeof row.ownerId !== 'string' || !UUID.test(row.ownerId) ||
    typeof row.epoch !== 'string' || !/^[1-9]\d*$/.test(row.epoch) || BigInt(row.epoch) > BigInt('9223372036854775807')) throw new AccountingControlError('unavailable')
  return { connectionId: row.connectionId, ownerId: row.ownerId, provider: accountingProvider(row.provider),
    providerOrganisationId: accountingIdentity(row.providerOrganisationId), epoch: row.epoch }
}
export function parseAccountingJob(value: unknown): AccountingRefreshJob {
  const row = object(value), connection = parseAccountingConnection(row.connection)
  if (typeof row.id !== 'string' || !UUID.test(row.id) ||
    !['queued', 'running', 'preparing', 'complete', 'retry_wait', 'reconnect_required', 'attention_required', 'cancelled'].includes(String(row.phase)) ||
    !['accounting', 'derivatives'].includes(String(row.stage)) ||
    !Number.isSafeInteger(row.attemptNumber) || Number(row.attemptNumber) < 0 ||
    !Number.isSafeInteger(row.retryCount) || Number(row.retryCount) < 0 ||
    typeof row.requestCount !== 'string' || !/^[1-9]\d*$/.test(row.requestCount) ||
    !['requestedAt', 'lastRequestedAt', 'nextEligibleAt'].every(key => typeof row[key] === 'string' && Number.isFinite(Date.parse(row[key] as string)))) throw new AccountingControlError('unavailable')
  if (row.preparationRetryCount !== undefined && (!Number.isSafeInteger(row.preparationRetryCount) || Number(row.preparationRetryCount)<0)) throw new AccountingControlError('unavailable')
  if (row.completionKind != null && !['prepared','superseded'].includes(String(row.completionKind))) throw new AccountingControlError('unavailable')
  accountingRefreshTrigger(row.trigger); accountingRefreshTrigger(row.latestTrigger)
  return { ...row, connection } as unknown as AccountingRefreshJob
}
export async function accountingControlRpc<T>(admin: AccountingControlClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(name, args)
  if (error) {
    const code = error.code === '42501' ? 'not_found' : error.code === '40001' ? 'conflict' :
      error.code === '22023' ? 'invalid_input' : error.code === '55000' ? 'connection_unavailable' : 'unavailable'
    throw new AccountingControlError(code)
  }
  if (data === null || data === undefined) throw new AccountingControlError('unavailable')
  return data as T
}
export function accountingScope(connection: AccountingConnectionRef) {
  const checked = parseAccountingConnection(connection)
  return { p_user_id: checked.ownerId, p_provider: checked.provider, p_provider_organisation_id: checked.providerOrganisationId, p_connection_epoch: checked.epoch }
}
/** Internal service boundary: connection must have been resolved for the trusted owner.
 * Browser acceptance uses requestAccountingRefresh(), which obtains getUser().
 */
export async function acceptAccountingRefresh(params: { admin: AccountingControlClient; connection: AccountingConnectionRef; request: AccountingRefreshRequest }) {
  const { request, connection } = params
  if (accountingProvider(request.provider) !== connection.provider || accountingIdentity(request.providerOrganisationId) !== connection.providerOrganisationId) throw new AccountingControlError('invalid_input')
  if (request.idempotencyKey !== undefined && (typeof request.idempotencyKey !== 'string' || !request.idempotencyKey.trim() || request.idempotencyKey !== request.idempotencyKey.trim() || request.idempotencyKey.length > 128)) throw new AccountingControlError('invalid_input')
  if (request.notBefore !== undefined && !Number.isFinite(Date.parse(request.notBefore))) throw new AccountingControlError('invalid_input')
  const result = object(await accountingControlRpc(params.admin, 'accept_accounting_refresh', {
    ...accountingScope(connection), p_connection_id: connection.connectionId, p_trigger: accountingRefreshTrigger(request.trigger),
    p_idempotency_key: request.idempotencyKey ?? null, p_not_before: request.notBefore ?? null,
  }))
  if (!['accepted', 'coalesced', 'replayed'].includes(String(result.resultCode))) throw new AccountingControlError('unavailable')
  const job = parseAccountingJob(result.job)
  assertJobScope(job, connection)
  return { resultCode: result.resultCode as 'accepted' | 'coalesced' | 'replayed', job }
}
function assertJobScope(job: AccountingRefreshJob, connection: AccountingConnectionRef) {
  if (job.connection.connectionId !== connection.connectionId || job.connection.ownerId !== connection.ownerId ||
    job.connection.provider !== connection.provider || job.connection.providerOrganisationId !== connection.providerOrganisationId) throw new AccountingControlError('unavailable')
}
export async function readAccountingRefreshControl(admin: AccountingControlClient, connection: AccountingConnectionRef) {
  const row = object(await accountingControlRpc(admin, 'read_accounting_refresh_control', {
    p_user_id: connection.ownerId, p_provider: connection.provider, p_provider_organisation_id: connection.providerOrganisationId,
  }))
  const current = parseAccountingConnection(row.connection)
  if (current.connectionId !== connection.connectionId || current.ownerId !== connection.ownerId || current.provider !== connection.provider || current.providerOrganisationId !== connection.providerOrganisationId) throw new AccountingControlError('unavailable')
  const job = row.job === null ? null : parseAccountingJob(row.job)
  if (job) assertJobScope(job, current)
  return { connection: current, invalidated: row.invalidated === true, job }
}
export async function listAccountingRefreshWork(admin: AccountingControlClient, limit = 25) {
  const rows = await accountingControlRpc<unknown[]>(admin, 'list_accounting_refresh_work', { p_limit: limit })
  if (!Array.isArray(rows)) throw new AccountingControlError('unavailable')
  return rows.map(parseAccountingJob)
}
export async function reserveAccountingRefreshDelivery(params: { admin: AccountingControlClient; job: AccountingRefreshJob; deliveryOwner: string; ttlSeconds?: number }) {
  return accountingControlRpc<{ reserved: boolean; resultCode: string; job?: AccountingRefreshJob }>(params.admin, 'reserve_accounting_refresh_delivery', {
    ...accountingScope(params.job.connection), p_job_id: params.job.id, p_delivery_owner: params.deliveryOwner, p_ttl_seconds: params.ttlSeconds ?? 60,
  })
}
export async function claimAccountingRefreshAttempt(params: { admin: AccountingControlClient; job: AccountingRefreshJob; deliveryId: string; workerId: string; ttlSeconds?: number }) {
  return accountingControlRpc<{ claimed: boolean; resultCode: string; job?: AccountingRefreshJob }>(params.admin, 'claim_accounting_refresh_attempt', {
    ...accountingScope(params.job.connection), p_job_id: params.job.id, p_delivery_id: params.deliveryId, p_worker_id: params.workerId, p_ttl_seconds: params.ttlSeconds ?? 300,
  })
}
export async function releaseAccountingRefreshDelivery(params: { admin: AccountingControlClient; job: AccountingRefreshJob; deliveryId: string; deliveryOwner: string }) {
  return accountingControlRpc<boolean>(params.admin, 'release_accounting_refresh_delivery', {
    ...accountingScope(params.job.connection), p_job_id: params.job.id, p_delivery_id: params.deliveryId, p_delivery_owner: params.deliveryOwner,
  })
}
function attempt(job: AccountingRefreshJob) {
  if (!job.attemptId || !job.workerId || !job.attemptNumber) throw new AccountingControlError('invalid_input')
  return { ...accountingScope(job.connection), p_job_id: job.id, p_attempt_id: job.attemptId, p_worker_id: job.workerId, p_attempt_number: job.attemptNumber }
}
export async function heartbeatAccountingRefreshAttempt(admin: AccountingControlClient, job: AccountingRefreshJob, ttlSeconds = 300) {
  return parseAccountingJob(await accountingControlRpc(admin, 'heartbeat_accounting_refresh_attempt', { ...attempt(job), p_ttl_seconds: ttlSeconds }))
}
export async function updateAccountingRefreshAttempt(params: {
  admin: AccountingControlClient; job: AccountingRefreshJob
  operation: 'bind_generation' | 'preparing' | 'complete' | 'fail' | 'requeue'
  failureClass?: AccountingRefreshFailureClass; failureCode?: string; retryAt?: string | null
  providerNotBefore?: string | null; retrySource?: AccountingRetrySource; generationRunId?: string
}) {
  return parseAccountingJob(await accountingControlRpc(params.admin, 'update_accounting_refresh_attempt', {
    ...attempt(params.job), p_operation: params.operation, p_failure_class: params.failureClass ?? null,
    p_failure_code: params.failureClass ? accountingFailureCode(params.failureCode) : null, p_retry_at: params.retryAt ?? null,
    p_provider_not_before: params.providerNotBefore ?? null, p_retry_source: params.retrySource ?? 'none', p_generation_run_id: params.generationRunId ?? null,
  }))
}
export async function advanceAccountingRefreshEpoch(params: { admin: AccountingControlClient; connection: AccountingConnectionRef; reason: 'disconnect' | 'reconnect' | 'credential_relink' | 'organisation_changed' }) {
  const scope = accountingScope(params.connection)
  const row = await accountingControlRpc(params.admin, 'advance_accounting_refresh_epoch', {
    p_connection_id: params.connection.connectionId, p_user_id: scope.p_user_id, p_provider: scope.p_provider,
    p_provider_organisation_id: scope.p_provider_organisation_id, p_expected_epoch: scope.p_connection_epoch, p_reason: params.reason,
  })
  return parseAccountingConnection(row)
}
export async function cancelAccountingRefresh(admin: AccountingControlClient, job: AccountingRefreshJob) {
  return parseAccountingJob(await accountingControlRpc(admin, 'cancel_accounting_refresh', { ...accountingScope(job.connection), p_job_id: job.id }))
}
export async function recoverAccountingRefreshWork(admin: AccountingControlClient, limit = 25) {
  return accountingControlRpc<number>(admin, 'recover_accounting_refresh_work', { p_limit: limit })
}
export async function setAccountingRefreshSchedule(params: { admin: AccountingControlClient; connection: AccountingConnectionRef; activityKind?: 'dashboard' | 'queue' | 'customer' | 'collection_action'; nextDueAt: string | null }) {
  return accountingControlRpc(params.admin, 'set_accounting_refresh_schedule', {
    ...accountingScope(params.connection), p_connection_id: params.connection.connectionId, p_activity_kind: params.activityKind ?? null, p_next_due_at: params.nextDueAt,
  })
}
