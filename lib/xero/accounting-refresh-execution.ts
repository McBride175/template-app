import 'server-only'
import { randomUUID } from 'node:crypto'
import * as Sentry from '@sentry/nextjs'
import { accountingControlRpc } from '@/lib/accounting/control-server'
import { resolveAccountingConnection } from '@/lib/accounting/connection-server'
import { accountingTransportEvent } from '@/lib/accounting/dispatch-server'
import type { AccountingProviderExecution, AccountingProviderResult } from '@/lib/accounting/provider-execution'
import { executeXeroAccountingGeneration } from './generation-sync'
import { heartbeatXeroGenerationRun } from './generation-run'

const failureClasses: Record<string, Extract<AccountingProviderResult, { kind: 'failure' }>['failureClass']> = {
  XERO_REAUTH_REQUIRED: 'reconnect_required', XERO_NOT_CONNECTED: 'reconnect_required',
  XERO_PERMISSION_UPGRADE_REQUIRED: 'reconnect_required',
  XERO_RATE_LIMITED: 'rate_limited', XERO_DAILY_LIMIT_REACHED: 'quota_limited',
  XERO_PROVIDER_UNAVAILABLE: 'transient', XERO_PROVIDER_TIMEOUT: 'transient', XERO_SYNC_DEADLINE: 'transient',
  XERO_CONNECTION_UNAVAILABLE: 'transient', XERO_SYNC_CANCELLED: 'transient', XERO_GENERATION_LEASE_LOST: 'transient',
  XERO_PROVIDER_DATA_INVALID: 'deterministic_failure', XERO_GENERATION_VALIDATION_FAILED: 'deterministic_failure',
  XERO_GENERATION_PROMOTION_REJECTED: 'deterministic_failure',
}
export function classifyXeroRefreshFailure(code: string, retryAfterSeconds?: number | null): AccountingProviderResult {
  return { kind: 'failure', failureClass: failureClasses[code] ?? 'unknown',
    code: /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code.toLowerCase() : 'xero_internal_failure', retryAfterSeconds }
}

/** Wrap the mature domain engine; no HTTP call to another Yuohme route. */
export async function executeXeroAccountingRefresh(params: AccountingProviderExecution): Promise<AccountingProviderResult> {
  const { admin, job, authority } = params, connection = job.connection
  const start = Date.now(), leaseOwner = randomUUID()
  const args = { p_job_id: job.id, p_attempt_id: job.attemptId, p_worker_id: job.workerId,
    p_attempt_number: job.attemptNumber, p_connection_epoch: connection.epoch }
  const inspect = () => accountingControlRpc<{ resultCode: string; runId: string | null; leaseExpiresAt?: string | null }>(admin,
    'inspect_accounting_xero_result', { p_job_id: job.id, p_connection_epoch: connection.epoch })
  const recovered = async (): Promise<AccountingProviderResult | null> => {
    const exact = await inspect()
    accountingTransportEvent('exact_run_inspected', { jobId: job.id, runId: exact.runId, resultCode: exact.resultCode })
    return exact.resultCode === 'promoted' && exact.runId ? { kind: 'promoted', runId: exact.runId, recovered: true } : null
  }
  const assertAuthority = async () => {
    authority.assertOwned()
    if (Date.now() >= params.bookkeepingAtMs || Date.now() >= params.deadlineAtMs) throw new Error('accounting_deadline_exhausted')
    await authority.renewNow() // checks exact epoch/attempt, then generation
  }
  let requests = 0, retries = 0, promiseProposals = 0, promiseRecomputations = 0
  let metrics: Record<string, number> | null = null
  try {
    const resolved = await resolveAccountingConnection({ admin, authenticatedOwnerId: connection.ownerId,
      provider: connection.provider, providerOrganisationId: connection.providerOrganisationId })
    if (resolved.connection.connectionId !== connection.connectionId || resolved.connection.epoch !== connection.epoch) return { kind: 'authority_lost' }
    if (resolved.health !== 'healthy') return classifyXeroRefreshFailure(resolved.health === 'attention_required' ? 'XERO_CONNECTION_UNAVAILABLE' : 'XERO_REAUTH_REQUIRED')
    const previous = await recovered()
    if (previous) return previous
    await assertAuthority()
    accountingTransportEvent('provider_execution_started', { jobId: job.id, provider: 'xero', epoch: connection.epoch, deadlineRemainingMs: params.deadlineAtMs - Date.now() })
    const response = await executeXeroAccountingGeneration({
      userId: connection.ownerId, tenantId: connection.providerOrganisationId, supabaseAdmin: admin,
      execution: { leaseOwner, assertAuthority, onPublicationEvent: event => {
        if (event.stage === 'prepared') { promiseProposals = event.proposalCount; promiseRecomputations = event.attempt - 1 }
        accountingTransportEvent('promise_publication', { jobId: job.id, ...event })
      }, importOptions: {
        signal: authority.signal, deadlineAtMs: params.deadlineAtMs, externalLease: authority,
        dependencies: {
          acquireRun: async () => {
            const rows = await accountingControlRpc<Record<string, unknown>[]>(admin, 'acquire_accounting_xero_run', { ...args, p_lease_owner: leaseOwner })
            const row = rows[0]
            if (!row || typeof row.acquired !== 'boolean' || typeof row.result_code !== 'string') throw new Error('invalid_generation_acquisition')
            const runId = typeof row.sync_run_id === 'string' ? row.sync_run_id : null
            const fence = row.fencing_token == null ? null : Number(row.fencing_token)
            if (row.acquired) {
              if (!runId || !Number.isSafeInteger(fence) || !fence) throw new Error('invalid_generation_authority')
              authority.attachProvider(async () => {
                const renewed = await heartbeatXeroGenerationRun({ syncRunId: runId, leaseOwner, fencingToken: fence,
                  leaseTtlSeconds: 300, supabaseAdmin: admin })
                if (!renewed.renewed) throw new Error('generation_authority_lost')
                accountingTransportEvent('generation_heartbeat', { jobId: job.id, runId, fencingToken: fence })
              })
              accountingTransportEvent('generation_bound', { jobId: job.id, attemptId: job.attemptId, runId, fencingToken: fence })
            }
            return { acquired: row.acquired, resultCode: row.result_code, syncRunId: runId, fencingToken: fence,
              leaseExpiresAt: typeof row.lease_expires_at === 'string' ? row.lease_expires_at : null }
          },
          requestDependencies: {
            fetch: (...args) => { requests++; return fetch(...args) },
            sleep: milliseconds => { retries++; return new Promise(resolve => setTimeout(resolve, milliseconds)) },
          },
        },
      } },
      dependencies: { heartbeatRun: async () => { await assertAuthority(); return { renewed: true, resultCode: 'renewed', leaseExpiresAt: null } } },
    })
    const payload = await response.json() as { code?: string; runId?: string; leaseExpiresAt?: string; retryAfterSeconds?: number; latency?: { import?: { providerWallMs: number; canonicalMappingMs: number; validationMs: number }; promotionMs: number }; counts?: { contacts: number; invoices: number; payments: number } }
    // Publication is known only from the exact database run, never HTTP 200.
    const committed = await recovered()
    if (committed && payload.latency?.import && payload.counts) {
      metrics = { totalMs: Date.now() - start, providerMs: payload.latency.import.providerWallMs,
        mappingMs: payload.latency.import.canonicalMappingMs, validationMs: payload.latency.import.validationMs,
        promotionMs: payload.latency.promotionMs, promiseProposals, promiseRecomputations, providerRequests: requests, providerRetries: retries, contacts: payload.counts.contacts, invoices: payload.counts.invoices, payments: payload.counts.payments }
      await accountingControlRpc(admin, 'record_accounting_xero_diagnostics', { p_job_id: job.id, p_attempt_id: job.attemptId,
        p_run_id: committed.kind === 'promoted' ? committed.runId : null, p_diagnostics: metrics }).catch(() => undefined)
    }
    if (committed) return { ...committed, recovered: false } as AccountingProviderResult
    if (payload.code === 'XERO_GENERATION_SYNC_IN_PROGRESS') return { kind: 'joined_existing', runId: payload.runId ?? null, retryNotBefore: payload.leaseExpiresAt ?? null }
    if (authority.signal.aborted && Date.now() < params.deadlineAtMs) return { kind: 'authority_lost' }
    const failure = classifyXeroRefreshFailure(Date.now() >= params.deadlineAtMs ? 'XERO_SYNC_DEADLINE' : payload.code ?? 'XERO_INTERNAL_FAILURE', payload.retryAfterSeconds)
    if (failure.kind === 'failure' && ['deterministic_failure', 'unknown'].includes(failure.failureClass)) Sentry.captureMessage('Accounting provider execution needs attention', { level: 'error', extra: { jobId: job.id, code: failure.code } })
    return failure
  } catch {
    const committed = await recovered().catch(() => null)
    if (committed) return committed
    if (authority.signal.aborted && Date.now() < params.deadlineAtMs) return { kind: 'authority_lost' }
    return classifyXeroRefreshFailure(Date.now() >= params.deadlineAtMs ? 'XERO_SYNC_DEADLINE' : 'XERO_INTERNAL_FAILURE')
  } finally {
    accountingTransportEvent('provider_execution_finished', { jobId: job.id, provider: 'xero', durationMs: Date.now() - start, providerRequests: requests, providerRetries: retries, ...(metrics ?? {}) })
  }
}
