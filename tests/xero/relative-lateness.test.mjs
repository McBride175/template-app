import assert from 'node:assert/strict'
import test from 'node:test'
import { performance } from 'node:perf_hooks'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const {
  MINIMUM_MATERIAL_RELATIVE_LATENESS_PORTFOLIO_SIZE,
  RELATIVE_LATENESS_ABSOLUTE_MAXIMUM_REFERENCE_DAYS,
  RELATIVE_LATENESS_MIDPOINT_ABSOLUTE_FLOOR_DAYS,
  RELATIVE_LATENESS_MINIMUM_UPPER_SPAN_DAYS,
  RELATIVE_LATENESS_NOISE_FLOOR_DAYS,
  buildRelativeLatenessContext,
  calculateLinearInterpolatedPercentile,
  computeRelativeLatenessScore,
} = loadTypeScriptModule('lib/collections/relative-lateness.ts')

function customer(relativeLatenessDays, overdueOutstandingBase = 100) {
  return { relativeLatenessDays, overdueOutstandingBase }
}

function scorePortfolio(values, overdueBalances = values.map(() => 100)) {
  const customers = values.map((value, index) => customer(value, overdueBalances[index]))
  const context = buildRelativeLatenessContext(customers)
  const scores = customers.map((value) => computeRelativeLatenessScore(value, context))
  return { context, scores }
}

function assertClose(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`
  )
}

test('keeps the normalization constants explicit and recalibratable', () => {
  assert.equal(RELATIVE_LATENESS_NOISE_FLOOR_DAYS, 3)
  assert.equal(MINIMUM_MATERIAL_RELATIVE_LATENESS_PORTFOLIO_SIZE, 5)
  assert.equal(RELATIVE_LATENESS_ABSOLUTE_MAXIMUM_REFERENCE_DAYS, 30)
  assert.equal(RELATIVE_LATENESS_MIDPOINT_ABSOLUTE_FLOOR_DAYS, 16.5)
  assert.equal(RELATIVE_LATENESS_MINIMUM_UPPER_SPAN_DAYS, 13.5)
})

test('calculates deterministic linearly interpolated percentiles', () => {
  assert.equal(calculateLinearInterpolatedPercentile([1, 3, 9], 0.5), 3)
  assertClose(calculateLinearInterpolatedPercentile([1, 3, 9], 0.9), 7.8)
  assert.equal(calculateLinearInterpolatedPercentile([1, 3, 5, 9], 0.5), 4)
  assertClose(calculateLinearInterpolatedPercentile([1, 3, 5, 9], 0.9), 7.8)
  assertClose(calculateLinearInterpolatedPercentile([0, 10, 20, 100, 1000], 0.9), 640)
  assert.equal(calculateLinearInterpolatedPercentile([5], 0.9), 5)
})

test('scores every value at or below the three-day noise floor as zero', () => {
  const values = [-20, 0, 1, 2, 3, 3.0001]
  const { context, scores } = scorePortfolio(values)

  assert.equal(context.materialObservationCount, 1)
  assert.deepEqual(scores.slice(0, 5), [0, 0, 0, 0, 0])
  assert.ok(scores[5] > 0)
})

test('uses the absolute fallback curve for fewer than five material customers', () => {
  const values = [4, 5, 10, 16, 20, 25, 30, 100]

  for (const value of values) {
    const { context, scores } = scorePortfolio([value])
    const expected = Math.min(100, (100 * (value - 3)) / 27)

    assert.equal(context.mode, 'absolute-fallback')
    assertClose(scores[0], expected)
  }
})

test('does not let a singleton define its own maximum-risk score', () => {
  assertClose(scorePortfolio([5]).scores[0], 7.407407407407407)
  assertClose(scorePortfolio([16]).scores[0], 48.148148148148145)
  assert.equal(scorePortfolio([100]).scores[0], 100)
})

test('keeps both two-customer examples on the absolute fallback', () => {
  const first = scorePortfolio([5, 20])
  const second = scorePortfolio([20, 25])

  assert.equal(first.context.mode, 'absolute-fallback')
  assert.equal(second.context.mode, 'absolute-fallback')
  assertClose(first.scores[0], 7.407407407407407)
  assertClose(first.scores[1], 62.96296296296296)
  assertClose(second.scores[0], 62.96296296296296)
  assertClose(second.scores[1], 81.48148148148148)
})

test('switches to portfolio-relative mode at exactly five material observations', () => {
  const four = scorePortfolio([25, 30, 35, 40])
  const five = scorePortfolio([25, 30, 35, 40, 45])

  assert.equal(four.context.materialObservationCount, 4)
  assert.equal(four.context.mode, 'absolute-fallback')
  assert.equal(five.context.materialObservationCount, 5)
  assert.equal(five.context.mode, 'portfolio-relative')
  assert.equal(five.context.materialP50Days, 35)
  assert.equal(five.context.materialP90Days, 43)
  assert.equal(five.context.midpointAnchorDays, 35)
  assert.equal(five.context.highAnchorDays, 48.5)
})

test('scores the healthy portfolio without allowing noise to set the scale', () => {
  const { context, scores } = scorePortfolio([2, 3, 5, 12, 40])

  assert.equal(context.materialObservationCount, 3)
  assert.equal(context.mode, 'absolute-fallback')
  assert.deepEqual(scores.slice(0, 2), [0, 0])
  assertClose(scores[2], 7.407407407407407)
  assertClose(scores[3], 33.333333333333336)
  assert.equal(scores[4], 100)
})

test('uses robust portfolio anchors for broad deterioration', () => {
  const { context, scores } = scorePortfolio([25, 30, 35, 40, 45])

  assert.deepEqual(context, {
    mode: 'portfolio-relative',
    materialObservationCount: 5,
    midpointAnchorDays: 35,
    highAnchorDays: 48.5,
    materialP50Days: 35,
    materialP90Days: 43,
  })
  const expected = [34.375, 42.1875, 50, 68.51851851851852, 87.03703703703704]
  scores.forEach((score, index) => assertClose(score, expected[index]))
})

test('keeps middle customers visible beside an extreme outlier', () => {
  const { context, scores } = scorePortfolio([3, 6, 9, 12, 100])

  assert.equal(context.materialObservationCount, 4)
  assert.equal(context.mode, 'absolute-fallback')
  const expected = [0, 11.11111111111111, 22.22222222222222, 33.333333333333336, 100]
  scores.forEach((score, index) => assertClose(score, expected[index]))
})

test('applies the absolute anchor backstops to a narrow portfolio', () => {
  const { context, scores } = scorePortfolio([8, 10, 12, 14, 16])

  assert.equal(context.mode, 'portfolio-relative')
  assert.equal(context.materialP50Days, 12)
  assertClose(context.materialP90Days, 15.2)
  assert.equal(context.midpointAnchorDays, 16.5)
  assert.equal(context.highAnchorDays, 30)
  const expected = [
    18.51851851851852,
    25.925925925925924,
    33.333333333333336,
    40.74074074074074,
    48.148148148148145,
  ]
  scores.forEach((score, index) => assertClose(score, expected[index]))
})

test('excludes insufficient history and noise from the reference population', () => {
  const baseCustomers = [25, 30, 35, 40, 45].map((value) => customer(value))
  const baseContext = buildRelativeLatenessContext(baseCustomers)
  const withNonEvidence = buildRelativeLatenessContext([
    ...baseCustomers,
    customer(null),
    customer(Number.NaN),
    customer(1),
    customer(2),
    customer(3),
    customer(100, 0),
  ])

  assert.deepEqual(withNonEvidence, baseContext)
  assert.equal(computeRelativeLatenessScore(customer(null), baseContext), 0)
  assert.equal(computeRelativeLatenessScore(customer(Number.NaN), baseContext), 0)
})

test('uses one equal observation per customer regardless of overdue balance', () => {
  const relativeValues = [5, 10, 15, 20, 40]
  const balanced = scorePortfolio(relativeValues, [100, 100, 100, 100, 100])
  const largeBalanceAtFive = scorePortfolio(relativeValues, [100_000, 1, 1, 1, 1])
  const largeBalanceAtForty = scorePortfolio(relativeValues, [1, 1, 1, 1, 100_000])

  assert.deepEqual(largeBalanceAtFive.context, balanced.context)
  assert.deepEqual(largeBalanceAtForty.context, balanced.context)
  assert.deepEqual(largeBalanceAtFive.scores, balanced.scores)
  assert.deepEqual(largeBalanceAtForty.scores, balanced.scores)
})

test('builds portfolio context once for thousands of customers', (context) => {
  const customers = Array.from({ length: 5_000 }, (_, index) =>
    customer((index % 100) + 1, index + 1)
  )
  const startedAt = performance.now()
  const relativeContext = buildRelativeLatenessContext(customers)
  const scores = customers.map((value) => computeRelativeLatenessScore(value, relativeContext))
  const elapsedMilliseconds = performance.now() - startedAt

  assert.equal(relativeContext.materialObservationCount, 4_850)
  assert.equal(scores.length, 5_000)
  assert.equal(scores.every((score) => score >= 0 && score <= 100), true)
  context.diagnostic(
    `Built one context and scored 5,000 customers in ${elapsedMilliseconds.toFixed(2)} ms`
  )
})
