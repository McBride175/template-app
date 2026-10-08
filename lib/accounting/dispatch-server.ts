import 'server-only'
import { acceptAccountingRefresh, accountingControlRpc, type AccountingControlClient } from './control-server'
import type { AccountingConnectionRef, AccountingRefreshRequest } from './refresh'

export interface AccountingDispatchResult {
  resultCode: string; submitted: number; durationMs?: number; occupied?: number; freeSlots?: number
  eligible?: number; recoveredDeliveries?: number; recoveredAttempts?: number
}
export function accountingTransportEvent(event: string, fields: Record<string, string | number | boolean | null> = {}) {
  // Only callers' explicit operational fields; never request headers/bodies/errors.
  console.info('[accounting.refresh]', { event, ...fields })
}
export async function dispatchAccountingRefresh(admin: AccountingControlClient, source: 'immediate' | 'completion' | 'internal' = 'internal') {
  const result = await accountingControlRpc<AccountingDispatchResult>(admin, 'dispatch_accounting_refresh', { p_source: source })
  accountingTransportEvent('dispatch', { source, result: result.resultCode, submitted: result.submitted })
  return result
}
/** Acceptance commits in its own RPC before the optional dispatch RPC starts.
 * No caller needs to stay alive after acceptance. Cron recovers a missed signal.
 * Kept separate from Phase 7.1/live routes until their later wiring.
 */
export async function signalAccountingRefresh(params: {
  admin: AccountingControlClient; connection: AccountingConnectionRef; request: AccountingRefreshRequest; skipImmediate?: boolean
}) {
  const accepted = await acceptAccountingRefresh(params)
  let dispatch: 'submitted' | 'deferred' = 'deferred'
  if (!params.skipImmediate) {
    try { await dispatchAccountingRefresh(params.admin, 'immediate'); dispatch = 'submitted' }
    catch { accountingTransportEvent('immediate_signal_deferred', { jobId: accepted.job.id }) }
  }
  return { resultCode: accepted.resultCode, jobId: accepted.job.id, phase: accepted.job.phase, dispatch }
}
