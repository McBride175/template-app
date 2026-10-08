import 'server-only'
import * as Sentry from '@sentry/nextjs'
import { ensureCustomerFinancialFeaturesForPortfolioWithIdentity, newCustomerMaterializationMetrics } from '@/lib/collections/customer-materialization-server'
import { ensurePortfolioBaseCalculation, newPortfolioCalculationMetrics, type PortfolioCalculationHead } from '@/lib/collections/portfolio-materialization-server'
import { accountingControlRpc, readAccountingRefreshControl, type AccountingControlClient } from './control-server'
import { accountingTransportEvent } from './dispatch-server'
import { planAccountingRetry } from './refresh-policy'
import type { AccountingRefreshJob } from './refresh'
import type { AccountingAttemptController } from './attempt-controller'

export interface AccountingPreparationExecution {
  admin: AccountingControlClient; job: AccountingRefreshJob; authority: AccountingAttemptController
  deadlineAtMs: number; bookkeepingAtMs: number
}
interface PreparationContext { resultCode: 'current' | 'superseded'; context: { generationId: string; financialEpoch: string; evidenceIdentity: string }; boundGenerationId: string }
export type AccountingPreparationResult = { kind: 'complete' | 'superseded' | 'retry_wait' | 'attention_required' | 'authority_lost'; calculationIds?: string[]; recovered?: boolean }
interface Dependencies {
  now?: () => number
  ensureFeatures?: typeof ensureCustomerFinancialFeaturesForPortfolioWithIdentity
  ensurePortfolio?: typeof ensurePortfolioBaseCalculation
}
export function accountingPreparationAttempt(job: AccountingRefreshJob) {
  return { p_job_id: job.id, p_attempt_id: job.attemptId, p_worker_id: job.workerId,
    p_attempt_number: job.attemptNumber, p_connection_epoch: job.connection.epoch }
}

/** Only current promoted accounting/derivative authorities. No provider client,
 * token lookup, importer, generation acquisition or billing dependency. */
export async function prepareAccountingRefresh(params: AccountingPreparationExecution, dependencies: Dependencies = {}): Promise<AccountingPreparationResult> {
  const { admin, job, authority } = params, now = dependencies.now ?? Date.now, start = now()
  if (job.stage !== 'derivatives' || job.phase !== 'preparing' || !job.generationRunId || job.connection.provider !== 'xero') throw new Error('invalid_preparation_scope')
  const attempt = accountingPreparationAttempt(job), features = newCustomerMaterializationMetrics(), portfolios = newPortfolioCalculationMetrics()
  let featureMs = 0, portfolioMs = 0, verificationMs = 0, drifts = 0, customerCount = 0, basisCount = 0
  const assertBudget = () => {
    authority.assertOwned()
    if (now() >= params.deadlineAtMs || now() >= params.bookkeepingAtMs) throw new Error('preparation_deadline')
  }
  // Reuse the same ensure implementations, adding only request cancellation and
  // an authority/deadline gate before each database operation. No financial fork.
  const guarded: AccountingControlClient = Object.create(admin)
  guarded.rpc = (...args: Parameters<AccountingControlClient['rpc']>) => {
    assertBudget()
    const request = admin.rpc(...args)
    return typeof request.abortSignal === 'function' ? request.abortSignal(authority.signal) : request
  }
  const scope = { admin: guarded, userId: job.connection.ownerId, tenantId: job.connection.providerOrganisationId, sourceSystem: 'xero' as const }
  const metrics = () => ({ totalMs: Math.max(0, now() - start), featureMs, featureHits: features.featureHits, featureMisses: features.featureMisses,
    basisHits: features.basisHits, basisMisses: features.basisMisses, basisBuilds: features.basisBuilds, featuresRebuilt: features.featuresRebuilt,
    customerCount, basisCount, portfolioHits: portfolios.hits, portfolioMisses: portfolios.misses, portfolioMs,
    benchmarkMs: portfolios.benchmarkMs, scoreMs: portfolios.baseScoreMs, publicationMs: portfolios.publicationMs,
    readMs: portfolios.validationMs, verificationMs, drifts })
  const record = async () => { await accountingControlRpc(admin, 'record_accounting_preparation', { ...attempt, p_diagnostics: metrics() }) }
  const recoverComplete = async (): Promise<AccountingPreparationResult | null> => {
    const control = await readAccountingRefreshControl(admin, job.connection)
    if (control.connection.epoch !== job.connection.epoch || control.invalidated || control.job?.id !== job.id) return null
    if (control.job.phase !== 'complete') return null
    accountingTransportEvent('preparation_completion_recovered', { jobId: job.id, noProviderRetrieval: true })
    return { kind: control.job.completionKind === 'superseded' ? 'superseded' : 'complete', recovered: true }
  }
  let controlScenario: string | null = null
  try {
    await authority.renewNow()
    const control = await accountingControlRpc<{ scenario?: string | null }>(admin, 'consume_accounting_preparation_control', attempt)
    controlScenario = control.scenario ?? null
    if (controlScenario === 'abandon_once') return { kind: 'authority_lost' }
    accountingTransportEvent('preparation_started', { jobId: job.id, runId: job.generationRunId, attemptId: job.attemptId, noProviderRetrieval: true })
    for (let iteration = 0; iteration < 3; iteration++) {
      assertBudget()
      const instant = new Date(now()), date = instant.toISOString().slice(0, 10)
      const current = await accountingControlRpc<PreparationContext>(admin, 'read_accounting_preparation', attempt)
      if (current.boundGenerationId !== job.generationRunId) throw new Error('preparation_generation_mismatch')
      accountingTransportEvent('preparation_identity', { jobId: job.id, G: current.context.generationId, F: current.context.financialEpoch, date })
      let all: PortfolioCalculationHead | null = null, overdue: PortfolioCalculationHead | null = null
      if (current.resultCode !== 'superseded') {
        let elapsed = performance.now()
        const certified = await (dependencies.ensureFeatures ?? ensureCustomerFinancialFeaturesForPortfolioWithIdentity)({ ...scope, evaluationInstant: instant, metrics: features })
        featureMs += performance.now() - elapsed
        customerCount = certified.result.sourceCounts.customers
        basisCount = features.basisHits + features.basisMisses
        accountingTransportEvent('preparation_features', { jobId: job.id, featureHits: features.featureHits, featureMisses: features.featureMisses, basisHits: features.basisHits, basisMisses: features.basisMisses, customerCount, elapsedMs: featureMs })
        if (controlScenario === 'fail_after_features_once') { controlScenario = null; throw new Error('preparation_injected_failure') }
        if (certified.identity.generationId !== job.generationRunId) { drifts++; continue }
        assertBudget()
        elapsed = performance.now()
        all = await (dependencies.ensurePortfolio ?? ensurePortfolioBaseCalculation)({ ...scope, evaluationInstant: instant, scoringScope: 'collections', overdueOnly: false, metrics: portfolios })
        overdue = await (dependencies.ensurePortfolio ?? ensurePortfolioBaseCalculation)({ ...scope, evaluationInstant: instant, scoringScope: 'collections', overdueOnly: true, metrics: portfolios })
        portfolioMs += performance.now() - elapsed
        basisCount = all.featureBasisCount
        accountingTransportEvent('preparation_portfolio', { jobId: job.id, allCalculationId: all.calculationId, overdueCalculationId: overdue.calculationId, hits: portfolios.hits, misses: portfolios.misses, elapsedMs: portfolioMs })
      }
      await authority.renewNow()
      assertBudget()
      await record()
      const verifyStart = performance.now()
      const result = await accountingControlRpc<{ resultCode: string }>(admin, 'complete_accounting_preparation', {
        ...attempt, p_evaluation_date: date, p_all_calculation_id: all?.calculationId ?? null, p_overdue_calculation_id: overdue?.calculationId ?? null,
      })
      verificationMs += performance.now() - verifyStart
      if (controlScenario === 'lose_completion_response_once' && ['prepared','superseded'].includes(result.resultCode)) throw new Error('preparation_result_uncertain')
      if (result.resultCode === 'prepared' || result.resultCode === 'superseded') {
        accountingTransportEvent(result.resultCode === 'superseded' ? 'preparation_superseded' : 'preparation_complete', { jobId: job.id, ...metrics(), noProviderRetrieval: true })
        return { kind: result.resultCode === 'prepared' ? 'complete' : 'superseded', calculationIds: all && overdue ? [all.calculationId, overdue.calculationId] : [] }
      }
      drifts++
      accountingTransportEvent(result.resultCode === 'date_changed' ? 'preparation_utc_rollover' : 'preparation_dependency_drift', { jobId: job.id, resultCode: result.resultCode })
    }
    throw new Error('preparation_dependency_transition')
  } catch {
    const complete = await recoverComplete().catch(() => null)
    if (complete) return complete
    if (authority.signal.aborted && now() < params.deadlineAtMs) return { kind: 'authority_lost' }
    await record().catch(() => undefined)
    const plan = planAccountingRetry({ failureClass: 'preparation_failure', retryCount: job.preparationRetryCount ?? 0, now: new Date(now()) })
    try {
      await accountingControlRpc(admin, 'fail_accounting_preparation', { ...attempt,
        p_failure_code: now() >= params.deadlineAtMs ? 'preparation_deadline' : 'preparation_failed', p_retry_at: plan.nextEligibleAt })
    } catch { return { kind: 'authority_lost' } }
    accountingTransportEvent('preparation_retry', { jobId: job.id, nextRetryAt: plan.nextEligibleAt, phase: plan.phase, noProviderRetrieval: true })
    if (plan.phase === 'attention_required') Sentry.captureMessage('Accounting preparation retries exhausted', { level: 'error', extra: { jobId: job.id } })
    return { kind: plan.phase === 'attention_required' ? 'attention_required' : 'retry_wait' }
  }
}
