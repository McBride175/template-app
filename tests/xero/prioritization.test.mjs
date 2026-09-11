import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const {
  computeBehaviourScore,
  computeExposureScore,
  computeUrgencyScore,
  prioritiseCustomer,
} = loadTypeScriptModule('lib/collections/prioritization.ts')

function buildCustomer(overrides = {}) {
  return {
    customer_source_id: 'customer-1',
    customer_name: 'Example Customer',
    customer_email: null,
    overdue_outstanding: 500,
    total_outstanding: 500,
    overdue_invoices_count: 3,
    open_invoices_count: 3,
    weighted_avg_overdue_days: 30,
    last_payment_date: '2026-08-21',
    last_payment_days_ago: 20,
    has_recent_partial_payment: false,
    currency_code: 'GBP',
    ...overrides,
  }
}

const context = {
  totalOverdueOutstanding: 1_500,
  maxOverdueOutstanding: 1_000,
  overallWeightedAvgOverdueDays: 20,
  maxWeightedAvgOverdueDays: 60,
}

test('locks the current exposure, urgency, payment-recency and adjustment formula', () => {
  const customer = buildCustomer()

  assert.equal(computeExposureScore(customer, 1_500, 1_000), 50)
  assert.equal(computeUrgencyScore(customer, context), 72.5)
  assert.equal(computeBehaviourScore(customer), 40)

  const normal = prioritiseCustomer(customer, context, 'normal')
  const safe = prioritiseCustomer(customer, context, 'safe')
  const priority = prioritiseCustomer(customer, context, 'priority')
  const doNotChase = prioritiseCustomer(customer, context, 'do_not_chase')

  // 50 × .50 + 72.5 × .35 + 40 × .15 = 56.375, rounded to 56.4.
  assert.equal(normal.base_score, 56.4)
  assert.equal(normal.final_score, 56.4)
  assert.equal(safe.final_score, 22.6)
  assert.equal(priority.final_score, 90.2)
  assert.equal(doNotChase.final_score, 0)
  assert.equal(normal.recommended_action, 'Follow up')
  assert.equal(priority.recommended_action, 'Review now')
  assert.equal(safe.recommended_action, 'Monitor')
  assert.equal(doNotChase.recommended_action, 'No action')
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

test('relative lateness remains diagnostic-only and cannot change the current score', () => {
  const baseline = prioritiseCustomer(
    buildCustomer({ relative_lateness_days: -15, historical_normal_days_late: 45 }),
    context,
    'normal'
  )
  const deteriorated = prioritiseCustomer(
    buildCustomer({ relative_lateness_days: 75, historical_normal_days_late: 0 }),
    context,
    'normal'
  )

  assert.equal(deteriorated.base_score, baseline.base_score)
  assert.equal(deteriorated.final_score, baseline.final_score)
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
