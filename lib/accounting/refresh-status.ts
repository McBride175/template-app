import { accountingFailureCode, type AccountingAuthority, type AccountingConnectionHealth, type AccountingConnectionRef, type AccountingRefreshJob, type AccountingRefreshStatus } from './refresh'
import { classifyAccountingFreshness } from './refresh-policy'

/** Control work never substitutes for promoted accounting or derivative proof. */
export function deriveAccountingRefreshStatus(params: {
  connection: AccountingConnectionRef
  health: AccountingConnectionHealth
  authority: AccountingAuthority
  job: AccountingRefreshJob | null
  now: Date
}): AccountingRefreshStatus {
  const { connection, job, authority } = params
  if (job && (job.connection.connectionId !== connection.connectionId || job.connection.ownerId !== connection.ownerId ||
    job.connection.provider !== connection.provider || job.connection.providerOrganisationId !== connection.providerOrganisationId)) throw new Error('Accounting refresh status scope mismatch')
  const freshness = classifyAccountingFreshness({ valid: authority.state === 'valid', observedAt: authority.accountingObservedAt, now: params.now })
  return {
    connection: { provider: connection.provider, providerOrganisationId: connection.providerOrganisationId, epoch: connection.epoch, health: params.health },
    accounting: { ...authority, ageSeconds: freshness.ageSeconds, freshness: freshness.band },
    work: { phase: job?.phase ?? 'idle', stage: job?.stage ?? null, preparationRetryCount: job?.preparationRetryCount ?? 0,
      activity: job?.phase === 'complete' ? (job.completionKind === 'superseded' ? 'superseded' : 'updated') :
        job?.stage === 'derivatives' ? (job.phase === 'retry_wait' ? 'preparation_retry' : job.phase === 'attention_required' ? 'preparation_attention' : 'preparing_priorities') :
          job && ['queued','running','retry_wait'].includes(job.phase) ? 'refreshing_accounting' : 'idle', jobId: job?.id ?? null, trigger: job?.trigger ?? null,
      requestedAt: job?.requestedAt ?? null, startedAt: job?.claimedAt ?? null, heartbeatAt: job?.heartbeatAt ?? null,
      completedAt: job?.completedAt ?? null, attemptNumber: job?.attemptNumber ?? 0, retryCount: job?.retryCount ?? 0 },
    failure: job?.failureClass && job.failedAt ? { category: job.failureClass, code: accountingFailureCode(job.failureCode),
      occurredAt: job.failedAt, nextRetryAt: job.phase === 'retry_wait' ? job.nextEligibleAt : null } : null,
  }
}
