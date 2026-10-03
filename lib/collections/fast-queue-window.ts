import { applyFounderOverride, recommendActionFromSignals,
  type CustomerOverrideLevel } from '@/lib/collections/prioritization'
import type { StoredPortfolioBenchmarks } from '@/lib/collections/portfolio-materialization'
import type { CollectionsCurrencyHealth } from '@/lib/collections/currency-health'
import { resolveQueueEligibility } from '@/lib/collections/queue-eligibility'
import type { LoggedCollectionAction, CollectionQueueStatus } from '@/lib/collections/queue-projection'
import { compareDecimalValues } from '@/lib/money/currency'

/** Tiny score/ordering projection; never includes invoices, explanations or
 * persisted full score payloads. Order is the certified feature population
 * order and preserves the existing stable tie fallback. */
export interface QueueRankRow {
  customerId: string
  order: number
  customerName: string
  amountDecimal: string
  baseScore: number
  hasActionableOverdueBalance: boolean
}

export function selectCollectionQueueWindow(input: {
  rankRows: readonly QueueRankRow[]
  benchmarks: StoredPortfolioBenchmarks
  population: { invoiceScope: number; scoring: number; analysed: number }
  sourceCounts: { customers: number; invoices: number; payments: number }
  currencyHealth: CollectionsCurrencyHealth
  reviewRequiredCustomerCount: number
  overrideLevelByCustomerSourceId: ReadonlyMap<string, CustomerOverrideLevel>
  latestV1ByCustomerSourceId: ReadonlyMap<string, { next_action_date: string | null }>
  latestLegacyActionByCustomerSourceId: ReadonlyMap<string, LoggedCollectionAction>
  actionsTakenByCustomerId: Readonly<Record<string, LoggedCollectionAction>>
  organisationTodayDateIso: string
  legacyTodayDateIso: string
  limit: number
}) {
  const { benchmarks, population, sourceCounts, currencyHealth } = input
  if (input.rankRows.length !== population.scoring) throw new Error('Incomplete queue rank population')
  const ranked = input.rankRows.map((row) => {
    const adjustment = applyFounderOverride(row.baseScore,
      input.overrideLevelByCustomerSourceId.get(row.customerId) ?? 'normal')
    return { ...row, overrideLevel: adjustment.normalizedOverrideLevel,
      priorityScore: adjustment.finalScore,
      recommendedAction: recommendActionFromSignals(row.hasActionableOverdueBalance, adjustment.finalScore) }
  }).sort((a, b) => {
    const aDoNotChase = a.overrideLevel === 'do_not_chase'
    const bDoNotChase = b.overrideLevel === 'do_not_chase'
    if (aDoNotChase !== bDoNotChase) return aDoNotChase ? 1 : -1
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore
    const amount = compareDecimalValues(b.amountDecimal, a.amountDecimal)
    if (amount !== null && amount !== 0) return amount
    const name = a.customerName.localeCompare(b.customerName, undefined, { sensitivity: 'base' })
    return name || a.order - b.order
  })
  const decisions = new Map(ranked.map((row) => {
    const legacy = input.latestLegacyActionByCustomerSourceId.get(row.customerId)
    return [row.customerId, resolveQueueEligibility({
      v1NextActionDate: input.latestV1ByCustomerSourceId.get(row.customerId)?.next_action_date,
      legacyActionType: legacy?.type,
      legacyNextActionDate: legacy?.nextActionDate,
      legacyActionedToday: Boolean(input.actionsTakenByCustomerId[row.customerId]),
      organisationToday: input.organisationTodayDateIso,
      legacyToday: input.legacyTodayDateIso,
      overrideLevel: row.overrideLevel,
      hasActionableOverdueBalance: row.hasActionableOverdueBalance,
      recommendedAction: row.recommendedAction,
    })] as const
  }))
  const allDecisions = [...decisions.values()]
  const suppressedCustomerCount = allDecisions.filter((decision) =>
    decision.reason === 'v1_deferred' || decision.reason === 'legacy_postponed').length
  const postponedCustomerCount = allDecisions.filter((decision) => decision.reason === 'legacy_postponed').length
  const actionedTodayCount = allDecisions.filter((decision) => decision.reason === 'legacy_actioned_today').length
  const remainingCustomerCount = allDecisions.filter((decision) => decision.eligible).length
  const nextReturnDate = allDecisions.reduce<string | null>((earliest, decision) =>
    decision.nextReturnDate && (!earliest || decision.nextReturnDate < earliest)
      ? decision.nextReturnDate : earliest, null)
  const selectedCustomerIds = ranked.filter((row) => {
    const reason = decisions.get(row.customerId)?.reason
    return reason !== 'v1_deferred' && reason !== 'legacy_postponed'
  }).slice(0, input.limit).map((row) => row.customerId)
  const mappedRecordCount = sourceCounts.customers + sourceCounts.invoices + sourceCounts.payments
  let status: CollectionQueueStatus = 'ready'
  if (mappedRecordCount === 0) status = 'no_mapped_data'
  else if (population.scoring === 0) status = benchmarks.overdueOnly && population.invoiceScope === 0
    ? 'no_overdue_customers' : 'no_eligible_customers'
  else if (remainingCustomerCount === 0) status = actionedTodayCount + suppressedCustomerCount > 0
    ? 'complete_today' : 'no_eligible_customers'
  if (currencyHealth.status === 'degraded') status = 'currency_data_degraded'
  const portfolio = currencyHealth.status === 'degraded' && population.scoring === 0 ? null : {
    totalOverdueBase: benchmarks.totalOverdueOutstandingBase,
    totalOverdueBaseDecimal: benchmarks.totalOverdueOutstandingBaseDecimal,
    collectibleTotalOverdueBase: benchmarks.totalOverdueOutstandingBase,
    collectibleTotalOverdueBaseDecimal: benchmarks.totalOverdueOutstandingBaseDecimal,
    analysedOverdueBase: benchmarks.analysedOverdueBase,
    analysedOverdueBaseDecimal: benchmarks.analysedOverdueBaseDecimal,
    analysedOverdueCustomerCount: population.analysed,
    largestCustomerOverdueBase: benchmarks.maxOverdueOutstandingBase,
    largestCustomerOverdueBaseDecimal: benchmarks.maxOverdueOutstandingBaseDecimal,
    weightedAverageOverdueDays: benchmarks.overallWeightedAvgOverdueDays,
    rankingStatus: currencyHealth.rankingStatus,
  }
  const queue = {
    status, rankingStatus: currencyHealth.rankingStatus,
    mappedCustomerCount: sourceCounts.customers,
    mappedInvoiceCount: sourceCounts.invoices,
    mappedPaymentCount: sourceCounts.payments,
    eligibleCustomerCount: population.scoring,
    suppressedCustomerCount,
    suppression: { postponedCustomerCount, promisedToPayCustomerCount: 0, nextReturnDate },
    actionedTodayCount, remainingCustomerCount,
    returnedCustomerCount: selectedCustomerIds.length,
    reviewRequiredCustomerCount: input.reviewRequiredCustomerCount,
    relativeLateness: benchmarks.relativeLatenessContext,
  }
  return { selectedCustomerIds, decisions, portfolio, queue }
}
