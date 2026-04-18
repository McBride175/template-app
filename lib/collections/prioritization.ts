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
    paymentRecencyRiskBands: [
      { min: 0, max: 0, score: 0 },
      { min: 1, max: 7, score: 10 },
      { min: 8, max: 14, score: 20 },
      { min: 15, max: 30, score: 40 },
      { min: 31, max: 45, score: 60 },
      { min: 46, max: 60, score: 80 },
      { min: 61, max: Number.POSITIVE_INFINITY, score: 100 },
    ],
    noPaymentHistoryScore: 100,
    partialPaymentRiskBonus: 15,
  },
  actions: {
    callImmediatelyMin: 70,
    emailReminderMin: 30,
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
  recommended_action: 'Call immediately' | 'Email reminder' | 'Monitor' | 'No action'
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

function describeExposureDriver(row: PrioritizationCustomerRow, exposureSharePercent: number) {
  const amount = formatAmount(row.overdue_outstanding, row.currency_code)
  const share = `${exposureSharePercent.toFixed(1)}%`

  if (exposureSharePercent >= 40) {
    return `this customer accounts for a high share of total overdue AR (${share}, ${amount})`
  }

  if (exposureSharePercent >= 20) {
    return `this customer accounts for a material share of total overdue AR (${share}, ${amount})`
  }

  if (exposureSharePercent > 0) {
    return `this customer contributes ${share} of total overdue AR (${amount})`
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

function describeBehaviourDriver(
  row: PrioritizationCustomerRow,
  behaviourScore: number,
  partialPaymentRiskBonus: number
) {
  if (behaviourScore <= 0) return null

  if (row.last_payment_days_ago === null) {
    return partialPaymentRiskBonus > 0
      ? 'no payment history is available, and recent partial payments add further recovery risk'
      : 'no payment history is available, which is high risk for collections'
  }

  const daysSinceLastPayment = Math.max(0, Math.round(row.last_payment_days_ago))
  const dayWord = daysSinceLastPayment === 1 ? 'day' : 'days'
  const partialRiskSuffix =
    partialPaymentRiskBonus > 0
      ? ', and recent partial payments add additional risk'
      : ''

  if (daysSinceLastPayment === 0) {
    return `last payment was today, so behaviour risk is minimal${partialRiskSuffix}`
  }

  if (daysSinceLastPayment <= 7) {
    return `last payment was ${daysSinceLastPayment} ${dayWord} ago, which is low risk${partialRiskSuffix}`
  }

  if (daysSinceLastPayment <= 14) {
    return `last payment was ${daysSinceLastPayment} ${dayWord} ago, which is mild risk${partialRiskSuffix}`
  }

  if (daysSinceLastPayment <= 30) {
    return `last payment was ${daysSinceLastPayment} ${dayWord} ago, which is moderate risk${partialRiskSuffix}`
  }

  if (daysSinceLastPayment <= 60) {
    return `last payment was ${daysSinceLastPayment} ${dayWord} ago, which is elevated risk${partialRiskSuffix}`
  }

  return `no payment has been recorded for ${daysSinceLastPayment} ${dayWord}, which is high risk${partialRiskSuffix}`
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

    for (const band of PRIORITIZATION_CONFIG.behaviour.paymentRecencyRiskBands) {
      if (daysSinceLastPayment >= band.min && daysSinceLastPayment <= band.max) {
        baseScore = band.score
        break
      }
    }
  }

  const partialPaymentRiskBonus = row.has_recent_partial_payment
    ? PRIORITIZATION_CONFIG.behaviour.partialPaymentRiskBonus
    : 0

  const behaviourScore = Math.max(0, Math.min(100, baseScore + partialPaymentRiskBonus))

  return {
    baseScore,
    partialPaymentRiskBonus,
    behaviourScore,
  }
}

export function recommendAction(row: PrioritizationCustomerRow, finalScore: number) {
  if (row.overdue_outstanding <= 0) return 'No action' as const
  if (finalScore >= PRIORITIZATION_CONFIG.actions.callImmediatelyMin) return 'Call immediately' as const
  if (finalScore >= PRIORITIZATION_CONFIG.actions.emailReminderMin) return 'Email reminder' as const
  if (finalScore > PRIORITIZATION_CONFIG.actions.monitorMinExclusive) return 'Monitor' as const
  return 'No action' as const
}

export function buildReason(
  row: PrioritizationCustomerRow,
  finalScore: number,
  totalOverdueOutstanding: number,
  maxOverdueOutstanding: number,
  overallWeightedAvgOverdueDays: number,
  maxWeightedAvgOverdueDays: number
) {
  if (row.overdue_outstanding <= 0) {
    return 'No chase needed: there are no overdue receivables.'
  }

  const { exposureSharePercent, exposureScore } = computeExposureComponents(
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
  const { partialPaymentRiskBonus, behaviourScore } = computeBehaviourComponents(row)
  const action = recommendAction(row, finalScore)

  const rankedDrivers: Array<{ contribution: number; text: string }> = []

  if (exposureScore > 0) {
    rankedDrivers.push({
      contribution: PRIORITIZATION_CONFIG.weights.exposure * exposureScore,
      text: describeExposureDriver(row, exposureSharePercent),
    })
  }

  if (urgencyScore > 0) {
    rankedDrivers.push({
      contribution: PRIORITIZATION_CONFIG.weights.urgency * urgencyScore,
      text: describeUrgencyDriver(row, urgencyScore),
    })
  }

  const behaviourDriver = describeBehaviourDriver(row, behaviourScore, partialPaymentRiskBonus)
  if (behaviourDriver && behaviourScore > 0) {
    rankedDrivers.push({
      contribution: PRIORITIZATION_CONFIG.weights.behaviour * behaviourScore,
      text: behaviourDriver,
    })
  }

  rankedDrivers.sort((a, b) => b.contribution - a.contribution)
  const topDrivers = rankedDrivers.slice(0, 2).map((driver) => driver.text)

  let leadIn = 'Prioritized because'
  if (action === 'Call immediately') {
    leadIn = 'Ranked as a top chase target because'
  } else if (action === 'Email reminder') {
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
  if (!paymentGap) return reason

  return `${reason} ${paymentGap}`
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
  const { baseScore: behaviourBaseScore, partialPaymentRiskBonus, behaviourScore } =
    computeBehaviourComponents(row)
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
    context.maxWeightedAvgOverdueDays
  )
  const scoreBreakdownLines = [
    `Exposure inputs: customer overdue AR = ${customerOverdueOutstanding.toFixed(2)}; total overdue AR = ${normalizedTotalOverdue.toFixed(2)}; share of total = ${exposureSharePercent.toFixed(1)}%; largest customer overdue AR = ${normalizedMaxOverdue.toFixed(2)}`,
    `Exposure: (${customerOverdueOutstanding.toFixed(2)} / ${normalizedMaxOverdue.toFixed(2)} = ${exposureRelativeToLargestPercent.toFixed(1)}%) -> ${exposureScore.toFixed(1)}/100 × ${PRIORITIZATION_CONFIG.weights.exposure.toFixed(2)} = ${weightedExposure.toFixed(1)}`,
    `Urgency inputs: customer weighted avg overdue days = ${urgencyWeightedAvgDays.toFixed(1)}; portfolio weighted avg overdue days = ${portfolioAvgWeightedDays.toFixed(1)}; portfolio max weighted avg overdue days = ${portfolioMaxWeightedDays.toFixed(1)}`,
    `Urgency: (${roundedUrgencyBaseScore} + invoice bonus ${invoiceCountBonus} = ${roundedUrgencyScore})/100 × ${PRIORITIZATION_CONFIG.weights.urgency.toFixed(2)} = ${weightedUrgency.toFixed(1)}`,
    `Behaviour inputs: last payment = ${behaviourDaysInput}; recent partial payment = ${row.has_recent_partial_payment ? 'yes' : 'no'}`,
    `Behaviour: (recency ${behaviourBaseScore} + partial payment bonus ${partialPaymentRiskBonus} = ${behaviourScore})/100 × ${PRIORITIZATION_CONFIG.weights.behaviour.toFixed(2)} = ${weightedBehaviour.toFixed(1)}`,
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
