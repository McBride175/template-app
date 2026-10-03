import { adjustCustomerPriority, type CustomerOverrideLevel } from '@/lib/collections/prioritization'
import type { PortfolioBenchmarks, PortfolioBaseScores } from '@/lib/collections/portfolio-benchmarks'
import type { CollectionsCurrencyHealth } from '@/lib/collections/currency-health'
import { buildFirstValueReasons } from '@/lib/collections/first-value'
import { resolveQueueEligibility } from '@/lib/collections/queue-eligibility'
import { compareDecimalValues } from '@/lib/money/currency'

const DEFAULT_OVERRIDE_LEVEL: CustomerOverrideLevel = 'normal'
type CollectionActionType = 'called' | 'emailed' | 'postponed'
type CollectionActionOutcome = 'no_response' | 'spoke_to_customer' | 'promised_to_pay' | 'disputed'
export type CollectionQueueStatus =
  | 'ready'
  | 'currency_data_degraded'
  | 'currency_data_unavailable'
  | 'no_mapped_data'
  | 'no_overdue_customers'
  | 'no_eligible_customers'
  | 'complete_today'

export interface LoggedCollectionAction {
  type: CollectionActionType
  takenAtIso: string
  outcome: CollectionActionOutcome | null
  nextActionDate: string | null
  actionId: string
}

/** Already verified operational inputs; no loader or implicit clock participates. */
export interface QueueProjectionInput {
  benchmarks: PortfolioBenchmarks
  baseScores: PortfolioBaseScores
  organisationBaseCurrency: string
  currencyHealth: CollectionsCurrencyHealth
  sourceCounts: { customers: number; invoices: number; payments: number }
  reviewRequiredCustomerCount: number
  overrideLevelByCustomerSourceId: ReadonlyMap<string, CustomerOverrideLevel>
  latestV1ByCustomerSourceId: ReadonlyMap<string, {
    id: string; action_timestamp: string; outcome: string | null; note: string | null; next_action_date: string | null
  }>
  latestLegacyActionByCustomerSourceId: ReadonlyMap<string, LoggedCollectionAction>
  actionsTakenByCustomerId: Readonly<Record<string, LoggedCollectionAction>>
  organisationTodayDateIso: string
  legacyTodayDateIso: string
  limit: number
  /** Full certified population counts when only displayed financial rows are
   * hydrated for presentation. A page limit never changes these populations. */
  populationCounts?: { invoiceScope: number; scoring: number; analysed: number }
}

export function projectCollectionQueue(input: QueueProjectionInput) {
  const { benchmarks, baseScores, organisationBaseCurrency, currencyHealth, sourceCounts,
    reviewRequiredCustomerCount, overrideLevelByCustomerSourceId, latestV1ByCustomerSourceId,
    latestLegacyActionByCustomerSourceId, actionsTakenByCustomerId, organisationTodayDateIso,
    legacyTodayDateIso, limit } = input
  const {
    overdueOnly, invoiceScopeRows, filteredRows, analysedOverdueRows, relativeLatenessContext,
    totalOverdueOutstandingBaseDecimal, analysedOverdueBaseDecimal, maxOverdueOutstandingBaseDecimal,
    totalOverdueOutstandingBase, analysedOverdueBase, maxOverdueOutstandingBase,
    overallWeightedAvgOverdueDays,
  } = benchmarks
  const promisedToPayCustomerCount = 0 // Retained response compatibility.
  const invoiceScopeCount = input.populationCounts?.invoiceScope ?? invoiceScopeRows.length
  const scoringCount = input.populationCounts?.scoring ?? filteredRows.length
  const analysedCount = input.populationCounts?.analysed ?? analysedOverdueRows.length
  const mappedRecordCount = sourceCounts.customers + sourceCounts.invoices + sourceCounts.payments
  const scoredRows = baseScores
    .map(({ features: row, base }) => ({
      ...adjustCustomerPriority(base,
        overrideLevelByCustomerSourceId.get(row.customer_source_id) ?? DEFAULT_OVERRIDE_LEVEL),
      customer_to_chase_overdue_base_decimal: row.customer_to_chase_overdue_base_decimal,
      customer_credit_applied_base: row.customer_credit_applied_base,
      invoice_to_chase_overdue_base_decimal: row.invoice_to_chase_overdue_base_decimal,
      total_outstanding_base_decimal: row.collectible_outstanding_base_decimal,
      gross_outstanding_base_decimal: row.gross_outstanding_base_decimal,
      gross_overdue_base_decimal: row.gross_overdue_base_decimal,
      effective_disputed_outstanding_base_decimal: row.effective_disputed_outstanding_base_decimal,
      effective_disputed_overdue_base_decimal: row.effective_disputed_overdue_base_decimal,
      active_promised_outstanding_base_decimal: row.active_promised_outstanding_base_decimal,
      active_promised_overdue_base_decimal: row.active_promised_overdue_base_decimal,
      to_chase_outstanding_base_decimal: row.to_chase_outstanding_base_decimal,
      to_chase_overdue_base_decimal: row.to_chase_overdue_base_decimal,
      to_chase_outstanding_base: row.to_chase_outstanding_base,
      to_chase_overdue_base: row.to_chase_overdue_base,
      gross_total_outstanding_base: row.total_outstanding_base,
      gross_overdue_outstanding_base: row.overdue_outstanding_base,
      legacy_gross_total_outstanding_base_decimal: row.total_outstanding_base_decimal,
      legacy_gross_overdue_outstanding_base_decimal: row.overdue_outstanding_base_decimal,
      gross_open_invoices_count: row.open_invoices_count,
      gross_overdue_invoices_count: row.overdue_invoices_count,
      actionable_open_invoices_count: row.actionable_open_invoices_count,
      actionable_overdue_invoices_count: row.actionable_overdue_invoices_count,
      native_currency_breakdown: row.native_currency_breakdown,
      collectible_native_currency_breakdown: row.collectible_native_currency_breakdown,
    }))
    .sort((a, b) => {
      const aDoNotChase = a.override_level === 'do_not_chase'
      const bDoNotChase = b.override_level === 'do_not_chase'
      if (aDoNotChase !== bDoNotChase) {
        return aDoNotChase ? 1 : -1
      }

      if (b.priority_score !== a.priority_score) {
        return b.priority_score - a.priority_score
      }

      const baseAmountComparison = compareDecimalValues(
        b.customer_to_chase_overdue_base_decimal,
        a.customer_to_chase_overdue_base_decimal
      )
      if (baseAmountComparison !== null && baseAmountComparison !== 0) {
        return baseAmountComparison
      }

      return a.customer_name.localeCompare(b.customer_name, undefined, {
        sensitivity: 'base',
      })
    })
  const decisionByCustomerSourceId = new Map(
    scoredRows.map((row) => {
      const legacy = latestLegacyActionByCustomerSourceId.get(row.customer_source_id)
      return [row.customer_source_id, resolveQueueEligibility({
        v1NextActionDate: latestV1ByCustomerSourceId.get(row.customer_source_id)?.next_action_date,
        legacyActionType: legacy?.type,
        legacyNextActionDate: legacy?.nextActionDate,
        legacyActionedToday: Boolean(actionsTakenByCustomerId[row.customer_source_id]),
        organisationToday: organisationTodayDateIso,
        legacyToday: legacyTodayDateIso,
        overrideLevel: row.override_level,
        hasActionableOverdueBalance: row.has_actionable_overdue_balance,
        recommendedAction: row.recommended_action,
      })] as const
    })
  )
  const decisions = [...decisionByCustomerSourceId.values()]
  const suppressedCustomerCount = decisions.filter((decision) =>
    decision.reason === 'v1_deferred' || decision.reason === 'legacy_postponed'
  ).length
  const postponedCustomerCount = decisions.filter((decision) =>
    decision.reason === 'legacy_postponed'
  ).length
  const actionedTodayCount = decisions.filter((decision) =>
    decision.reason === 'legacy_actioned_today'
  ).length
  const remainingCustomerCount = decisions.filter((decision) => decision.eligible).length
  const nextReturnDate = decisions.reduce<string | null>((earliest, decision) =>
    decision.nextReturnDate && (!earliest || decision.nextReturnDate < earliest)
      ? decision.nextReturnDate : earliest, null)
  let queueStatus: CollectionQueueStatus = 'ready'
  if (mappedRecordCount === 0) {
    queueStatus = 'no_mapped_data'
  } else if (scoringCount === 0) {
    queueStatus = overdueOnly && invoiceScopeCount === 0
      ? 'no_overdue_customers' : 'no_eligible_customers'
  } else if (remainingCustomerCount === 0) {
    queueStatus = actionedTodayCount + suppressedCustomerCount > 0
      ? 'complete_today' : 'no_eligible_customers'
  }
  if (currencyHealth.status === 'degraded') queueStatus = 'currency_data_degraded'

  const prioritizedRows = scoredRows
    .filter((row) => {
      const reason = decisionByCustomerSourceId.get(row.customer_source_id)?.reason
      return reason !== 'v1_deferred' && reason !== 'legacy_postponed'
    })
    .slice(0, limit)
    .map((row) => {
      const latestAction = latestLegacyActionByCustomerSourceId.get(row.customer_source_id)
      const latestV1 = latestV1ByCustomerSourceId.get(row.customer_source_id)
      const recentActivity = latestV1 && (!latestAction ||
        latestV1.action_timestamp > latestAction.takenAtIso ||
        (latestV1.action_timestamp === latestAction.takenAtIso && latestV1.id > latestAction.actionId))
        ? {
            format: 'v1' as const,
            outcome: latestV1.outcome,
            note: latestV1.note,
            actionType: null,
            actionTimestamp: latestV1.action_timestamp,
            nextActionDate: latestV1.next_action_date,
          }
        : latestAction ? {
            format: 'legacy' as const,
            outcome: latestAction.outcome,
            note: null,
            actionType: latestAction.type,
            actionTimestamp: latestAction.takenAtIso,
            nextActionDate: latestAction.nextActionDate,
          } : null

      return {
        customer_source_id: row.customer_source_id,
        customer_name: row.customer_name,
        customer_email: row.customer_email,
        // Existing balance fields retain gross accounting meaning. The explicit
        // nullable gross fields signal when an FX-invalid invoice makes a
        // complete base-currency gross total unavailable.
        overdue_outstanding_base_decimal: row.legacy_gross_overdue_outstanding_base_decimal,
        total_outstanding_base_decimal: row.legacy_gross_total_outstanding_base_decimal,
        overdue_outstanding_base: row.gross_overdue_outstanding_base,
        total_outstanding_base: row.gross_total_outstanding_base,
        overdue_outstanding: row.gross_overdue_outstanding_base,
        total_outstanding: row.gross_total_outstanding_base,
        gross_outstanding_base_decimal: row.gross_outstanding_base_decimal,
        gross_overdue_base_decimal: row.gross_overdue_base_decimal,
        effective_disputed_outstanding_base_decimal: row.effective_disputed_outstanding_base_decimal,
        effective_disputed_overdue_base_decimal: row.effective_disputed_overdue_base_decimal,
        active_promised_outstanding_base_decimal: row.active_promised_outstanding_base_decimal,
        active_promised_overdue_base_decimal: row.active_promised_overdue_base_decimal,
        to_chase_outstanding_base_decimal: row.to_chase_outstanding_base_decimal,
        to_chase_overdue_base_decimal: row.to_chase_overdue_base_decimal,
        to_chase_outstanding_base: row.to_chase_outstanding_base,
        to_chase_overdue_base: row.to_chase_overdue_base,
        invoice_to_chase_overdue_base_decimal: row.invoice_to_chase_overdue_base_decimal,
        invoice_to_chase_overdue_base: row.invoice_overdue_to_chase_base,
        customer_to_chase_overdue_base_decimal: row.customer_to_chase_overdue_base_decimal,
        customer_to_chase_overdue_base: row.customer_overdue_to_chase_base,
        customer_credit_applied_base: row.customer_credit_applied_base,
        has_actionable_overdue_balance: row.has_actionable_overdue_balance,
        collectible_outstanding_base_decimal: row.total_outstanding_base_decimal,
        collectible_overdue_base_decimal: row.invoice_to_chase_overdue_base_decimal,
        collectible_outstanding_base: row.total_outstanding_base,
        collectible_overdue_base: row.invoice_overdue_to_chase_base,
        gross_open_invoices_count: row.gross_open_invoices_count,
        gross_overdue_invoices_count: row.gross_overdue_invoices_count,
        // Existing invoice counts retain accounting meaning across APIs.
        overdue_invoices_count: row.gross_overdue_invoices_count,
        open_invoices_count: row.gross_open_invoices_count,
        actionable_overdue_invoices_count: row.actionable_overdue_invoices_count,
        actionable_open_invoices_count: row.actionable_open_invoices_count,
        weighted_avg_overdue_days: row.weighted_avg_overdue_days,
        relative_lateness_days: row.relative_lateness_days,
        relative_lateness_score: row.relative_lateness_score,
        urgency_score: row.urgency_score,
        payment_recency_score: row.payment_recency_score,
        last_payment_date: row.last_payment_date,
        last_payment_days_ago: row.last_payment_days_ago,
        exposure_score: row.exposure_score,
        exposure_share_percent: row.exposure_share_percent,
        exposure_relative_to_largest_percent:
          row.exposure_relative_to_largest_percent,
        override_level: row.override_level,
        override_multiplier: row.override_multiplier,
        base_score: row.base_score,
        final_score: row.final_score,
        priority_score: row.priority_score,
        recommended_action: row.recommended_action,
        recent_activity: recentActivity,
        queue_eligibility_reason: decisionByCustomerSourceId.get(row.customer_source_id)!.reason,
        reason: row.reason,
        score_breakdown_lines: row.score_breakdown_lines,
        first_value_reasons: buildFirstValueReasons(row, {
          eligibleCustomerCount: scoringCount,
        }),
        organisation_base_currency_code: organisationBaseCurrency,
        currency_code: organisationBaseCurrency,
        native_currency_breakdown: row.native_currency_breakdown,
        collectible_native_currency_breakdown: row.collectible_native_currency_breakdown,
        last_action_type: latestAction?.type ?? null,
        last_action_outcome: latestAction?.outcome ?? null,
        last_action_timestamp: latestAction?.takenAtIso ?? null,
      }
    })

  return {
    rows: prioritizedRows,
    decisions: decisionByCustomerSourceId,
    portfolio:
      currencyHealth.status === 'degraded' && scoringCount === 0
        ? null
        : {
            // Monetary Exposure uses customer net overdue; ageing uses invoice overdue.
            totalOverdueBase: totalOverdueOutstandingBase,
            totalOverdueBaseDecimal: totalOverdueOutstandingBaseDecimal,
            collectibleTotalOverdueBase: totalOverdueOutstandingBase,
            collectibleTotalOverdueBaseDecimal: totalOverdueOutstandingBaseDecimal,
            analysedOverdueBase,
            analysedOverdueBaseDecimal,
            analysedOverdueCustomerCount: analysedCount,
            largestCustomerOverdueBase: maxOverdueOutstandingBase,
            largestCustomerOverdueBaseDecimal: maxOverdueOutstandingBaseDecimal,
            weightedAverageOverdueDays: overallWeightedAvgOverdueDays,
            rankingStatus: currencyHealth.rankingStatus,
          },
    queue: {
      status: queueStatus,
      rankingStatus: currencyHealth.rankingStatus,
      mappedCustomerCount: sourceCounts.customers,
      mappedInvoiceCount: sourceCounts.invoices,
      mappedPaymentCount: sourceCounts.payments,
      eligibleCustomerCount: scoringCount,
      suppressedCustomerCount,
      suppression: {
        postponedCustomerCount,
        promisedToPayCustomerCount,
        nextReturnDate,
      },
      actionedTodayCount,
      remainingCustomerCount,
      returnedCustomerCount: prioritizedRows.length,
      reviewRequiredCustomerCount,
      relativeLateness: relativeLatenessContext,
    },
  }
}

export type CollectionQueueProjection = ReturnType<typeof projectCollectionQueue>
