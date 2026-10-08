import 'server-only'
import type { AccountingRefreshFailureClass, AccountingRefreshJob } from './refresh'
import type { AccountingControlClient } from './control-server'
import type { AccountingAttemptController } from './attempt-controller'
import { executeXeroAccountingRefresh } from '@/lib/xero/accounting-refresh-execution'

export type AccountingProviderResult =
  | { kind: 'promoted'; runId: string; recovered: boolean }
  | { kind: 'joined_existing'; runId: string | null; retryNotBefore: string | null }
  | { kind: 'authority_lost' }
  | { kind: 'failure'; failureClass: AccountingRefreshFailureClass; code: string; retryAfterSeconds?: number | null }

export interface AccountingProviderExecution {
  admin: AccountingControlClient
  job: AccountingRefreshJob
  authority: AccountingAttemptController
  deadlineAtMs: number
  bookkeepingAtMs: number
}

/** The only connector selection seam. Dispatch/retry/claims know no Xero API. */
export async function executeAccountingProvider(params: AccountingProviderExecution): Promise<AccountingProviderResult> {
  if (params.job.connection.provider !== 'xero') return { kind: 'failure', failureClass: 'deterministic_failure', code: 'unsupported_provider' }
  return executeXeroAccountingRefresh(params)
}
