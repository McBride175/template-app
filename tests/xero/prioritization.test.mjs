import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const {
  computeBehaviourScore,
  computeExposureScore,
  computePrioritizationBaseScore,
  computeUrgencyScore,
  prioritiseCustomer,
} = loadTypeScriptModule('lib/collections/prioritization.ts')
const { buildRelativeLatenessContext } = loadTypeScriptModule(
  'lib/collections/relative-lateness.ts'
)

function buildCustomer(overrides = {}) {
  return {
    customer_source_id: 'customer-1',
    customer_name: 'Example Customer',
    customer_email: null,
    overdue_outstanding_base: 500,
    total_outstanding_base: 500,
    overdue_invoices_count: 3,
    open_invoices_count: 3,
    weighted_avg_overdue_days: 30,
    last_payment_date: '2026-08-21',
    last_payment_days_ago: 20,
    has_recent_partial_payment: false,
    relative_lateness_days: null,
    organisation_base_currency_code: 'GBP',
    ...overrides,
  }
}

const context = {
  totalOverdueOutstandingBase: 1_500,
  maxOverdueOutstandingBase: 1_000,
  overallWeightedAvgOverdueDays: 20,
  maxWeightedAvgOverdueDays: 60,
  relativeLateness: buildRelativeLatenessContext([]),
}

test('locks the production exposure, urgency, relative-deterioration, payment-recency and adjustment formula', () => {
  const customer = buildCustomer()

  assert.equal(computeExposureScore(customer, 1_500, 1_000), 50)
  assert.equal(computeUrgencyScore(customer, context), 72.5)
  assert.equal(computeBehaviourScore(customer), 40)

  const normal = prioritiseCustomer(customer, context, 'normal')
  const safe = prioritiseCustomer(customer, context, 'safe')
  const priority = prioritiseCustomer(customer, context, 'priority')
  const doNotChase = prioritiseCustomer(customer, context, 'do_not_chase')

  // 50 × .50 + 72.5 × .25 + 0 × .15 + 40 × .10 = 47.125, rounded to 47.1.
  assert.equal(normal.relative_lateness_score, 0)
  assert.equal(normal.base_score, 47.1)
  assert.equal(normal.final_score, 47.1)
  assert.equal(safe.final_score, 18.8)
  assert.equal(priority.final_score, 75.4)
  assert.equal(doNotChase.final_score, 0)
  assert.equal(normal.recommended_action, 'Follow up')
  assert.equal(priority.recommended_action, 'Review now')
  assert.equal(safe.recommended_action, 'Monitor')
  assert.equal(doNotChase.recommended_action, 'No action')
})

test('locks each production component weight and the all-maximum total', () => {
  assert.equal(
    computePrioritizationBaseScore({
      exposureScore: 100,
      urgencyScore: 0,
      relativeDeteriorationScore: 0,
      paymentRecencyScore: 0,
    }),
    50
  )
  assert.equal(
    computePrioritizationBaseScore({
      exposureScore: 0,
      urgencyScore: 100,
      relativeDeteriorationScore: 0,
      paymentRecencyScore: 0,
    }),
    25
  )
  assert.equal(
    computePrioritizationBaseScore({
      exposureScore: 0,
      urgencyScore: 0,
      relativeDeteriorationScore: 100,
      paymentRecencyScore: 0,
    }),
    15
  )
  assert.equal(
    computePrioritizationBaseScore({
      exposureScore: 0,
      urgencyScore: 0,
      relativeDeteriorationScore: 0,
      paymentRecencyScore: 100,
    }),
    10
  )
  assert.equal(
    computePrioritizationBaseScore({
      exposureScore: 100,
      urgencyScore: 100,
      relativeDeteriorationScore: 100,
      paymentRecencyScore: 100,
    }),
    100
  )
})

test('partial-payment status is score-neutral at component, final-score and explanation level', () => {
  const withoutPartialPayment = buildCustomer({ has_recent_partial_payment: false })
  const withPartialPayment = buildCustomer({ has_recent_partial_payment: true })

  assert.equal(computeBehaviourScore(withoutPartialPayment), 40)
  assert.equal(computeBehaviourScore(withPartialPayment), 40)

  for (const adjustment of ['safe', 'normal', 'priority', 'do_not_chase']) {
    const withoutResult = prioritiseCustomer(withoutPartialPayment, context, adjustment)
    const withResult = prioritiseCustomer(withPartialPayment, context, adjustment)

    assert.equal(withResult.base_score, withoutResult.base_score)
    assert.equal(withResult.final_score, withoutResult.final_score)
    assert.equal(withResult.priority_score, withoutResult.priority_score)
    assert.equal(withResult.recommended_action, withoutResult.recommended_action)
    assert.deepEqual(withResult.score_breakdown_lines, withoutResult.score_breakdown_lines)
    assert.doesNotMatch(withResult.reason, /partial payment/i)
    assert.equal(
      withResult.score_breakdown_lines.some((line) => /partial payment/i.test(line)),
      false
    )
  }
})

test('payment recency keeps the established bands after partial-payment removal', () => {
  const cases = [
    [0, 0],
    [1, 10],
    [7, 10],
    [8, 20],
    [14, 20],
    [15, 40],
    [30, 40],
    [31, 60],
    [45, 60],
    [46, 80],
    [60, 80],
    [61, 100],
    [180, 100],
    [null, 100],
  ]

  for (const [daysAgo, expected] of cases) {
    assert.equal(
      computeBehaviourScore(buildCustomer({ last_payment_days_ago: daysAgo })),
      expected
    )
  }
})

test('overdue invoice count still contributes only through the urgency bands', () => {
  const expectedByInvoiceCount = new Map([
    [1, 62.5],
    [2, 67.5],
    [3, 72.5],
    [4, 72.5],
    [5, 77.5],
  ])

  for (const [invoiceCount, expected] of expectedByInvoiceCount) {
    assert.equal(
      computeUrgencyScore(
        buildCustomer({ overdue_invoices_count: invoiceCount }),
        context
      ),
      expected
    )
  }
})

test('missing history and sufficient history with no deterioration both contribute zero without redistribution', () => {
  const insufficient = prioritiseCustomer(
    buildCustomer({ relative_lateness_days: null }),
    context,
    'normal'
  )
  const sufficientButNormal = prioritiseCustomer(
    buildCustomer({ relative_lateness_days: 0 }),
    context,
    'normal'
  )
  const materiallyDeteriorated = prioritiseCustomer(
    buildCustomer({ relative_lateness_days: 30 }),
    context,
    'normal'
  )

  assert.equal(insufficient.relative_lateness_score, 0)
  assert.equal(sufficientButNormal.relative_lateness_score, 0)
  assert.equal(insufficient.base_score, sufficientButNormal.base_score)
  assert.equal(materiallyDeteriorated.relative_lateness_score, 100)
  assert.equal(materiallyDeteriorated.base_score, insufficient.base_score + 15)
  assert.match(insufficient.score_breakdown_lines.join('\n'), /not enough recent payment history/i)
  assert.match(insufficient.score_breakdown_lines.join('\n'), /0\.0\/100 × 0\.15 = 0\.0/)
})

test('the existing founder multiplier and rounding order remain unchanged', () => {
  const customer = buildCustomer({ relative_lateness_days: 30 })
  const normal = prioritiseCustomer(customer, context, 'normal')
  const safe = prioritiseCustomer(customer, context, 'safe')
  const priority = prioritiseCustomer(customer, context, 'priority')
  const doNotChase = prioritiseCustomer(customer, context, 'do_not_chase')

  assert.equal(normal.base_score, 62.1)
  assert.equal(safe.base_score, normal.base_score)
  assert.equal(priority.base_score, normal.base_score)
  assert.equal(doNotChase.base_score, normal.base_score)
  assert.equal(safe.final_score, Number((normal.base_score * 0.4).toFixed(1)))
  assert.equal(normal.final_score, Number((normal.base_score * 1).toFixed(1)))
  assert.equal(priority.final_score, Number((normal.base_score * 1.6).toFixed(1)))
  assert.equal(doNotChase.final_score, 0)
})

test('primary reasons distinguish score denominators and user adjustments', () => {
  const normal = prioritiseCustomer(buildCustomer(), context, 'normal')
  const safe = prioritiseCustomer(buildCustomer(), context, 'safe')
  const priority = prioritiseCustomer(buildCustomer(), context, 'priority')
  const doNotChase = prioritiseCustomer(buildCustomer(), context, 'do_not_chase')

  assert.match(normal.reason, /50\.0% of the largest eligible overdue balance/i)
  assert.match(normal.reason, /33\.3% of total overdue AR/i)
  assert.match(safe.reason, /Safe adjustment.*reduces the accounting score/i)
  assert.match(priority.reason, /Priority adjustment.*increases the accounting score/i)
  assert.match(doNotChase.reason, /^No chase is suggested because you set this customer to Do not chase\./)
  assert.doesNotMatch(doNotChase.reason, /Prioritised because/i)
})

test('customer-relative deterioration is explained as a business signal', () => {
  const relativeOnlyContext = {
    totalOverdueOutstandingBase: 1_000,
    maxOverdueOutstandingBase: 10_000,
    overallWeightedAvgOverdueDays: 0,
    maxWeightedAvgOverdueDays: 0,
    relativeLateness: buildRelativeLatenessContext([
      { overdueOutstandingBase: 500, relativeLatenessDays: 30 },
    ]),
  }
  const result = prioritiseCustomer(
    buildCustomer({
      overdue_invoices_count: 0,
      weighted_avg_overdue_days: 0,
      last_payment_days_ago: 0,
      relative_lateness_days: 30,
    }),
    relativeOnlyContext,
    'normal'
  )

  assert.match(result.reason, /30 days later than this customer's recent normal payment timing/i)
  assert.doesNotMatch(result.reason, /P50|P90|16\.5|percentile/i)
})

function buildScenarioContext(customers) {
  const totalOverdueOutstandingBase = customers.reduce(
    (total, customer) => total + customer.overdue_outstanding_base,
    0
  )

  return {
    totalOverdueOutstandingBase,
    maxOverdueOutstandingBase: Math.max(
      ...customers.map((customer) => customer.overdue_outstanding_base)
    ),
    overallWeightedAvgOverdueDays:
      customers.reduce(
        (total, customer) =>
          total + customer.overdue_outstanding_base * customer.weighted_avg_overdue_days,
        0
      ) / totalOverdueOutstandingBase,
    maxWeightedAvgOverdueDays: Math.max(
      ...customers.map((customer) => customer.weighted_avg_overdue_days)
    ),
    relativeLateness: buildRelativeLatenessContext(
      customers.map((customer) => ({
        overdueOutstandingBase: customer.overdue_outstanding_base,
        relativeLatenessDays: customer.relative_lateness_days,
      }))
    ),
  }
}

function rankScenario(customers, overrideByCustomerId = {}) {
  const scenarioContext = buildScenarioContext(customers)
  return customers
    .map((customer) =>
      prioritiseCustomer(
        customer,
        scenarioContext,
        overrideByCustomerId[customer.customer_source_id] ?? 'normal'
      )
    )
    .sort(
      (left, right) =>
        right.priority_score - left.priority_score ||
        right.overdue_outstanding_base - left.overdue_outstanding_base ||
        left.customer_name.localeCompare(right.customer_name)
    )
}

test('end-to-end ranking preserves the agreed hierarchy across conflicting signals', () => {
  const customers = [
    buildCustomer({
      customer_source_id: 'high-exposure',
      customer_name: 'High exposure, modest lateness',
      overdue_outstanding_base: 10_000,
      total_outstanding_base: 10_000,
      overdue_invoices_count: 1,
      weighted_avg_overdue_days: 10,
      last_payment_days_ago: 5,
      relative_lateness_days: 2,
    }),
    buildCustomer({
      customer_source_id: 'prompt-deteriorating',
      customer_name: 'Prompt payer deteriorating',
      overdue_outstanding_base: 5_000,
      total_outstanding_base: 5_000,
      overdue_invoices_count: 1,
      weighted_avg_overdue_days: 25,
      relative_lateness_days: 25,
    }),
    buildCustomer({
      customer_source_id: 'habitual-slow',
      customer_name: 'Habitual slow payer',
      overdue_outstanding_base: 5_000,
      total_outstanding_base: 5_000,
      overdue_invoices_count: 2,
      weighted_avg_overdue_days: 50,
      relative_lateness_days: 4,
    }),
    buildCustomer({
      customer_source_id: 'both-bad',
      customer_name: 'Both lateness signals bad',
      overdue_outstanding_base: 6_000,
      total_outstanding_base: 6_000,
      overdue_invoices_count: 3,
      weighted_avg_overdue_days: 55,
      last_payment_days_ago: 50,
      relative_lateness_days: 45,
    }),
    buildCustomer({
      customer_source_id: 'tiny-extreme',
      customer_name: 'Tiny balance, extreme deterioration',
      overdue_outstanding_base: 100,
      total_outstanding_base: 100,
      overdue_invoices_count: 1,
      weighted_avg_overdue_days: 80,
      last_payment_days_ago: 70,
      relative_lateness_days: 100,
    }),
    buildCustomer({
      customer_source_id: 'insufficient-history',
      customer_name: 'Insufficient history',
      overdue_outstanding_base: 4_000,
      total_outstanding_base: 4_000,
      overdue_invoices_count: 1,
      weighted_avg_overdue_days: 30,
      last_payment_days_ago: 35,
      relative_lateness_days: null,
    }),
    buildCustomer({
      customer_source_id: 'founder-priority',
      customer_name: 'Founder priority',
      overdue_outstanding_base: 4_000,
      total_outstanding_base: 4_000,
      overdue_invoices_count: 1,
      weighted_avg_overdue_days: 25,
      relative_lateness_days: 12,
    }),
  ]

  const neutral = rankScenario(customers)
  const withFounderPriority = rankScenario(customers, { 'founder-priority': 'priority' })
  const neutralById = Object.fromEntries(neutral.map((customer) => [customer.customer_source_id, customer]))
  const prioritizedById = Object.fromEntries(
    withFounderPriority.map((customer) => [customer.customer_source_id, customer])
  )

  assert.equal(neutral[0].customer_source_id, 'both-bad')
  assert.ok(
    neutralById['high-exposure'].priority_score > neutralById['tiny-extreme'].priority_score,
    '15% relative deterioration must not overwhelm a dramatically larger exposure'
  )
  assert.ok(neutralById['habitual-slow'].relative_lateness_score < 5)
  assert.ok(computeUrgencyScore(neutralById['habitual-slow'], buildScenarioContext(customers)) > 70)
  assert.equal(neutralById['insufficient-history'].relative_lateness_score, 0)
  assert.ok(neutralById['insufficient-history'].priority_score > 0)
  assert.ok(neutralById['prompt-deteriorating'].relative_lateness_score >= 50)
  assert.ok(neutralById['both-bad'].relative_lateness_score > 50)
  assert.equal(neutralById['tiny-extreme'].relative_lateness_score, 100)

  const promptWithoutDeterioration = prioritiseCustomer(
    { ...neutralById['prompt-deteriorating'], relative_lateness_days: 0 },
    buildScenarioContext(customers),
    'normal'
  )
  assert.equal(
    neutralById['prompt-deteriorating'].base_score - promptWithoutDeterioration.base_score,
    7.5
  )

  assert.equal(neutral.findIndex((customer) => customer.customer_source_id === 'founder-priority') + 1, 7)
  assert.equal(
    withFounderPriority.findIndex((customer) => customer.customer_source_id === 'founder-priority') + 1,
    2
  )
  assert.equal(
    prioritizedById['founder-priority'].final_score,
    Number((prioritizedById['founder-priority'].base_score * 1.6).toFixed(1))
  )
})
