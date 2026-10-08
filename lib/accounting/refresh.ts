/** Provider identifiers are opaque slugs, not SDK implementations or a registry. */
export type AccountingProvider = string
export const IMPLEMENTED_ACCOUNTING_PROVIDER = 'xero'
export type AccountingRevision = string

export interface AccountingConnectionRef {
  readonly connectionId: string
  readonly ownerId: string
  readonly provider: AccountingProvider
  readonly providerOrganisationId: string
  readonly epoch: AccountingRevision
}
export type AccountingConnectionHealth = 'healthy' | 'reconnect_required' | 'disconnected' | 'attention_required'
export type AccountingRefreshTrigger = 'scheduled' | 'opportunistic' | 'manual' | 'onboarding' | 'reconnect' | 'internal'
export type AccountingRefreshPhase = 'queued' | 'running' | 'preparing' | 'complete' | 'retry_wait' | 'reconnect_required' | 'attention_required' | 'cancelled'
export type AccountingRefreshFailureClass = 'transient' | 'rate_limited' | 'quota_limited' | 'reconnect_required' | 'deterministic_failure' | 'preparation_failure' | 'unknown'
export type AccountingRetrySource = 'local' | 'provider' | 'probe' | 'none'
export interface AccountingRefreshRequest {
  provider: AccountingProvider
  providerOrganisationId: string
  trigger: AccountingRefreshTrigger
  idempotencyKey?: string
  notBefore?: string
}
export interface AccountingRefreshJob {
  id: string
  connection: AccountingConnectionRef
  phase: AccountingRefreshPhase
  stage: 'accounting' | 'derivatives'
  trigger: AccountingRefreshTrigger
  latestTrigger: AccountingRefreshTrigger
  priority: number
  requestCount: AccountingRevision
  requestedAt: string
  lastRequestedAt: string
  nextEligibleAt: string
  claimedAt: string | null
  heartbeatAt: string | null
  completedAt: string | null
  failedAt: string | null
  attemptNumber: number
  retryCount: number
  preparationRetryCount?: number
  completionKind?: 'prepared' | 'superseded' | null
  failureClass: AccountingRefreshFailureClass | null
  failureCode: string | null
  retrySource: AccountingRetrySource
  providerNotBefore: string | null
  generationRunId: string | null
  /** Internal transport/attempt authority; omitted from the public status DTO. */
  deliveryId: string | null
  deliveryOwner: string | null
  deliveryExpiresAt: string | null
  lastReservedAt: string | null
  attemptId: string | null
  workerId: string | null
  attemptExpiresAt: string | null
}
export interface AccountingAuthority {
  state: 'valid' | 'missing' | 'unavailable'
  mode: 'generation' | 'legacy' | null
  activeGenerationId: string | null
  lastSuccessfulRefreshAt: string | null
  accountingObservedAt: string | null
  derivatives: {
    state: 'ready' | 'preparing' | 'unavailable' | 'not_applicable'
    generationId: string | null
    financialEpoch: AccountingRevision | null
    evaluationDate: string | null
  }
}
export type AccountingFreshnessBand = 'fresh' | 'aging_usable' | 'materially_stale' | 'very_stale' | 'extended_stale' | 'unusable'
export interface AccountingRefreshStatus {
  connection: { provider: AccountingProvider; providerOrganisationId: string; epoch: AccountingRevision; health: AccountingConnectionHealth }
  accounting: AccountingAuthority & { ageSeconds: number | null; freshness: AccountingFreshnessBand }
  work: {
    phase: 'idle' | AccountingRefreshPhase
    stage: 'accounting' | 'derivatives' | null
    activity: 'idle' | 'refreshing_accounting' | 'preparing_priorities' | 'preparation_retry' | 'preparation_attention' | 'updated' | 'superseded'
    preparationRetryCount: number
    jobId: string | null
    trigger: AccountingRefreshTrigger | null
    requestedAt: string | null
    startedAt: string | null
    heartbeatAt: string | null
    completedAt: string | null
    attemptNumber: number
    retryCount: number
  }
  failure: { category: AccountingRefreshFailureClass; code: string; occurredAt: string; nextRetryAt: string | null } | null
}

export const ACCOUNTING_TRIGGER_PRIORITY: Record<AccountingRefreshTrigger, number> = {
  onboarding: 60, manual: 50, reconnect: 40, internal: 30, opportunistic: 20, scheduled: 10,
}
export function isTerminalAccountingRefresh(phase: AccountingRefreshPhase) {
  return phase === 'complete' || phase === 'cancelled'
}
export function accountingProvider(value: unknown): AccountingProvider {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(value)) throw new TypeError('Invalid accounting provider')
  return value
}
export function accountingIdentity(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 500) throw new TypeError('Invalid accounting identity')
  return value
}
export function accountingRefreshTrigger(value: unknown): AccountingRefreshTrigger {
  if (typeof value !== 'string' || !Object.hasOwn(ACCOUNTING_TRIGGER_PRIORITY, value)) throw new TypeError('Invalid accounting trigger')
  return value as AccountingRefreshTrigger
}
export function accountingFailureCode(value: unknown): string {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : 'unknown_failure'
}
