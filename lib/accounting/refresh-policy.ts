import type { AccountingFreshnessBand, AccountingRefreshFailureClass, AccountingRetrySource } from './refresh'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
function instant(value: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}
function clock(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new TypeError('Invalid accounting clock')
  return now.getTime()
}
/** Exact boundaries: 2h aging, 6h material, strictly over 24h very/7d extended.
 * Age alone never makes valid accounting unusable. Future timestamps fail closed.
 */
export function classifyAccountingFreshness(params: { valid: boolean; observedAt: string | null; now: Date }): {
  band: AccountingFreshnessBand; ageSeconds: number | null
} {
  const now = clock(params.now), observed = instant(params.observedAt)
  if (!params.valid || observed === null || observed > now) return { band: 'unusable', ageSeconds: null }
  const age = now - observed
  const band = age < 2 * HOUR ? 'fresh' : age < 6 * HOUR ? 'aging_usable' : age <= DAY ? 'materially_stale' : age <= 7 * DAY ? 'very_stale' : 'extended_stale'
  return { band, ageSeconds: Math.floor(age / 1000) }
}
export interface AccountingRetryPlan {
  phase: 'retry_wait' | 'reconnect_required' | 'attention_required'
  retryCount: number
  nextEligibleAt: string | null
  source: AccountingRetrySource
}
/** A pure proposal, not a runtime retry engine. SQL still fences the update and
 * takes the maximum of existing/provider cooldowns. Count is prior failures.
 */
export function planAccountingRetry(params: {
  failureClass: AccountingRefreshFailureClass
  retryCount: number
  now: Date
  providerNotBefore?: string | null
  random?: () => number
}): AccountingRetryPlan {
  if (!['transient', 'rate_limited', 'quota_limited', 'reconnect_required', 'deterministic_failure', 'preparation_failure', 'unknown'].includes(params.failureClass)) throw new TypeError('Invalid failure class')
  if (!Number.isSafeInteger(params.retryCount) || params.retryCount < 0) throw new TypeError('Invalid retry count')
  const now = clock(params.now), count = params.retryCount + 1
  if (!Number.isSafeInteger(count)) throw new TypeError('Retry count exhausted')
  if (params.failureClass === 'reconnect_required') return { phase: 'reconnect_required', retryCount: count, nextEligibleAt: null, source: 'none' }
  if (params.failureClass === 'deterministic_failure' || params.failureClass === 'unknown') return { phase: 'attention_required', retryCount: count, nextEligibleAt: null, source: 'none' }
  const preparation = params.failureClass === 'preparation_failure'
  const steps = preparation ? [1, 5, 15, 60] : [5, 15, 60]
  if (preparation && params.retryCount >= steps.length) return { phase: 'attention_required', retryCount: count, nextEligibleAt: null, source: 'none' }
  const probe = params.retryCount >= steps.length
  const sample = (params.random ?? Math.random)()
  if (!Number.isFinite(sample) || sample < 0 || sample > 1) throw new TypeError('Invalid retry jitter')
  const local = now + Math.round((probe ? 360 : steps[params.retryCount]) * MINUTE * (probe ? 1 : 0.9 + sample * 0.2))
  const provider = instant(params.providerNotBefore ?? null)
  if (params.providerNotBefore && provider === null) throw new TypeError('Invalid provider retry time')
  // Missing quota reset is not guessed to be five minutes: conservatively probe in six hours.
  const quota = params.failureClass === 'quota_limited' && provider === null ? now + 6 * HOUR : local
  const next = Math.max(local, quota, provider ?? 0)
  return { phase: 'retry_wait', retryCount: count, nextEligibleAt: new Date(next).toISOString(),
    source: provider !== null && provider >= Math.max(local, quota) ? 'provider' : probe || quota > local ? 'probe' : 'local' }
}
export type MeaningfulAccountingActivity = 'dashboard' | 'queue' | 'customer' | 'collection_action'
export function isMeaningfulAccountingActivity(value: string): value is MeaningfulAccountingActivity {
  return ['dashboard', 'queue', 'customer', 'collection_action'].includes(value)
}
/** Cadence metadata only: no scheduler, auth sign-in inference or usage claim. */
export function accountingRefreshCadence(params: { lastProductActivityAt: string | null; now: Date; dormantAfterDays?: number; dormantIntervalHours?: number | null }) {
  const now = clock(params.now), active = instant(params.lastProductActivityAt)
  if (active !== null && active > now) throw new TypeError('Product activity is in the future')
  if (params.lastProductActivityAt && active === null) throw new TypeError('Invalid product activity')
  const age = active === null ? Infinity : now - active
  if (age <= 7 * DAY) return { band: 'active' as const, intervalSeconds: 3600 }
  const dormantAfter = params.dormantAfterDays ?? 30
  const dormantHours = params.dormantIntervalHours === undefined ? 24 : params.dormantIntervalHours
  if (!Number.isFinite(dormantAfter) || dormantAfter < 7 || (dormantHours !== null && (!Number.isFinite(dormantHours) || dormantHours < 24))) throw new TypeError('Invalid dormant cadence')
  if (age > dormantAfter * DAY) return { band: 'dormant' as const, intervalSeconds: dormantHours === null ? null : dormantHours * 3600 }
  return { band: 'inactive' as const, intervalSeconds: 86400 }
}
