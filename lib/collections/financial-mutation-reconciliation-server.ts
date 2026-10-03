import 'server-only'

import type { ActionsEntitlementStatus } from '@/lib/billing/entitlements'
import { resolveCollectionsCurrencyAccess } from '@/lib/billing/collections-access'
import type { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { ensurePortfolioBaseCalculation, readPortfolioBaseCalculation, newPortfolioCalculationMetrics } from '@/lib/collections/portfolio-materialization-server'
import { readCustomerDetailBootstrap } from '@/lib/collections/customer-detail-bootstrap-server'
import { readCollectionQueueProjection } from '@/lib/collections/fast-queue-projection-server'
import { readCollectionDependencyState } from '@/lib/collections/dependency-state-server'

type Admin = ReturnType<typeof createSupabaseAdminClient>
export type FinancialMutationContext = { admin: Admin; userId: string; tenantId: string; entitlement?: ActionsEntitlementStatus; metadataOnly?: boolean }
export type FinancialMutationContinuation = (context: FinancialMutationContext, customerSourceId: string | null) => Promise<void>

/** Commands own the write. This disposable continuation never writes domain
 * state, guesses financial change from operation names, or replays a command. */
export async function reconcileCollectionFinancialMutation(params: FinancialMutationContext & {
  customerSourceId: string; queue?: { overdueOnly: boolean; limit: number };
  budgetMs?: number; evaluationInstant?: Date
}) {
  const started = performance.now()
  const controller = new AbortController()
  const budget = Math.max(1, Math.min(10_000, params.budgetMs ?? 10_000))
  const metrics = { databaseCalls: 0, databaseWaitMs: 0, detailMs: 0, queueMs: 0,
    portfolio: newPortfolioCalculationMetrics() }
  // Abort in-flight PostgREST requests at the deadline, and prevent any next
  // stage. Database publication still uses the existing G/F/rCustomer fences.
  const admin = new Proxy(params.admin, {
    get(target, property) {
      if (property !== 'rpc') return Reflect.get(target, property)
      return async (name: string, args: Record<string, unknown>) => {
        if (controller.signal.aborted) throw new Error('Reconciliation deadline')
        const at = performance.now()
        metrics.databaseCalls++
        try {
          const query = target.rpc(name, args)
          const result = await (typeof query.abortSignal === 'function' ? query.abortSignal(controller.signal) : query)
          if (controller.signal.aborted) throw new Error('Reconciliation deadline')
          return result
        } finally { metrics.databaseWaitMs += performance.now() - at }
      }
    },
  }) as Admin
  const scope = { admin, userId: params.userId, tenantId: params.tenantId }
  let timer: ReturnType<typeof setTimeout> | undefined
  const work = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const evaluationInstant = params.evaluationInstant ?? new Date()
      // Bulk ensure reuses every valid feature and rebuilds only stale customer
      // revisions. An unchanged F hits without transferring feature population.
      const calculationParams = { ...scope, sourceSystem: 'xero' as const,
        evaluationInstant, scoringScope: 'collections' as const,
        overdueOnly: params.queue?.overdueOnly ?? false, metrics: metrics.portfolio }
      // The command can prove note/review or unchanged active terms are metadata.
      // A cold/stale financial calculation is then recovery work, not a hidden
      // expensive continuation of the metadata save.
      const calculation = params.metadataOnly
        ? (await readPortfolioBaseCalculation(calculationParams))?.head
        : await ensurePortfolioBaseCalculation(calculationParams)
      if (!calculation) throw new Error('Financial calculation preparing')
      const detailStarted = performance.now()
      const detail = await readCustomerDetailBootstrap({ ...scope,
        customerSourceId: params.customerSourceId, evaluationInstant })
      metrics.detailMs += performance.now() - detailStarted
      if (params.entitlement && !resolveCollectionsCurrencyAccess({ entitlement: params.entitlement, currencyContext: detail.currencyContext }).allowed) {
        throw new Error('Collection access changed')
      }
      const queueStarted = performance.now()
      const queue = params.queue ? await readCollectionQueueProjection({ ...scope,
        evaluationInstant, overdueOnly: params.queue.overdueOnly, limit: params.queue.limit,
        legacyTodayDateIso: evaluationInstant.toISOString().slice(0, 10), requireCurrentDate: true }) : null
      metrics.queueMs += performance.now() - queueStarted
      const current = await readCollectionDependencyState({ ...scope,
        sourceSystem: 'xero', customerSourceId: params.customerSourceId })
      const version = detail.version
      if (current.accounting.generationId !== version.generationId ||
        current.financialEpoch !== version.financialEpoch ||
        current.projectionRevision !== version.projectionRevision ||
        current.customer?.financialRevision !== version.customerRevision ||
        calculation.identity.generationId !== version.generationId ||
        calculation.identity.financialEpoch !== version.financialEpoch ||
        calculation.identity.evidenceIdentity !== version.evidenceIdentity ||
        calculation.identity.evaluationDate !== version.evaluationDate ||
        (queue && (queue.version.financialCalculationId !== calculation.calculationId ||
          queue.version.projectionRevision !== version.projectionRevision)) ||
        version.evaluationDate !== new Date().toISOString().slice(0, 10)) continue
      return { reconciliationReady: true as const, customerSourceId: params.customerSourceId,
        tenantId: params.tenantId, detail, version: { ...version,
          financialCalculationId: calculation.calculationId },
        // Presentation payload only when the caller requests an open queue window.
        projection: queue ? { tenantId: params.tenantId, overdueOnly: params.queue!.overdueOnly, rows: queue.rows,
          actionsTakenByCustomerId: queue.actionsTakenByCustomerId, queue: queue.queue,
          portfolio: queue.portfolio, version: queue.version, experience: queue.experience,
          reviewRequiredCustomers: queue.reviews, organisationBaseCurrency: queue.metadata.organisationBaseCurrency,
          currencyContext: queue.metadata.currencyContext, currencyHealth: queue.metadata.currencyHealth,
          followUpSchedule: queue.followUpSchedule ?? undefined } : null,
        metrics: { ...metrics, totalMs: performance.now() - started } }
    }
    throw new Error('Reconciliation state changed')
  }
  try {
    return await Promise.race([work(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Reconciliation deadline')) }, budget)
    })])
  } catch (cause) {
    const schemaMissing = cause instanceof Error && /Could not find.*function|function .*does not exist/.test(cause.message)
    return { reconciliationReady: false as const, customerSourceId: params.customerSourceId,
      tenantId: params.tenantId, reason: controller.signal.aborted ? 'budget' as const : schemaMissing ? 'schema' as const : 'unavailable' as const,
      metrics: { ...metrics, totalMs: performance.now() - started } }
  } finally { if (timer) clearTimeout(timer) }
}

export type FinancialMutationReconciliation = Awaited<ReturnType<typeof reconcileCollectionFinancialMutation>>
