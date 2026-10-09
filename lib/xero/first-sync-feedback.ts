import type { XeroConnectionStatus } from '@/lib/xero/account-status'
/** Compatibility onboarding admission hint. Durable completion is observed through
 * the provider-neutral accounting status, never inferred from this hint. */
export function shouldObserveFirstXeroSync(status: XeroConnectionStatus) {
 return status.connected && status.lastSyncedAt === null
}
