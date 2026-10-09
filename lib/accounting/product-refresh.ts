import type { AccountingRefreshStatus } from './refresh'
export type ProductRefreshTrigger = 'opportunistic' | 'manual' | 'onboarding' | 'reconnect'
export type ProductRefreshOutcome = 'started' | 'already_running' | 'preparing' | 'not_due' | 'cooldown' | 'retry_wait' | 'reconnect_required' | 'attention_required' | 'current'
export type ProductAccountingStatus = Omit<AccountingRefreshStatus, 'connection' | 'work'> & {
 connection: Omit<AccountingRefreshStatus['connection'], 'epoch'> & { displayName: string }
 work: Omit<AccountingRefreshStatus['work'], 'heartbeatAt' | 'attemptNumber' | 'retryCount' | 'preparationRetryCount'>
}
export interface ProductRefreshResponse {
 outcome: ProductRefreshOutcome
 jobId: string | null
 phase: AccountingRefreshStatus['work']['phase']
 nextEligibleAt: string | null
}
export function productAccountingStatus(status: AccountingRefreshStatus): ProductAccountingStatus {
 return { accounting:status.accounting,failure:status.failure,
  connection:{provider:status.connection.provider,providerOrganisationId:status.connection.providerOrganisationId,health:status.connection.health,displayName:status.connection.provider==='xero'?'Xero':status.connection.provider},
  work:{phase:status.work.phase,stage:status.work.stage,activity:status.work.activity,jobId:status.work.jobId,trigger:status.work.trigger,requestedAt:status.work.requestedAt,startedAt:status.work.startedAt,completedAt:status.work.completedAt} }

}
export function accountingWorkActive(status: ProductAccountingStatus | null) {
 return Boolean(status && ['queued','running','preparing'].includes(status.work.phase))
}
export function accountingFirstValueReady(status: ProductAccountingStatus | null) {
 return Boolean(status && status.accounting.state === 'valid' && status.accounting.derivatives.state === 'ready' &&
  ['idle','complete','cancelled'].includes(status.work.phase))
}
/** Activity is navigation to actual product surfaces, never polling or timers. */
export function accountingProductSurface(pathname: string) {
 if (pathname === '/dashboard') return 'dashboard'
 if (pathname === '/collections/actions') return 'priorities'
 if (pathname === '/customers' || pathname.startsWith('/customers/')) return 'customers'
 if (pathname === '/disputes') return 'disputes'
 return null
}
