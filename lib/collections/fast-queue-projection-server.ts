import 'server-only'

import type { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type { CustomerOverrideLevel } from '@/lib/collections/prioritization'
import type { CurrencyReviewRequiredCustomer } from '@/lib/collections/customer-features'
import type { QueueActionRow } from '@/lib/collections/action-history-queue-server'
import { ensurePortfolioBaseCalculation, PortfolioCalculationNotReady,
  type PortfolioCalculationHead } from '@/lib/collections/portfolio-materialization-server'
import { followUpPresets } from '@/lib/collections/action-history'
import { buildRelativeLatenessContext } from '@/lib/collections/relative-lateness'
import { projectPersistedCollectionQueue } from '@/lib/collections/fast-queue-projection'
import { selectCollectionQueueWindow, type QueueRankRow } from '@/lib/collections/fast-queue-window'
import type { CompactPortfolioCustomer } from '@/lib/collections/portfolio-materialization'
import type { LoggedCollectionAction } from '@/lib/collections/queue-projection'

type Admin = ReturnType<typeof createSupabaseAdminClient>
export class FastQueueUnavailable extends Error {
  constructor(readonly reason: 'schema' | 'legacy' | 'preparing' | 'invalid' | 'transport') {
    super(`Collection queue projection unavailable: ${reason}`)
  }
}

interface ProjectionSnapshot {
  context: { generationId: string | null; financialEpoch: string; generationReady: boolean; generationStatus: string | null }
  projectionRevision: string
  head: PortfolioCalculationHead | null
  rankRows: (QueueRankRow & { payloadDigest: string })[]
  overrides?: { customer_source_id: string; override_level: CustomerOverrideLevel }[]
  actions?: QueueActionRow[]
  hasPriorActionActivity?: boolean
  reviewRequiredCustomers?: CurrencyReviewRequiredCustomer[]
}

function toUtcDateIso(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

/** Caller has authenticated/entitled this exact owner and tenant. The single
 * read RPC supplies G/F/P, scores and operational rows from one MVCC snapshot. */
export async function readCollectionQueueProjection(params: {
  admin: Admin; userId: string; tenantId: string; evaluationInstant: Date
  overdueOnly: boolean; limit: number; legacyTodayDateIso: string
  requireCurrentDate?: boolean
}, retryCount = 0) {
  const date = params.evaluationInstant.toISOString().slice(0, 10)
  let result: ProjectionSnapshot | null = null
  let databaseWaitMs = 0
  let roundTrips = 0
  let calculationRebuilt = false
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = performance.now()
    let response
    try {
      response = await params.admin.rpc('read_collection_queue_projection_inputs', {
        p_user_id: params.userId, p_tenant_id: params.tenantId,
        p_evaluation_date: date, p_overdue_only: params.overdueOnly,
      })
    } catch {
      // A failed transport can still use the authoritative live calculation.
      // A returned stale/incomplete derivative below never takes that path.
      throw new FastQueueUnavailable('transport')
    }
    const { data, error } = response
    databaseWaitMs += performance.now() - started
    roundTrips++
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') throw new FastQueueUnavailable('schema')
      throw new Error(`Collection queue projection read: ${error.message}`)
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new FastQueueUnavailable('invalid')
    result = data as ProjectionSnapshot
    if (result.context.generationId === null) throw new FastQueueUnavailable('legacy')
    if (result.context.generationStatus !== 'succeeded' || result.context.generationReady !== true) {
      throw new FastQueueUnavailable('preparing')
    }
    if (result.head) break
    try {
      await ensurePortfolioBaseCalculation({
        admin: params.admin, userId: params.userId, tenantId: params.tenantId,
        sourceSystem: 'xero', evaluationInstant: params.evaluationInstant,
        scoringScope: 'collections', overdueOnly: params.overdueOnly,
      })
      calculationRebuilt = true
    } catch (error) {
      if (error instanceof PortfolioCalculationNotReady) throw new FastQueueUnavailable('preparing')
      throw error
    }
  }
  if (!result?.head) throw new FastQueueUnavailable('preparing')
  const { head, context } = result
  if (head.identity.generationId !== context.generationId ||
    head.identity.financialEpoch !== context.financialEpoch ||
    head.identity.evaluationDate !== date ||
    head.identity.overdueOnly !== params.overdueOnly ||
    head.identity.userId !== params.userId || head.identity.tenantId !== params.tenantId ||
    !Array.isArray(result.rankRows) || result.rankRows.length !== head.population.scoring ||
    !/^(0|[1-9]\d*)$/.test(result.projectionRevision)) throw new FastQueueUnavailable('invalid')

  const { metadata, benchmarks } = head
  const overrideRows = result.overrides ?? []
  const actionRows = result.actions ?? []
  const reviews = result.reviewRequiredCustomers ?? []
  if (!Array.isArray(overrideRows) || !Array.isArray(actionRows) || !Array.isArray(reviews) ||
    reviews.length !== metadata.reviewRequiredCustomerCount) throw new FastQueueUnavailable('invalid')
  reviews.sort((a, b) => a.customer_name.localeCompare(b.customer_name, undefined, {
    sensitivity: 'base',
  }))
  const overrides = new Map(overrideRows.map((row) => [row.customer_source_id, row.override_level]))
  const latestV1 = new Map<string, QueueActionRow>()
  const latestLegacy = new Map<string, LoggedCollectionAction>()
  for (const row of actionRows) {
    if (row.action_format === 'v1') latestV1.set(row.customer_source_id, row)
    else if (row.action_format === 'legacy') {
      if (row.action_type !== 'called' && row.action_type !== 'emailed' && row.action_type !== 'postponed') {
        throw new FastQueueUnavailable('invalid')
      }
      latestLegacy.set(row.customer_source_id, {
        type: row.action_type,
        takenAtIso: row.action_timestamp,
        outcome: row.outcome === 'no_response' || row.outcome === 'spoke_to_customer' ||
          row.outcome === 'promised_to_pay' || row.outcome === 'disputed' ? row.outcome : null,
        nextActionDate: row.next_action_date,
        actionId: row.id,
      })
    } else throw new FastQueueUnavailable('invalid')
  }
  const actionsTakenByCustomerId: Record<string, LoggedCollectionAction> = {}
  for (const [customerId, action] of latestLegacy) {
    if (toUtcDateIso(action.takenAtIso) === params.legacyTodayDateIso) {
      actionsTakenByCustomerId[customerId] = action
    }
  }
  const schedule = followUpPresets(metadata.organisationTimezone ?? null, params.evaluationInstant)
  const version = {
    accountingGenerationId: head.identity.generationId,
    financialEpoch: head.identity.financialEpoch,
    financialCalculationId: head.calculationId,
    projectionRevision: result.projectionRevision,
    evaluationDate: date,
  }
  const retryOnDayRollover = () => {
    if (!params.requireCurrentDate || date === new Date().toISOString().slice(0, 10)) return false
    if (retryCount >= 2) throw new FastQueueUnavailable('preparing')
    return true
  }
  if (!benchmarks || metadata.currencyHealth.status === 'unavailable' || !metadata.organisationBaseCurrency) {
    if (retryOnDayRollover()) return readCollectionQueueProjection({ ...params, evaluationInstant: new Date() }, retryCount + 1)
    return { head, version, metadata, reviews, followUpSchedule: null,
      experience: { hasPriorCollectionActivity: overrideRows.length > 0 || result.hasPriorActionActivity === true },
      rows: [], actionsTakenByCustomerId: {}, portfolio: null,
      queue: { status: 'currency_data_unavailable' as const, rankingStatus: metadata.currencyHealth.rankingStatus,
        mappedCustomerCount: metadata.sourceCounts.customers, mappedInvoiceCount: metadata.sourceCounts.invoices,
        mappedPaymentCount: metadata.sourceCounts.payments, eligibleCustomerCount: 0, suppressedCustomerCount: 0,
        actionedTodayCount: 0, remainingCustomerCount: 0, returnedCustomerCount: 0,
        reviewRequiredCustomerCount: reviews.length, relativeLateness: buildRelativeLatenessContext([]) },
      metrics: { databaseWaitMs, roundTrips, calculationRebuilt, customersExamined: head.customerCount } }
  }
  const overlay = {
      organisationBaseCurrency: metadata.organisationBaseCurrency,
      currencyHealth: metadata.currencyHealth, sourceCounts: metadata.sourceCounts,
      reviewRequiredCustomerCount: reviews.length,
      overrideLevelByCustomerSourceId: overrides,
      latestV1ByCustomerSourceId: latestV1,
      latestLegacyActionByCustomerSourceId: latestLegacy,
      actionsTakenByCustomerId,
      organisationTodayDateIso: schedule.today,
      legacyTodayDateIso: params.legacyTodayDateIso,
      limit: params.limit,
    }
  const window = selectCollectionQueueWindow({
    rankRows: result.rankRows, benchmarks, population: head.population,
    sourceCounts: metadata.sourceCounts, currencyHealth: metadata.currencyHealth,
    reviewRequiredCustomerCount: reviews.length,
    overrideLevelByCustomerSourceId: overrides,
    latestV1ByCustomerSourceId: latestV1,
    latestLegacyActionByCustomerSourceId: latestLegacy,
    actionsTakenByCustomerId,
    organisationTodayDateIso: schedule.today,
    legacyTodayDateIso: params.legacyTodayDateIso,
    limit: params.limit,
  })
  let detailRows: CompactPortfolioCustomer[] = []
  if (window.selectedCustomerIds.length) {
    const started = performance.now()
    const { data, error } = await params.admin.rpc('read_collection_queue_projection_details', {
      p_user_id: params.userId, p_tenant_id: params.tenantId,
      p_evaluation_date: date, p_overdue_only: params.overdueOnly,
      p_calculation_id: head.calculationId,
      p_expected_projection_revision: result.projectionRevision,
      p_customer_ids: window.selectedCustomerIds,
    })
    databaseWaitMs += performance.now() - started
    roundTrips++
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') throw new FastQueueUnavailable('schema')
      throw new Error(`Collection queue projection details: ${error.message}`)
    }
    const detail = data as { valid?: boolean; rows?: { customerId: string; payload: CompactPortfolioCustomer; payloadDigest: string }[];
      generationId?: string; financialEpoch?: string; projectionRevision?: string } | null
    if (!detail?.valid || detail.generationId !== head.identity.generationId ||
        detail.financialEpoch !== head.identity.financialEpoch ||
        detail.projectionRevision !== result.projectionRevision) {
      if (retryCount < 2) return readCollectionQueueProjection(params, retryCount + 1)
      throw new FastQueueUnavailable('preparing')
    }
    const digestById = new Map(result.rankRows.map(row => [row.customerId, row.payloadDigest]))
    if (!Array.isArray(detail.rows) || detail.rows.length !== window.selectedCustomerIds.length ||
        detail.rows.some((row, index) => row.customerId !== window.selectedCustomerIds[index] ||
          row.payloadDigest !== digestById.get(row.customerId) || row.payload.customerId !== row.customerId)) {
      throw new FastQueueUnavailable('invalid')
    }
    detailRows = detail.rows.map(row => row.payload)
  }
  const projected = projectPersistedCollectionQueue({
    benchmarks, rows: detailRows, overlay,
    populationCounts: head.population,
  })
  if (projected.rows.length !== window.selectedCustomerIds.length ||
      projected.rows.some((row, index) => row.customer_source_id !== window.selectedCustomerIds[index])) {
    throw new FastQueueUnavailable('invalid')
  }
  if (retryOnDayRollover()) return readCollectionQueueProjection({ ...params, evaluationInstant: new Date() }, retryCount + 1)
  return { head, version, metadata, reviews, followUpSchedule: schedule,
    experience: { hasPriorCollectionActivity: overrideRows.length > 0 || result.hasPriorActionActivity === true },
    rows: projected.rows, actionsTakenByCustomerId, portfolio: window.portfolio, queue: window.queue,
    metrics: { databaseWaitMs, roundTrips, calculationRebuilt, customersExamined: head.customerCount } }
}
