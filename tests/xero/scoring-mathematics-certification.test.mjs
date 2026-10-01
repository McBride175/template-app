import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const { computeExposureScore, computeUrgencyScore, computeBehaviourScore,
  computePrioritizationBaseScore, prioritiseCustomer, PRIORITIZATION_CONFIG, OVERRIDE_MULTIPLIERS } =
  loadTypeScriptModule('lib/collections/prioritization.ts')
const { buildRelativeLatenessContext, computeRelativeLatenessScore, calculateLinearInterpolatedPercentile } =
  loadTypeScriptModule('lib/collections/relative-lateness.ts')
const { calculateHistoricalPaymentBaseline, calculateHistoricalPaymentWindowCutoff, calculateRelativeLatenessDays } =
  loadTypeScriptModule('lib/collections/payment-behavior.ts')

const fallback = buildRelativeLatenessContext([])
const context = { totalOverdueOutstandingBase: 1500, maxOverdueOutstandingBase: 1000,
  overallWeightedAvgOverdueDays: 20, maxWeightedAvgOverdueDays: 60, relativeLateness: fallback }
const customer = (extra = {}) => ({ customer_source_id: 'c', customer_name: 'Customer', customer_email: null,
  customer_overdue_to_chase_base: 500, has_actionable_overdue_balance: true,
  invoice_overdue_to_chase_base: 500, total_outstanding_base: 500,
  overdue_invoices_count: 1, open_invoices_count: 1, weighted_avg_overdue_days: 30,
  last_payment_date: '2026-09-11', last_payment_days_ago: 20,
  has_recent_partial_payment: false, relative_lateness_days: 16.5, organisation_base_currency_code: 'GBP', ...extra })
const relative = (days, balance = 100) => ({ relativeLatenessDays: days, overdueOutstandingBase: balance })
// Only non-terminating ratios/percentile interpolation allow binary arithmetic
// error: at most eight machine epsilons at the expected magnitude. Display and
// final scores always use strict equality against literal expected values.
function assertBinary(actual, expected) {
  assert.ok(Number.isFinite(actual))
  assert.ok(Math.abs(actual - expected) <= Number.EPSILON * Math.max(1, Math.abs(expected)) * 8,
    `${actual} differs from hand-calculated ${expected}`)
}

test('authoritative weights, founder factors, and exposure denominator stay explicit', () => {
  assert.deepEqual(PRIORITIZATION_CONFIG.weights, { exposure: .5, urgency: .25, relativeDeterioration: .15, behaviour: .1 })
  assert.deepEqual(OVERRIDE_MULTIPLIERS, { safe: .4, normal: 1, priority: 1.6, do_not_chase: 0 })
  for (const [amount, total, max, expected] of [
    [Number.MIN_VALUE, Number.MIN_VALUE, Number.MIN_VALUE, 100],
    [.000001, 1000000, 1000000, 1e-10], [10, 1500, 1000, 1],
    [500, 1500, 1000, 50], [900, 1900, 1000, 90], [1000, 1900, 1000, 100],
    [500, 1000, 500, 100], [500, 2500, 500, 100], [7, 7, 7, 100],
    [1, 1000001, 1000000, .0001], [0, 1000, 1000, 0], [-1, 1000, 1000, 0],
    [500, 0, 1000, 0], [500, 1000, 0, 0], [2000, 2000, 1000, 100],
  ]) assertBinary(computeExposureScore(customer({ customer_overdue_to_chase_base: amount }), total, max), expected)
  const row = prioritiseCustomer(customer({ total_outstanding_base: 1000000,
    invoice_overdue_to_chase_base: 9000, customer_overdue_to_chase_base: 100 }), context)
  assert.equal(row.exposure_score, 10)
  assertBinary(row.exposure_share_percent, 6.666666666666667)
})

test('urgency piecewise mean/max normalization, count boundaries, caps and zero guards', () => {
  // Mean 20, max 60: ages 10/20/30/40/60 map to 25/50/62.5/75/100.
  for (const [age, count, expected] of [[0, 1, 0], [10, 1, 25], [20, 1, 50],
    [30, 1, 62.5], [40, 1, 75], [60, 1, 100], [10000, 1, 100], [-10, 1, 0],
    [30, 0, 62.5], [30, 2, 67.5], [30, 3, 72.5], [30, 4, 72.5], [30, 5, 77.5],
    [30, 500, 77.5], [60, 5, 100]]) {
    assert.equal(computeUrgencyScore(customer({ weighted_avg_overdue_days: age, overdue_invoices_count: count }), context), expected)
  }
  for (const [mean, max, age, count, expected] of [[30, 30, 30, 1, 100],
    [30, 30, 15, 1, 50], [0, 60, 30, 1, 50], [0, 0, 30, 1, 0],
    [0, 0, 30, 5, 15]]) {
    assert.equal(computeUrgencyScore(customer({ weighted_avg_overdue_days: age, overdue_invoices_count: count }),
      { ...context, overallWeightedAvgOverdueDays: mean, maxWeightedAvgOverdueDays: max }), expected)
  }
  assert.equal(computeUrgencyScore(customer({ invoice_overdue_to_chase_base: 0, overdue_invoices_count: 10 }), context), 0)
})

test('recency tests both sides of every integer-day boundary and score-neutral partial-payment flag', () => {
  for (const [days, expected] of [[-1, 0], [0, 0], [1, 10], [6, 10], [7, 10], [8, 20],
    [13, 20], [14, 20], [15, 40], [29, 40], [30, 40], [31, 60], [44, 60], [45, 60],
    [46, 80], [59, 80], [60, 80], [61, 100], [10000, 100], [null, 100]]) {
    for (const has_recent_partial_payment of [false, true]) {
      assert.equal(computeBehaviourScore(customer({ last_payment_days_ago: days, has_recent_partial_payment })), expected)
    }
  }
})

const historical = (late, settled = '2026-09-01', extra = {}) => {
  const due = new Date(`${settled}T00:00:00Z`); due.setUTCDate(due.getUTCDate() - late)
  return { type: 'ACCREC', status: 'PAID', due_date: due.toISOString().slice(0, 10), fully_paid_date: settled,
    total: '100', amount_paid: '100', amount_due: '0', amount_credited: '0', ...extra }
}

test('six calendar months, minimum three, median rather than mean, and exact historical eligibility', () => {
  assert.equal(calculateHistoricalPaymentWindowCutoff('2026-10-01'), '2026-04-01')
  assert.equal(calculateHistoricalPaymentWindowCutoff('2024-08-31'), '2024-02-29')
  const run = rows => calculateHistoricalPaymentBaseline(rows, { evaluationDate: '2026-10-01' })
  const included = [historical(-2, '2026-04-01'), historical(0), historical(8, '2026-10-01')]
  const exclusions = [historical(90, '2026-03-31'), historical(90, '2026-10-02'),
    ...[{ status: 'AUTHORISED' }, { type: 'ACCPAY' }, { total: '0' }, { amount_paid: '0' },
      { amount_due: '1' }, { amount_credited: '.010001' }, { fully_paid_date: null },
      { due_date: '2026-02-30' }].map(extra => historical(90, '2026-09-01', extra))]
  const baseline = run([...included, ...exclusions])
  assert.deepEqual(baseline, { usableInvoiceCount: 3, daysLateObservations: [-2, 0, 8], meanDaysLate: 2, normalDaysLate: 0 })
  assert.equal(run(included.slice(0, 2)).normalDaysLate, null)
  assert.equal(run([historical(1), historical(3), historical(8), historical(100)]).normalDaysLate, 5.5)
  assert.equal(run([historical(-4), historical(-2), historical(-1)]).normalDaysLate, -2)
  assert.equal(run([historical(1), historical(3), historical(8, '2026-09-01', { amount_credited: '.01' })]).usableInvoiceCount, 3)
})

test('relative deterioration compares weighted age to median without imputing sparse history', () => {
  for (const [current, median, delta, expected] of [
    [16.5, 0, 16.5, 50], [30, 30, 0, 0], [10, 20, -10, 0], [20, 20, 0, 0],
    [30, 0, 30, 100], [10000, 0, 10000, 100], [3, 0, 3, 0],
    [9.75, 0, 9.75, 25], [23.25, 0, 23.25, 75], [1000, null, null, 0],
  ]) {
    assert.equal(calculateRelativeLatenessDays(current, median), delta)
    assert.equal(computeRelativeLatenessScore(relative(delta), fallback), expected)
  }
  for (const value of [null, NaN, Infinity, -Infinity]) {
    assert.equal(computeRelativeLatenessScore(relative(value), fallback), 0)
  }
  assert.equal(computeRelativeLatenessScore(relative(30, 0), fallback), 0)
})

test('portfolio percentiles use one observation per material customer, self included, with guarded anchors', () => {
  for (const values of [[], [0, 1, 2, 3, -10], [5], [5, 20], [25, 30, 35, 40]]) {
    const actual = buildRelativeLatenessContext(values.map(value => relative(value)))
    assert.equal(actual.mode, 'absolute-fallback')
    assert.equal(actual.midpointAnchorDays, 16.5); assert.equal(actual.highAnchorDays, 30)
  }
  const observations = [25, 30, 35, 40, 45].map(value => relative(value))
  const normal = buildRelativeLatenessContext(observations)
  assert.deepEqual(normal, { mode: 'portfolio-relative', materialObservationCount: 5,
    midpointAnchorDays: 35, highAnchorDays: 48.5, materialP50Days: 35, materialP90Days: 43 })
  const expected = [34.375, 42.1875, 50, 68.51851851851852, 87.03703703703704]
  observations.forEach((row, index) => assertBinary(computeRelativeLatenessScore(row, normal), expected[index]))
  assert.deepEqual(buildRelativeLatenessContext([...observations, relative(null), relative(3), relative(100, 0)]), normal)
  assert.deepEqual(buildRelativeLatenessContext(observations.map((row, i) => ({ ...row, overdueOutstandingBase: i ? 1 : 1000000 }))), normal)
  const outlier = buildRelativeLatenessContext([10, 20, 30, 40, 1000].map(value => relative(value)))
  assert.equal(outlier.midpointAnchorDays, 30)
  assertBinary(outlier.materialP90Days, 616); assertBinary(outlier.highAnchorDays, 616)
  assert.equal(computeRelativeLatenessScore(relative(30), outlier), 50)
  assert.equal(computeRelativeLatenessScore(relative(1000), outlier), 100)
  const tied = buildRelativeLatenessContext([20, 20, 20, 20, 20].map(value => relative(value)))
  assert.equal(tied.midpointAnchorDays, 20); assert.equal(tied.highAnchorDays, 33.5)
  assert.equal(computeRelativeLatenessScore(relative(20), tied), 50)
  assert.equal(calculateLinearInterpolatedPercentile([1, 3, 5, 9], .5), 4)
  assertBinary(calculateLinearInterpolatedPercentile([1, 3, 5, 9], .9), 7.8)
  for (const values of [[], [NaN], [Infinity]]) assert.equal(calculateLinearInterpolatedPercentile(values, .9), null)
})

test('composite has four fixed weights, one-decimal rounding and no redistribution', () => {
  for (const [E, U, R, P, expected] of [[0, 0, 0, 0, 0], [100, 100, 100, 100, 100],
    [100, 0, 0, 0, 50], [0, 100, 0, 0, 25], [0, 0, 100, 0, 15], [0, 0, 0, 100, 10],
    [50, 62.5, 50, 40, 52.1], [50, 72.5, 0, 40, 47.1],
    [50.08, 0, 0, 0, 25], [50.12, 0, 0, 0, 25.1], [50.18, 0, 0, 0, 25.1],
    [99.98, 100, 100, 100, 100]]) {
    assert.equal(computePrioritizationBaseScore({ exposureScore: E, urgencyScore: U,
      relativeDeteriorationScore: R, paymentRecencyScore: P }), expected)
  }
  const scored = prioritiseCustomer(customer(), context)
  assert.deepEqual([scored.exposure_score, scored.urgency_score, scored.relative_lateness_score,
    scored.payment_recency_score, scored.base_score], [50, 62.5, 50, 40, 52.1])
})

test('founder multiplication follows base rounding, precedes final rounding/ranking, and is not capped at 100', () => {
  const cases = [
    [customer({ customer_overdue_to_chase_base: 2, invoice_overdue_to_chase_base: 0, last_payment_days_ago: 0 }), .1, [0, .1, .2, 0]],
    [customer(), 52.1, [20.8, 52.1, 83.4, 0]],
    [customer({ customer_overdue_to_chase_base: 1000, weighted_avg_overdue_days: 60,
      relative_lateness_days: 30, last_payment_days_ago: null }), 100, [40, 100, 160, 0]],
    [customer({ customer_overdue_to_chase_base: 248.8, invoice_overdue_to_chase_base: 0,
      last_payment_days_ago: 0 }), 12.4, [5, 12.4, 19.8, 0]],
  ]
  for (const [input, base, finals] of cases) {
    for (const [index, level] of ['safe', 'normal', 'priority', 'do_not_chase'].entries()) {
      const result = prioritiseCustomer(input, context, level)
      assert.equal(result.base_score, base)
      assert.equal(result.final_score, finals[index])
      assert.equal(result.priority_score, finals[index])
    }
  }
})

test('display-rounded components never feed the weighted composite', () => {
  const input = customer({ overdue_invoices_count: 3, relative_lateness_days: null })
  const scored = prioritiseCustomer(input, context)
  // Urgency is 72.5. Rounding the component to an integer before weighting
  // would produce 47.25 -> 47.3, instead of the correct 47.125 -> 47.1.
  assert.equal(scored.urgency_score, 72.5); assert.equal(scored.base_score, 47.1)
  assert.match(scored.score_breakdown_lines.join('\n'), /invoice bonus 10, cap 100 -> 72\.5/)
  const again = prioritiseCustomer({ ...input, ...scored, base_score: 999, priority_score: 999,
    score_breakdown_lines: ['999'] }, context)
  assert.equal(again.base_score, 47.1)
})
