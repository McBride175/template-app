export const PRIORITIZATION_CONFIG = {
  weights: {
    exposure: 0.5,
    urgency: 0.35,
    behaviour: 0.15,
  },
  scoreDecimalPlaces: 1,
  overdueInvoiceCountBonuses: [
    { min: 1, max: 1, bonus: 0 },
    { min: 2, max: 2, bonus: 5 },
    { min: 3, max: 4, bonus: 10 },
    { min: 5, max: Number.POSITIVE_INFINITY, bonus: 15 },
  ],
  behaviour: {
    paymentRecencyBands: [
      { min: 0, max: 0, score: 0 },
      { min: 1, max: 7, score: 10 },
      { min: 8, max: 14, score: 20 },
      { min: 15, max: 30, score: 40 },
      { min: 31, max: 45, score: 60 },
      { min: 46, max: 60, score: 80 },
      { min: 61, max: Number.POSITIVE_INFINITY, score: 100 },
    ],
    noPaymentHistoryScore: 100,
  },
  actions: {
    reviewNowMin: 70,
    followUpMin: 30,
    monitorMinExclusive: 0,
  },
} as const

export type CustomerOverrideLevel = 'safe' | 'normal' | 'priority' | 'do_not_chase'

const DEFAULT_OVERRIDE_LEVEL: CustomerOverrideLevel = 'normal'

export const OVERRIDE_MULTIPLIERS: Record<CustomerOverrideLevel, number> = {
  safe: 0.4,
  normal: 1.0,
  priority: 1.6,
  do_not_chase: 0.0,
}

export interface PrioritizationCustomerRow {
  customer_source_id: string
  customer_name: string
  customer_email: string | null
  overdue_outstanding: number
  total_outstanding: number
  overdue_invoices_count: number
  open_invoices_count: number
  weighted_avg_overdue_days: number
  last_payment_date: string | null
  last_payment_days_ago: number | null
  has_recent_partial_payment: boolean
  currency_code?: string | null
}

export interface PrioritizedCustomerRow extends PrioritizationCustomerRow {
  override_level: CustomerOverrideLevel
  override_multiplier: number
  base_score: number
  final_score: number
  priority_score: number
  recommended_action: 'Review now' | 'Follow up' | 'Monitor' | 'No action'
  reason: string
  score_breakdown_lines: string[]
}

export interface PrioritizationContext {
  totalOverdueOutstanding: number
  maxOverdueOutstanding: number
  overallWeightedAvgOverdueDays: number
  maxWeightedAvgOverdueDays: number
}

function normalizeOverrideLevel(overrideLevel: string | null | undefined): CustomerOverrideLevel {
  if (overrideLevel === 'safe') return overrideLevel
  if (overrideLevel === 'normal') return overrideLevel
  if (overrideLevel === 'priority') return overrideLevel
  if (overrideLevel === 'do_not_chase') return overrideLevel
  return DEFAULT_OVERRIDE_LEVEL
}

function getOverrideLabel(overrideLevel: CustomerOverrideLevel) {
  if (overrideLevel === 'safe') return 'Safe'
  if (overrideLevel === 'priority') return 'Priority'
  if (overrideLevel === 'do_not_chase') return 'Do not chase'
  return 'Normal'
}

function formatAmount(value: number, currencyCode: string | null | undefined) {
  const normalized = currencyCode?.trim() || 'GBP'

  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: normalized,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return new Intl.NumberFormat('en-GB', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)
  }
}

function describeExposureDriver(
  row: PrioritizationCustomerRow,
  exposureSharePercent: number,
  exposureRelativeToLargestPercent: number
) {
  const amount = formatAmount(row.overdue_outstanding, row.currency_code)
  const relativeToLargest = `${exposureRelativeToLargestPercent.toFixed(1)}%`
  const shareOfTotal = `${exposureSharePercent.toFixed(1)}%`

  if (exposureSharePercent > 0) {
    return `this customer has ${amount} overdue, equal to ${relativeToLargest} of the largest eligible overdue balance (${shareOfTotal} of total overdue AR)`
  }

  return 'there is no overdue receivable exposure for this customer'
}

function describeUrgencyDriver(row: PrioritizationCustomerRow, urgencyScore: number) {
  const weightedDays = Math.round(Math.max(0, row.weighted_avg_overdue_days))
  const overdueInvoices = Math.max(0, row.overdue_invoices_count)
  const invoiceText =
    overdueInvoices > 0
      ? `${overdueInvoices} overdue invoice${overdueInvoices === 1 ? '' : 's'}`
      : 'overdue invoices'

  if (urgencyScore >= 85) {
    return `the debt is heavily aged (weighted average ${weightedDays} days across ${invoiceText})`
  }

  if (urgencyScore >= 60) {
    return `the debt is materially aged (weighted average ${weightedDays} days across ${invoiceText})`
  }

  return `the debt is aging (weighted average ${weightedDays} days across ${invoiceText})`
}

function describeBehaviourDriver(row: PrioritizationCustomerRow, behaviourScore: number) {
  if (behaviourScore <= 0) return null

  if (row.last_payment_days_ago === null) {
    return 'no payment history is available, so payment recency adds maximum priority'
  }

  const daysSinceLastPayment = Math.max(0, Math.round(row.last_payment_days_ago))
  const dayWord = daysSinceLastPayment === 1 ? 'day' : 'days'

  if (daysSinceLastPayment === 0) {
    return 'last payment was today, so payment recency adds no priority'
  }

  if (daysSinceLastPayment <= 7) {
    return `last payment was ${daysSinceLastPayment} ${dayWord} ago, so payment recency adds little priority`
  }

  if (daysSinceLastPayment <= 14) {
    return `last payment was ${daysSinceLastPayment} ${dayWord} ago, so payment recency adds limited priority`
  }

  if (daysSinceLastPayment <= 30) {
    return `last payment was ${daysSinceLastPayment} ${dayWord} ago, so payment recency adds moderate priority`
  }

  if (daysSinceLastPayment <= 60) {
    return `last payment was ${daysSinceLastPayment} ${dayWord} ago, so payment recency adds substantial priority`
  }

  return `no payment has been recorded for ${daysSinceLastPayment} ${dayWord}, so payment recency adds maximum priority`
}

function describePaymentGap(row: PrioritizationCustomerRow) {
  if (
    typeof row.last_payment_days_ago === 'number' &&
    row.last_payment_days_ago > 60
  ) {
    return `No payment has been recorded for ${row.last_payment_days_ago} days.`
  }

  return null
}

function computeExposureComponents(
  row: PrioritizationCustomerRow,
  totalOverdueOutstanding: number,
  maxOverdueOutstanding: number
) {
  const customerOverdueOutstanding = Math.max(0, row.overdue_outstanding)
  const normalizedTotalOverdue = Math.max(0, totalOverdueOutstanding)
  const normalizedMaxOverdue = Math.max(0, maxOverdueOutstanding)

  if (
    customerOverdueOutstanding <= 0 ||
    normalizedTotalOverdue <= 0 ||
    normalizedMaxOverdue <= 0
  ) {
    return {
      exposureSharePercent: 0,
      exposureRelativeToLargestPercent: 0,
      exposureScore: 0,
      customerOverdueOutstanding,
      normalizedTotalOverdue,
      normalizedMaxOverdue,
    }
  }

  const exposureSharePercent = (customerOverdueOutstanding / normalizedTotalOverdue) * 100
  const exposureRelativeToLargestPercent =
    (customerOverdueOutstanding / normalizedMaxOverdue) * 100
  const exposureScore = Math.max(0, Math.min(100, exposureRelativeToLargestPercent))

  return {
    exposureSharePercent,
    exposureRelativeToLargestPercent,
    exposureScore,
    customerOverdueOutstanding,
    normalizedTotalOverdue,
    normalizedMaxOverdue,
  }
}

export function computeExposureScore(
  row: PrioritizationCustomerRow,
  totalOverdueOutstanding: number,
  maxOverdueOutstanding: number
) {
  return computeExposureComponents(
    row,
    totalOverdueOutstanding,
    maxOverdueOutstanding
  ).exposureScore
}

export function computeUrgencyScore(row: PrioritizationCustomerRow, context: PrioritizationContext) {
  return computeUrgencyComponents(row, context).urgencyScore
}

function computeUrgencyComponents(row: PrioritizationCustomerRow, context: PrioritizationContext) {
  if (row.overdue_outstanding <= 0) {
    return {
      weightedAvgDays: 0,
      portfolioAvgWeightedDays: 0,
      portfolioMaxWeightedDays: 0,
      baseScore: 0,
      invoiceCountBonus: 0,
      urgencyScore: 0,
    }
  }

  const weightedAvgDays = Math.max(0, row.weighted_avg_overdue_days)
  const portfolioAvgWeightedDays = Math.max(0, context.overallWeightedAvgOverdueDays)
  const portfolioMaxWeightedDays = Math.max(0, context.maxWeightedAvgOverdueDays)

  let baseScore = 0

  if (portfolioMaxWeightedDays <= 0) {
    baseScore = 0
  } else if (portfolioMaxWeightedDays <= portfolioAvgWeightedDays || portfolioAvgWeightedDays <= 0) {
    baseScore = (weightedAvgDays / portfolioMaxWeightedDays) * 100
  } else if (weightedAvgDays <= portfolioAvgWeightedDays) {
    baseScore = (weightedAvgDays / portfolioAvgWeightedDays) * 50
  } else {
    const aboveAverageRange = portfolioMaxWeightedDays - portfolioAvgWeightedDays
    baseScore = 50 + ((weightedAvgDays - portfolioAvgWeightedDays) / aboveAverageRange) * 50
  }

  baseScore = Math.max(0, Math.min(100, baseScore))

  let invoiceCountBonus = 0
  for (const bonusBand of PRIORITIZATION_CONFIG.overdueInvoiceCountBonuses) {
    if (
      row.overdue_invoices_count >= bonusBand.min &&
      row.overdue_invoices_count <= bonusBand.max
    ) {
      invoiceCountBonus = bonusBand.bonus
      break
    }
  }

  return {
    weightedAvgDays,
    portfolioAvgWeightedDays,
    portfolioMaxWeightedDays,
    baseScore,
    invoiceCountBonus,
    urgencyScore: Math.min(100, baseScore + invoiceCountBonus),
  }
}

export function computeBehaviourScore(row: PrioritizationCustomerRow) {
  return computeBehaviourComponents(row).behaviourScore
}

function computeBehaviourComponents(row: PrioritizationCustomerRow) {
  let baseScore = 0

  if (row.last_payment_days_ago === null) {
    baseScore = PRIORITIZATION_CONFIG.behaviour.noPaymentHistoryScore
  } else {
    const daysSinceLastPayment = Math.max(0, row.last_payment_days_ago)

    for (const band of PRIORITIZATION_CONFIG.behaviour.paymentRecencyBands) {
      if (daysSinceLastPayment >= band.min && daysSinceLastPayment <= band.max) {
        baseScore = band.score
        break
      }
    }
  }

  return {
    baseScore,
    behaviourScore: Math.max(0, Math.min(100, baseScore)),
  }
}

export function recommendAction(row: PrioritizationCustomerRow, finalScore: number) {
  if (row.overdue_outstanding <= 0) return 'No action' as const
  if (finalScore >= PRIORITIZATION_CONFIG.actions.reviewNowMin) return 'Review now' as const
  if (finalScore >= PRIORITIZATION_CONFIG.actions.followUpMin) return 'Follow up' as const
  if (finalScore > PRIORITIZATION_CONFIG.actions.monitorMinExclusive) return 'Monitor' as const
  return 'No action' as const
}

export function buildReason(
  row: PrioritizationCustomerRow,
  finalScore: number,
  totalOverdueOutstanding: number,
  maxOverdueOutstanding: number,
  overallWeightedAvgOverdueDays: number,
  maxWeightedAvgOverdueDays: number,
  overrideLevel: CustomerOverrideLevel = DEFAULT_OVERRIDE_LEVEL
) {
  if (row.overdue_outstanding <= 0) {
    return 'No chase needed: there are no overdue receivables.'
  }

  const { exposureSharePercent, exposureRelativeToLargestPercent, exposureScore } = computeExposureComponents(
    row,
    totalOverdueOutstanding,
    maxOverdueOutstanding
  )
  const urgencyScore = computeUrgencyScore(row, {
    totalOverdueOutstanding,
    maxOverdueOutstanding,
    overallWeightedAvgOverdueDays,
    maxWeightedAvgOverdueDays,
  })
  const { behaviourScore } = computeBehaviourComponents(row)
  const action = recommendAction(row, finalScore)

  if (overrideLevel === 'do_not_chase') {
    return 'No chase is suggested because you set this customer to Do not chase. The accounting signals remain visible in the score breakdown, but the adjustment sets the final score to 0.'
  }

  const rankedDrivers: Array<{ contribution: number; text: string }> = []

  if (exposureScore > 0) {
    rankedDrivers.push({
      contribution: PRIORITIZATION_CONFIG.weights.exposure * exposureScore,
      text: describeExposureDriver(
        row,
        exposureSharePercent,
        exposureRelativeToLargestPercent
      ),
    })
  }

  if (urgencyScore > 0) {
    rankedDrivers.push({
      contribution: PRIORITIZATION_CONFIG.weights.urgency * urgencyScore,
      text: describeUrgencyDriver(row, urgencyScore),
    })
  }

  const behaviourDriver = describeBehaviourDriver(row, behaviourScore)
  if (behaviourDriver && behaviourScore > 0) {
    rankedDrivers.push({
      contribution: PRIORITIZATION_CONFIG.weights.behaviour * behaviourScore,
      text: behaviourDriver,
    })
  }

  rankedDrivers.sort((a, b) => b.contribution - a.contribution)
  const topDrivers = rankedDrivers.slice(0, 2).map((driver) => driver.text)

  let leadIn = 'Prioritised because'
  if (action === 'Review now') {
    leadIn = 'Ranked for review now because'
  } else if (action === 'Follow up') {
    leadIn = 'Ranked for prompt follow-up because'
  } else if (action === 'Monitor') {
    leadIn = 'Ranked for monitoring because'
  }

  let reason = `${leadIn} there is overdue receivable exposure.`
  if (topDrivers.length === 1) {
    reason = `${leadIn} ${topDrivers[0]}.`
  } else if (topDrivers.length >= 2) {
    reason = `${leadIn} ${topDrivers[0]} and ${topDrivers[1]}.`
  }

  const paymentGap = describePaymentGap(row)
  if (paymentGap && !topDrivers.includes(behaviourDriver ?? '')) {
    reason = `${reason} ${paymentGap}`
  }

  if (overrideLevel === 'safe') {
    return `${reason} Your Safe adjustment then reduces the accounting score.`
  }

  if (overrideLevel === 'priority') {
    return `${reason} Your Priority adjustment then increases the accounting score.`
  }

  return reason
}

export function prioritiseCustomer(
  row: PrioritizationCustomerRow,
  context: PrioritizationContext,
  overrideLevel: CustomerOverrideLevel | null = DEFAULT_OVERRIDE_LEVEL
): PrioritizedCustomerRow {
  const {
    exposureSharePercent,
    exposureRelativeToLargestPercent,
    exposureScore,
    customerOverdueOutstanding,
    normalizedTotalOverdue,
    normalizedMaxOverdue,
  } = computeExposureComponents(
    row,
    context.totalOverdueOutstanding,
    context.maxOverdueOutstanding
  )
  const {
    weightedAvgDays: urgencyWeightedAvgDays,
    portfolioAvgWeightedDays,
    portfolioMaxWeightedDays,
    baseScore: urgencyBaseScore,
    invoiceCountBonus,
    urgencyScore,
  } = computeUrgencyComponents(row, context)
  const { baseScore: behaviourBaseScore, behaviourScore } = computeBehaviourComponents(row)
  const behaviourDaysInput =
    row.last_payment_days_ago === null
      ? 'no payment history'
      : `${Math.max(0, row.last_payment_days_ago)} days ago`

  const weightedExposure = PRIORITIZATION_CONFIG.weights.exposure * exposureScore
  const weightedUrgency = PRIORITIZATION_CONFIG.weights.urgency * urgencyScore
  const weightedBehaviour = PRIORITIZATION_CONFIG.weights.behaviour * behaviourScore
  const rawScore = weightedExposure + weightedUrgency + weightedBehaviour
  const baseScore = Number(rawScore.toFixed(PRIORITIZATION_CONFIG.scoreDecimalPlaces))
  const normalizedOverrideLevel = normalizeOverrideLevel(overrideLevel)
  const overrideMultiplier = OVERRIDE_MULTIPLIERS[normalizedOverrideLevel]
  const finalScore = Number(
    (baseScore * overrideMultiplier).toFixed(PRIORITIZATION_CONFIG.scoreDecimalPlaces)
  )
  const roundedUrgencyBaseScore = Math.round(urgencyBaseScore)
  const roundedUrgencyScore = Math.round(urgencyScore)

  const recommendedAction = recommendAction(row, finalScore)
  const reason = buildReason(
    row,
    finalScore,
    context.totalOverdueOutstanding,
    context.maxOverdueOutstanding,
    context.overallWeightedAvgOverdueDays,
    context.maxWeightedAvgOverdueDays,
    normalizedOverrideLevel
  )
  const scoreBreakdownLines = [
    `Exposure inputs: customer overdue AR = ${customerOverdueOutstanding.toFixed(2)}; total overdue AR = ${normalizedTotalOverdue.toFixed(2)}; share of total = ${exposureSharePercent.toFixed(1)}%; largest customer overdue AR = ${normalizedMaxOverdue.toFixed(2)}`,
    `Exposure: (${customerOverdueOutstanding.toFixed(2)} / ${normalizedMaxOverdue.toFixed(2)} = ${exposureRelativeToLargestPercent.toFixed(1)}%) -> ${exposureScore.toFixed(1)}/100 × ${PRIORITIZATION_CONFIG.weights.exposure.toFixed(2)} = ${weightedExposure.toFixed(1)}`,
    `Urgency inputs: customer weighted avg overdue days = ${urgencyWeightedAvgDays.toFixed(1)}; portfolio weighted avg overdue days = ${portfolioAvgWeightedDays.toFixed(1)}; portfolio max weighted avg overdue days = ${portfolioMaxWeightedDays.toFixed(1)}`,
    `Urgency: (${roundedUrgencyBaseScore} + invoice bonus ${invoiceCountBonus} = ${roundedUrgencyScore})/100 × ${PRIORITIZATION_CONFIG.weights.urgency.toFixed(2)} = ${weightedUrgency.toFixed(1)}`,
    `Payment recency input: last payment = ${behaviourDaysInput}`,
    `Payment recency: ${behaviourBaseScore}/100 × ${PRIORITIZATION_CONFIG.weights.behaviour.toFixed(2)} = ${weightedBehaviour.toFixed(1)}`,
    `Total: ${weightedExposure.toFixed(1)} + ${weightedUrgency.toFixed(1)} + ${weightedBehaviour.toFixed(1)} = ${rawScore.toFixed(1)} (rounded to ${PRIORITIZATION_CONFIG.scoreDecimalPlaces} dp: ${baseScore.toFixed(1)})`,
    `Override: ${getOverrideLabel(normalizedOverrideLevel)}`,
    `Multiplier: x${overrideMultiplier.toFixed(2)}`,
    `Base score: ${baseScore.toFixed(1)}`,
    `Final score: ${finalScore.toFixed(1)}`,
  ]

  return {
    ...row,
    override_level: normalizedOverrideLevel,
    override_multiplier: overrideMultiplier,
    base_score: baseScore,
    final_score: finalScore,
    priority_score: finalScore,
    recommended_action: recommendedAction,
    reason,
    score_breakdown_lines: scoreBreakdownLines,
  }
}
