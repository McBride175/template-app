import {
  prioritiseCustomer,
  type CustomerOverrideLevel,
  type PrioritizationContext,
  type PrioritizationCustomerRow,
} from '@/lib/collections/prioritization'

export const PLAYBOOK_CONCERNS = ['low', 'medium', 'high'] as const

export type PlaybookConcern = (typeof PLAYBOOK_CONCERNS)[number]

export interface PlaybookCustomer {
  id: string
  name: string
  outstanding: number
  daysOverdue: number
  normalDaysLate: number
  daysSinceLastPayment: number
  overdueInvoiceCount: number
  defaultConcern: PlaybookConcern
  accountingContext: string
  highConcernContext: string
}

export interface RankedPlaybookCustomer extends PlaybookCustomer {
  concern: PlaybookConcern
  rank: number
  baseScore: number
  finalScore: number
  shortReason: string
}

export const PLAYBOOK_CUSTOMERS: readonly PlaybookCustomer[] = [
  {
    id: 'elmstead-engineering',
    name: 'Elmstead Engineering',
    outstanding: 22_000,
    daysOverdue: 8,
    normalDaysLate: 10,
    daysSinceLastPayment: 12,
    overdueInvoiceCount: 2,
    defaultConcern: 'medium',
    accountingContext: 'The balance is large, but the timing is still inside its usual range.',
    highConcernContext: 'A trusted contact says the next approval run may be delayed.',
  },
  {
    id: 'marlowe-fit-out',
    name: 'Marlowe Fit-Out',
    outstanding: 10_000,
    daysOverdue: 38,
    normalDaysLate: 2,
    daysSinceLastPayment: 68,
    overdueInvoiceCount: 2,
    defaultConcern: 'medium',
    accountingContext: 'A normally prompt payer is now 36 days outside its usual pattern.',
    highConcernContext: 'The normal finance contact has stopped responding.',
  },
  {
    id: 'birch-and-stone',
    name: 'Birch & Stone',
    outstanding: 12_000,
    daysOverdue: 45,
    normalDaysLate: 40,
    daysSinceLastPayment: 20,
    overdueInvoiceCount: 2,
    defaultConcern: 'medium',
    accountingContext: 'The debt is old, but this customer is behaving close to its established pattern.',
    highConcernContext: 'Its latest payment promise has now been missed without explanation.',
  },
  {
    id: 'calder-kitchens',
    name: 'Calder Kitchens',
    outstanding: 5_000,
    daysOverdue: 24,
    normalDaysLate: 0,
    daysSinceLastPayment: 44,
    overdueInvoiceCount: 1,
    defaultConcern: 'medium',
    accountingContext: 'This is a smaller balance, but the delay is unusual for an on-time payer.',
    highConcernContext: 'Its owner has privately mentioned short-term cash-flow difficulty.',
  },
  {
    id: 'harbour-studio',
    name: 'Harbour Studio',
    outstanding: 900,
    daysOverdue: 70,
    normalDaysLate: 55,
    daysSinceLastPayment: 80,
    overdueInvoiceCount: 1,
    defaultConcern: 'medium',
    accountingContext: 'It is the oldest debt, but the value is low and this customer routinely pays slowly.',
    highConcernContext: 'The customer has asked for more work while the old balance remains unpaid.',
  },
  {
    id: 'westcroft-hotels',
    name: 'Westcroft Hotels',
    outstanding: 9_500,
    daysOverdue: 24,
    normalDaysLate: 12,
    daysSinceLastPayment: 6,
    overdueInvoiceCount: 3,
    defaultConcern: 'medium',
    accountingContext: 'A payment six days ago provides recent evidence that the account is moving.',
    highConcernContext: 'You have learned that the remaining invoices are caught in a serious internal dispute.',
  },
] as const

const concernToOverride: Record<PlaybookConcern, CustomerOverrideLevel> = {
  low: 'safe',
  medium: 'normal',
  high: 'priority',
}

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
})

function isPlaybookConcern(value: unknown): value is PlaybookConcern {
  return PLAYBOOK_CONCERNS.includes(value as PlaybookConcern)
}

function resolveConcern(value: unknown, fallback: PlaybookConcern) {
  return isPlaybookConcern(value) ? value : fallback
}

function toProductRow(customer: PlaybookCustomer): PrioritizationCustomerRow {
  return {
    customer_source_id: customer.id,
    customer_name: customer.name,
    customer_email: null,
    overdue_outstanding: customer.outstanding,
    total_outstanding: customer.outstanding,
    overdue_invoices_count: customer.overdueInvoiceCount,
    open_invoices_count: customer.overdueInvoiceCount,
    weighted_avg_overdue_days: customer.daysOverdue,
    last_payment_date: null,
    last_payment_days_ago: customer.daysSinceLastPayment,
    has_recent_partial_payment: false,
    currency_code: 'GBP',
  }
}

function buildContext(customers: readonly PlaybookCustomer[]): PrioritizationContext {
  const totalOverdueOutstanding = customers.reduce(
    (total, customer) => total + customer.outstanding,
    0
  )
  const maxOverdueOutstanding = Math.max(
    0,
    ...customers.map((customer) => customer.outstanding)
  )
  const weightedDaysTotal = customers.reduce(
    (total, customer) => total + customer.outstanding * customer.daysOverdue,
    0
  )

  return {
    totalOverdueOutstanding,
    maxOverdueOutstanding,
    overallWeightedAvgOverdueDays:
      totalOverdueOutstanding > 0 ? weightedDaysTotal / totalOverdueOutstanding : 0,
    maxWeightedAvgOverdueDays: Math.max(
      0,
      ...customers.map((customer) => customer.daysOverdue)
    ),
  }
}

function buildShortReason(
  engineReason: string,
  concern: PlaybookConcern
) {
  const adjustmentReason =
    concern === 'high'
      ? 'Your High concern applies the engine’s Priority adjustment.'
      : concern === 'medium'
        ? 'Medium is neutral, so no founder adjustment is applied.'
        : 'Your Low concern applies the engine’s Safe adjustment.'

  return `${engineReason} ${adjustmentReason}`
}

export function getInitialPlaybookConcerns(): Record<string, PlaybookConcern> {
  return Object.fromEntries(
    PLAYBOOK_CUSTOMERS.map((customer) => [customer.id, customer.defaultConcern])
  )
}

export function rankPlaybookCustomers(
  concernInput: Readonly<Record<string, unknown>> = {}
): RankedPlaybookCustomer[] {
  const context = buildContext(PLAYBOOK_CUSTOMERS)

  const ranked = PLAYBOOK_CUSTOMERS.map((customer) => {
    const concern = resolveConcern(concernInput[customer.id], customer.defaultConcern)
    const productRow = toProductRow(customer)
    const prioritized = prioritiseCustomer(
      productRow,
      context,
      concernToOverride[concern]
    )

    return {
      ...customer,
      concern,
      rank: 0,
      baseScore: prioritized.base_score,
      finalScore: prioritized.priority_score,
      shortReason: buildShortReason(prioritized.reason, concern),
    }
  }).sort(
    (a, b) =>
      b.finalScore - a.finalScore ||
      b.outstanding - a.outstanding ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )

  return ranked.map((customer, index) => ({ ...customer, rank: index + 1 }))
}

export function explainTopPlaybookCustomer(customer: RankedPlaybookCustomer) {
  const isLargest = customer.outstanding === Math.max(
    ...PLAYBOOK_CUSTOMERS.map((candidate) => candidate.outstanding)
  )
  const isOldest = customer.daysOverdue === Math.max(
    ...PLAYBOOK_CUSTOMERS.map((candidate) => candidate.daysOverdue)
  )
  const daysBeyondNormal = Math.max(0, customer.daysOverdue - customer.normalDaysLate)
  const comparison =
    !isLargest && !isOldest
      ? 'They are neither the largest balance nor the oldest debt.'
      : isLargest && !isOldest
        ? 'They have the largest balance, but value is only one part of the decision.'
        : !isLargest && isOldest
          ? 'They have the oldest debt, but age is only one part of the decision.'
          : 'They have both the largest and oldest position, but the other evidence still matters.'
  const pattern =
    daysBeyondNormal >= 20
      ? `At ${customer.daysOverdue} days overdue, they are ${daysBeyondNormal} days beyond their normal payment pattern.`
      : daysBeyondNormal > 3
        ? `Their ${customer.daysOverdue}-day delay is now outside their usual pattern by ${daysBeyondNormal} days.`
        : `Their ${customer.daysOverdue}-day delay remains close to their usual payment pattern.`
  const founderKnowledge =
    customer.concern === 'high'
      ? `Your High selection applies the same Priority adjustment used by the main engine. Example context: ${customer.highConcernContext.toLowerCase()}`
      : customer.concern === 'medium'
        ? 'Your Medium selection is neutral, so the accounting score is unchanged.'
        : 'Your Low selection applies the same Safe adjustment used by the main engine.'

  const paymentEvidence =
    customer.daysSinceLastPayment <= 7
      ? `A payment ${customer.daysSinceLastPayment} days ago provides recent evidence of movement.`
      : customer.daysSinceLastPayment > 60
        ? `No payment has been recorded for ${customer.daysSinceLastPayment} days.`
        : `The last payment was ${customer.daysSinceLastPayment} days ago.`

  return {
    heading: `Why ${customer.name} is currently first`,
    body: `${comparison} The engine sees ${currencyFormatter.format(customer.outstanding)} at stake, ${customer.daysOverdue} weighted overdue days across ${customer.overdueInvoiceCount} overdue invoices, and the last-payment evidence. ${paymentEvidence} ${founderKnowledge} For human interpretation, ${pattern.toLowerCase()} That normal-pattern comparison is shown as context, not scored separately by the current engine.`,
  }
}
