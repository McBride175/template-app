import { PRIORITIZATION_CONFIG, type CustomerOverrideLevel } from '@/lib/collections/prioritization'

export type FirstValueReasonKind =
  | 'exposure'
  | 'urgency'
  | 'deterioration'
  | 'payment_recency'
  | 'operator_adjustment'

export interface FirstValueReason {
  kind: FirstValueReasonKind
  text: string
}

export interface FirstValuePriorityRow {
  customer_source_id: string
  customer_name: string
  overdue_outstanding_base: number
  overdue_invoices_count: number
  weighted_avg_overdue_days: number
  relative_lateness_days: number | null
  last_payment_days_ago: number | null
  exposure_score: number
  exposure_share_percent: number
  exposure_relative_to_largest_percent: number
  urgency_score: number
  relative_lateness_score: number
  payment_recency_score: number
  override_level: CustomerOverrideLevel
  recommended_action: 'Review now' | 'Follow up' | 'Monitor' | 'No action'
  organisation_base_currency_code: string
}

export type FirstValueOutcome =
  | 'ranked'
  | 'no_receivables'
  | 'no_overdue'
  | 'no_actionable'
  | 'currency_review_required'
  | 'currency_unavailable'

function formatMoney(amount: number, currencyCode: string) {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(amount)
  }
}

function formatDays(value: number) {
  const rounded = Math.round(Math.max(0, value))
  return `${rounded} day${rounded === 1 ? '' : 's'}`
}

export function buildFirstValueReasons(
  row: FirstValuePriorityRow,
  options: { eligibleCustomerCount: number }
): FirstValueReason[] {
  const candidates: Array<FirstValueReason & { contribution: number }> = []
  const amount = formatMoney(
    Math.max(0, row.overdue_outstanding_base),
    row.organisation_base_currency_code
  )

  if (row.exposure_score > 0) {
    const isLargestComparison =
      options.eligibleCustomerCount > 1 && row.exposure_relative_to_largest_percent >= 99.95
    const exposureText = isLargestComparison
      ? `${amount} overdue — the largest eligible overdue balance in the current queue.`
      : options.eligibleCustomerCount > 1 && row.exposure_share_percent > 0
        ? `${amount} overdue — ${Math.round(row.exposure_share_percent)}% of the eligible overdue balance.`
        : `${amount} overdue across ${row.overdue_invoices_count} invoice${row.overdue_invoices_count === 1 ? '' : 's'}.`

    candidates.push({
      kind: 'exposure',
      contribution: PRIORITIZATION_CONFIG.weights.exposure * row.exposure_score,
      text: exposureText,
    })
  }

  if (row.urgency_score > 0 && row.weighted_avg_overdue_days > 0) {
    candidates.push({
      kind: 'urgency',
      contribution: PRIORITIZATION_CONFIG.weights.urgency * row.urgency_score,
      text: `${formatDays(row.weighted_avg_overdue_days)} overdue on average, allowing for the amount on each of ${row.overdue_invoices_count} invoice${row.overdue_invoices_count === 1 ? '' : 's'}.`,
    })
  }

  if (
    row.relative_lateness_score > 0 &&
    typeof row.relative_lateness_days === 'number' &&
    Number.isFinite(row.relative_lateness_days) &&
    row.relative_lateness_days > 0
  ) {
    candidates.push({
      kind: 'deterioration',
      contribution:
        PRIORITIZATION_CONFIG.weights.relativeDeterioration * row.relative_lateness_score,
      text: `The current overdue position is ${formatDays(row.relative_lateness_days)} later than this customer’s recent normal payment timing.`,
    })
  }

  if (row.payment_recency_score > 0) {
    candidates.push({
      kind: 'payment_recency',
      contribution:
        PRIORITIZATION_CONFIG.weights.behaviour * row.payment_recency_score,
      text:
        row.last_payment_days_ago === null
          ? 'No payment history is recorded for this customer.'
          : `The last recorded payment was ${formatDays(row.last_payment_days_ago)} ago.`,
    })
  }

  candidates.sort((left, right) => right.contribution - left.contribution)
  const reasons: FirstValueReason[] = candidates.slice(0, 2).map(({ kind, text }) => ({
    kind,
    text,
  }))

  if (row.override_level === 'priority') {
    reasons.push({
      kind: 'operator_adjustment',
      text: 'Your Priority adjustment increases this customer’s accounting-data score.',
    })
  } else if (row.override_level === 'safe') {
    reasons.push({
      kind: 'operator_adjustment',
      text: 'Your Safe adjustment reduces this customer’s accounting-data score.',
    })
  }

  if (reasons.length === 0) {
    reasons.push({
      kind: 'exposure',
      text: `${amount} is currently overdue.`,
    })
  }

  return reasons
}

export function selectFirstValuePriorities<T extends {
  customer_source_id: string
  override_level: CustomerOverrideLevel
  recommended_action: FirstValuePriorityRow['recommended_action']
}>(
  rankedRows: readonly T[],
  actionsTakenByCustomerId: Readonly<Record<string, unknown>>,
  limit = 3
) {
  return rankedRows
    .filter(
      (row) =>
        !actionsTakenByCustomerId[row.customer_source_id] &&
        row.override_level !== 'do_not_chase' &&
        row.recommended_action !== 'No action'
    )
    .slice(0, Math.max(0, limit))
}

export function resolveFirstValueOutcome(params: {
  queueStatus: string
  priorityCount: number
  overdueCustomerCount: number
  reviewRequiredCustomerCount: number
  currencyHealthStatus: 'healthy' | 'degraded' | 'unavailable'
}): FirstValueOutcome {
  if (params.currencyHealthStatus === 'unavailable') return 'currency_unavailable'
  if (params.priorityCount > 0) return 'ranked'
  if (
    params.currencyHealthStatus === 'degraded' &&
    params.reviewRequiredCustomerCount > 0
  ) {
    return 'currency_review_required'
  }
  if (params.queueStatus === 'no_mapped_data') return 'no_receivables'
  if (params.queueStatus === 'no_overdue_customers' || params.overdueCustomerCount === 0) {
    return 'no_overdue'
  }
  return 'no_actionable'
}
