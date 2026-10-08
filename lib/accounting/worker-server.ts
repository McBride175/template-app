import 'server-only'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { accountingControlRpc, claimAccountingRefreshAttempt, heartbeatAccountingRefreshAttempt, parseAccountingJob, updateAccountingRefreshAttempt, type AccountingControlClient } from './control-server'
import { planAccountingRetry } from './refresh-policy'
import { accountingTransportEvent, dispatchAccountingRefresh } from './dispatch-server'
import type { AccountingRefreshJob } from './refresh'

export const ACCOUNTING_WORKER_HEARTBEAT_MS = 30_000
export const ACCOUNTING_WORKER_SUBSTANTIVE_BUDGET_MS = 240_000
export const ACCOUNTING_WORKER_BOOKKEEPING_BOUNDARY_MS = 270_000
const TEST_PROJECT = 'rbmxegyiwntomhpbepnu'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
interface Delivery { projectRef: string; job: AccountingRefreshJob; synthetic: { scenario: 'complete' | 'delay_complete' | 'retry_once' | 'attention' | 'disappear'; delaySeconds: number } }
interface Dependencies {
  admin?: AccountingControlClient; environment?: Record<string, string | undefined>
  heartbeatMs?: number; now?: () => number
}
function sameSecret(provided: string, expected: string) {
  const a = Buffer.from(provided), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
function pause(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new Error('authority_lost')); return }
    const abort = () => { clearTimeout(timer); reject(new Error('authority_lost')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, milliseconds)
    signal.addEventListener('abort', abort, { once: true })
  })
}
/** One synthetic-only job. No provider import, generation, scoring or domain mutation. */
export async function handleAccountingRefreshWorker(request: Request, dependencies: Dependencies = {}): Promise<Response> {
  const env = dependencies.environment ?? process.env, now = dependencies.now ?? Date.now, start = now()
  if (request.method !== 'POST') return Response.json({ code: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: { Allow: 'POST' } })
  const expected = env.ACCOUNTING_REFRESH_INTERNAL_SECRET
  if (!expected || expected.length < 32) return Response.json({ code: 'WORKER_DISABLED' }, { status: 503 })
  const auth = request.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ') || !sameSecret(auth.slice(7), expected)) {
    accountingTransportEvent('worker_auth_rejected'); return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 })
  }
  let project: string | null = null
  try { if (new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname === `${TEST_PROJECT}.supabase.co`) project = TEST_PROJECT } catch { /* fail closed */ }
  if (env.VERCEL_ENV === 'production' || env.ACCOUNTING_REFRESH_SYNTHETIC_ENABLED !== '1' || project !== TEST_PROJECT || request.headers.get('x-accounting-project-ref') !== project) {
    return Response.json({ code: 'ENVIRONMENT_REJECTED' }, { status: 403 })
  }
  const body = await request.json().catch(() => null) as { jobId?: unknown; deliveryId?: unknown } | null
  if (!body || Object.keys(body).length !== 2 || typeof body.jobId !== 'string' || !UUID.test(body.jobId) || typeof body.deliveryId !== 'string' || !UUID.test(body.deliveryId)) return Response.json({ code: 'INVALID_DELIVERY' }, { status: 400 })
  const admin = dependencies.admin ?? createSupabaseAdminClient()
  let delivery: Delivery | null
  try {
    const { data, error } = await admin.rpc('load_accounting_refresh_delivery', { p_job_id: body.jobId, p_delivery_id: body.deliveryId })
    if (error) throw new Error('delivery_lookup_failed')
    delivery = data as Delivery | null
    if (!delivery || delivery.projectRef !== project) return Response.json({ code: 'DELIVERY_UNAVAILABLE' }, { status: 409 })
    delivery.job = parseAccountingJob(delivery.job)
    if (delivery.job.id !== body.jobId || delivery.job.deliveryId !== body.deliveryId || delivery.job.connection.provider !== 'foundation_certification' ||
      !delivery.synthetic || !['complete', 'delay_complete', 'retry_once', 'attention', 'disappear'].includes(delivery.synthetic.scenario) ||
      !Number.isInteger(delivery.synthetic.delaySeconds) || delivery.synthetic.delaySeconds < 0 || delivery.synthetic.delaySeconds > 40) return Response.json({ code: 'DELIVERY_UNAVAILABLE' }, { status: 409 })
  } catch { return Response.json({ code: 'WORKER_STATE_UNAVAILABLE' }, { status: 503 }) }
  accountingTransportEvent('worker_received', { jobId: delivery.job.id })
  const workerId = randomUUID()
  let job: AccountingRefreshJob
  try {
    const result = await claimAccountingRefreshAttempt({ admin, job: delivery.job, deliveryId: body.deliveryId, workerId })
    // The same logical attempt is never executed again on duplicate delivery.
    if (!result.claimed || result.resultCode !== 'claimed' || !result.job) {
      accountingTransportEvent('worker_duplicate', { jobId: delivery.job.id }); return Response.json({ code: 'ALREADY_HANDLED' }, { status: 202 })
    }
    job = parseAccountingJob(result.job)
  } catch { return Response.json({ code: 'CLAIM_REJECTED' }, { status: 409 }) }
  accountingTransportEvent('worker_claimed', { jobId: job.id, attemptId: job.attemptId, attemptNumber: job.attemptNumber })
  const record = (event: string) => accountingControlRpc(admin, 'record_accounting_refresh_worker_event', { p_job_id: job.id, p_attempt_id: job.attemptId, p_worker_id: workerId, p_event: event })
  const abort = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null, inFlight: Promise<void> | null = null, stopped = false
  const schedule = () => {
    if (stopped) return
    timer = setTimeout(() => {
      timer = null
      inFlight = (async () => {
        try {
          job = await heartbeatAccountingRefreshAttempt(admin, job)
          await record('heartbeat')
          accountingTransportEvent('worker_heartbeat', { jobId: job.id, attemptNumber: job.attemptNumber })
        } catch { abort.abort(); stopped = true; accountingTransportEvent('worker_authority_lost', { jobId: job.id }) }
      })().finally(() => { inFlight = null; schedule() })
    }, dependencies.heartbeatMs ?? ACCOUNTING_WORKER_HEARTBEAT_MS)
  }
  const stop = async () => { stopped = true; if (timer) clearTimeout(timer); if (inFlight) await inFlight }
  const deadline = setTimeout(() => abort.abort(), ACCOUNTING_WORKER_SUBSTANTIVE_BUDGET_MS)
  try {
    await record('claimed')
    if (delivery.synthetic.scenario === 'disappear') {
      // Deliberately leave the claimed lease for persisted expiry recovery.
      accountingTransportEvent('worker_simulated_disappearance', { jobId: job.id })
      return Response.json({ code: 'SYNTHETIC_DISAPPEARANCE' }, { status: 202 })
    }
    schedule()
    await pause(delivery.synthetic.delaySeconds * 1000, abort.signal)
    await stop()
    if (abort.signal.aborted || now() - start >= ACCOUNTING_WORKER_BOOKKEEPING_BOUNDARY_MS) return Response.json({ code: 'AUTHORITY_LOST' }, { status: 409 })
    if (delivery.synthetic.scenario === 'attention' || (delivery.synthetic.scenario === 'retry_once' && job.attemptNumber === 1)) {
      const category = delivery.synthetic.scenario === 'attention' ? 'deterministic_failure' : 'transient'
      const plan = planAccountingRetry({ failureClass: category, retryCount: job.retryCount, now: new Date(now()) })
      job = await updateAccountingRefreshAttempt({ admin, job, operation: 'fail', failureClass: category, failureCode: 'synthetic_failure', retryAt: plan.nextEligibleAt, retrySource: plan.source })
      await record('result')
      accountingTransportEvent('worker_failed', { jobId: job.id, category, durationMs: now() - start })
    } else {
      job = await updateAccountingRefreshAttempt({ admin, job, operation: 'complete' })
      await record('result')
      accountingTransportEvent('worker_complete', { jobId: job.id, durationMs: now() - start })
    }
    await dispatchAccountingRefresh(admin, 'completion').catch(() => undefined)
    return Response.json({ code: 'SYNTHETIC_RESULT_RECORDED' })
  } catch {
    // A stale/uncertain worker must not overwrite persisted authority. Expiry
    // recovery remains available, including when bookkeeping response is lost.
    accountingTransportEvent('worker_result_deferred', { jobId: job.id })
    return Response.json({ code: 'RESULT_DEFERRED' }, { status: 409 })
  } finally { clearTimeout(deadline); await stop() }
}
