import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
import { scenarios, captureFeatureInput, EVALUATION_INSTANT } from './test-helpers/calculation-parity-fixture.mjs'
import { expectedByName } from './test-helpers/calculation-goldens.mjs'

const { calculateCustomerFinancialFeatures } = loadTypeScriptModule('lib/collections/customer-features.ts')
const { calculatePortfolioBenchmarks, calculatePortfolioBaseScores } = loadTypeScriptModule('lib/collections/portfolio-benchmarks.ts')
const { calculateBaseCustomerScore, adjustCustomerPriority, applyFounderOverride, PRIORITIZATION_CONFIG } = loadTypeScriptModule('lib/collections/prioritization.ts')
const { projectCollectionQueue } = loadTypeScriptModule('lib/collections/queue-projection.ts')
const json = value => JSON.parse(JSON.stringify(value))
const scenarioByName = new Map(scenarios.map(s => [s.name, s]))
const calculation = name => {
  const reference = expectedByName.get(name)
  const scenario = scenarioByName.get(name)
  const overdueOnly = new URLSearchParams(scenario.query ?? 'overdueOnly=true').get('overdueOnly') === 'true'
  const benchmarks = calculatePortfolioBenchmarks({ rows: reference.summary.rows, overdueOnly })
  return { reference, benchmarks, scores: calculatePortfolioBaseScores(benchmarks, reference.summary.organisationBaseCurrency) }
}
const baseById = (state, id) => state.scores.find(s => s.features.customer_source_id === id).base
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of value instanceof Map ? value.values() : Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

for (const scenario of scenarios) {
  test(`pure contracts reproduce independent golden: ${scenario.name}`, async () => {
    const expected = expectedByName.get(scenario.name)
    const input = await captureFeatureInput(scenario)
    const before = structuredClone(input)
    freeze(input)
    if (expected.summary.error) {
      assert.throws(() => calculateCustomerFinancialFeatures(input), error => error.message === expected.summary.error)
      assert.deepEqual(input, before)
      return
    }
    const features = calculateCustomerFinancialFeatures(input)
    const expectedFeatures = { ...expected.summary }
    delete expectedFeatures.snapshot
    assert.deepEqual(json(features), expectedFeatures)
    assert.deepEqual(input, before, 'feature extraction must not mutate held inputs')
    if (features.currencyHealth.status === 'unavailable' || !features.organisationBaseCurrency) {
      assert.deepEqual(expected.queue.body.rows, [])
      assert.equal(expected.queue.body.queue.status, 'currency_data_unavailable')
      return // The route intentionally gates unavailable currency before scoring.
    }
    const { benchmarks, scores } = calculation(scenario.name)
    assert.deepEqual(scores.map(s => s.base.row.customer_source_id), expected.observed.map(s => s.row.customer_source_id))
    for (let index = 0; index < scores.length; index++) {
      const { base } = scores[index]
      const observed = expected.observed[index]
      assert.deepEqual(json(base.row), observed.row)
      assert.deepEqual(json(base.context), observed.context)
      assert.deepEqual(json(base.componentScores), {
        exposureScore: observed.result.exposure_score, urgencyScore: observed.result.urgency_score,
        relativeDeteriorationScore: observed.result.relative_lateness_score,
        paymentRecencyScore: observed.result.payment_recency_score,
      })
      assert.equal(base.baseScore, observed.result.base_score)
      assert.equal(base.validity, 'finite')
      assert.deepEqual(json(adjustCustomerPriority(base, observed.override)), observed.result)
    }
    const latestV1ByCustomerSourceId = new Map()
    const latestLegacyActionByCustomerSourceId = new Map()
    for (const action of [...(scenario.actions ?? [])].sort((a, b) => a.action_timestamp.localeCompare(b.action_timestamp) || a.id.localeCompare(b.id))) {
      if (action.action_type === 'outcome') latestV1ByCustomerSourceId.set(action.customer_source_id, action)
      else latestLegacyActionByCustomerSourceId.set(action.customer_source_id, {
        type: action.action_type, takenAtIso: action.action_timestamp, outcome: action.outcome,
        nextActionDate: action.next_action_date, actionId: action.id,
      })
    }
    const instant = new Date(scenario.instant ?? EVALUATION_INSTANT)
    const organisationTodayDateIso = new Intl.DateTimeFormat('en-CA', {
      timeZone: features.organisationTimezone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(instant)
    const params = new URLSearchParams(scenario.query ?? 'overdueOnly=true')
    const projectionInput = {
      benchmarks, baseScores: scores, organisationBaseCurrency: features.organisationBaseCurrency,
      currencyHealth: features.currencyHealth, sourceCounts: features.sourceCounts,
      reviewRequiredCustomerCount: features.reviewRequiredCustomers.length,
      overrideLevelByCustomerSourceId: new Map(scenario.overrides ?? []),
      latestV1ByCustomerSourceId, latestLegacyActionByCustomerSourceId,
      actionsTakenByCustomerId: expected.queue.body.actionsTakenByCustomerId,
      organisationTodayDateIso, legacyTodayDateIso: instant.toISOString().slice(0, 10),
      limit: Number(params.get('limit') ?? 50),
    }
    const projectionBefore = structuredClone(projectionInput)
    freeze(projectionInput)
    const projection = projectCollectionQueue(projectionInput)
    assert.deepEqual(json(projection.rows), expected.queue.body.rows)
    assert.deepEqual(json(projection.queue), expected.queue.body.queue)
    assert.deepEqual(json(projection.portfolio), expected.queue.body.portfolio)
    assert.deepEqual(projectionInput, projectionBefore, 'projection must not mutate reusable scores or features')
  })
}

test('weights, rounding and all founder adjustments remain downstream of an identical base', () => {
  assert.deepEqual(PRIORITIZATION_CONFIG.weights, { exposure: .5, urgency: .25, relativeDeterioration: .15, behaviour: .1 })
  const { scores } = calculation('basic')
  const base = freeze(scores[0].base)
  const before = structuredClone(base)
  for (const [level, multiplier] of [['safe', .4], ['normal', 1], ['priority', 1.6], ['do_not_chase', 0]]) {
    const adjusted = adjustCustomerPriority(base, level)
    assert.equal(adjusted.base_score, base.baseScore)
    assert.equal(adjusted.override_multiplier, multiplier)
    assert.equal(adjusted.final_score, Number((base.baseScore * multiplier).toFixed(1)))
    assert.deepEqual(adjusted, expectedByName.get(`override-${level}`).observed[0].result)
    assert.deepEqual(base, before)
  }
  assert.deepEqual(applyFounderOverride(base.baseScore, null), applyFounderOverride(base.baseScore, 'normal'))
})

for (const [original, changed] of [
  ...['safe', 'normal', 'priority', 'do_not_chase'].map(level => ['basic', `override-${level}`]),
  ['basic', 'action-record'], ['basic', 'action-undo'], ['basic', 'legacy-action-today'],
  ['dispute-partial', 'dispute-note'], ['dispute-partial', 'dispute-confirmed'],
  ['promise-partial', 'promise-note-only'], ['promise-partial', 'promise-date-only'],
]) {
  test(`nonfinancial changes reuse exact features, benchmarks and base: ${original} -> ${changed}`, () => {
    const a = calculation(original), b = calculation(changed)
    assert.deepEqual(b.reference.summary, a.reference.summary)
    assert.deepEqual(b.benchmarks, a.benchmarks)
    assert.deepEqual(b.scores, a.scores)
  })
}

test('display limits cannot reduce scoring populations; Action History suppresses only the queue projection', () => {
  const basic = calculation('basic'), limited = calculation('limit-one'), acted = calculation('action-record')
  assert.deepEqual(limited.benchmarks, basic.benchmarks)
  assert.deepEqual(limited.scores, basic.scores)
  assert.equal(limited.reference.queue.body.rows.length, 1)
  assert.deepEqual(acted.scores, basic.scores)
  assert.ok(acted.reference.queue.body.rows.length < basic.reference.queue.body.rows.length)
  assert.deepEqual(acted.reference.queue.body.queue.relativeLateness, basic.reference.queue.body.queue.relativeLateness)
})

for (const kind of ['overpayment', 'prepayment', 'credit_note', 'combined', 'zero-debt', 'excess']) {
  test(`credit preserves pre-credit ageing population: ${kind}`, () => {
    const basic = calculation('basic'), covered = calculation(`credit-${kind}`)
    const a = basic.reference.summary.rows.find(r => r.customer_source_id === 'acme')
    const b = covered.reference.summary.rows.find(r => r.customer_source_id === 'acme')
    for (const field of ['invoice_to_chase_overdue_base_decimal', 'weighted_avg_overdue_days', 'relative_lateness_days', 'historical_normal_days_late', 'actionable_overdue_invoices_count']) assert.equal(b[field], a[field], field)
    assert.deepEqual(covered.benchmarks.ageingRows.map(r => r.customer_source_id), basic.benchmarks.ageingRows.map(r => r.customer_source_id))
    assert.equal(covered.benchmarks.overallWeightedAvgOverdueDays, basic.benchmarks.overallWeightedAvgOverdueDays)
    assert.equal(covered.benchmarks.maxWeightedAvgOverdueDays, basic.benchmarks.maxWeightedAvgOverdueDays)
    assert.deepEqual(covered.benchmarks.relativeLatenessContext, basic.benchmarks.relativeLatenessContext)
    assert.notEqual(covered.benchmarks.totalOverdueOutstandingBaseDecimal, basic.benchmarks.totalOverdueOutstandingBaseDecimal)
  })
}

for (const [name, anchor, component] of [
  ['exposure-maximum-changed', 'maxOverdueOutstandingBase', 'exposureScore'],
  ['urgency-maximum-changed', 'maxWeightedAvgOverdueDays', 'urgencyScore'],
  ['urgency-mean-changed', 'overallWeightedAvgOverdueDays', 'urgencyScore'],
  ['percentile-anchor-changed', 'relativeLateness', 'relativeDeteriorationScore'],
]) {
  test(`other customers depend on changed portfolio anchor: ${name}`, () => {
    const a = calculation(name.startsWith('percentile') ? 'percentile-portfolio' : 'basic'), b = calculation(name)
    assert.notDeepEqual(b.benchmarks.context[anchor], a.benchmarks.context[anchor])
    const unaffected = a.scores.filter(s => {
      const next = b.scores.find(n => n.features.customer_source_id === s.features.customer_source_id)
      return next && JSON.stringify(next.features) === JSON.stringify(s.features)
    })
    assert.ok(unaffected.length)
    assert.ok(unaffected.some(s => baseById(b, s.features.customer_source_id).componentScores[component] !== s.base.componentScores[component]))
    for (const s of unaffected) assert.deepEqual(baseById(b, s.features.customer_source_id).componentScores.paymentRecencyScore, s.base.componentScores.paymentRecencyScore)
  })
}

test('each benchmark can change only its own numerical component; total exposure also supplies explanations', () => {
  const original = baseById(calculation('basic'), 'baker')
  const base = calculateBaseCustomerScore({ ...original.row, weighted_avg_overdue_days: 45 }, original.context)
  for (const [context, component] of [
    [{ ...base.context, maxOverdueOutstandingBase: 2000 }, 'exposureScore'],
    [{ ...base.context, overallWeightedAvgOverdueDays: 20 }, 'urgencyScore'],
    [{ ...base.context, maxWeightedAvgOverdueDays: 120 }, 'urgencyScore'],
    [{ ...base.context, relativeLateness: { ...base.context.relativeLateness, midpointAnchorDays: 30, highAnchorDays: 60 } }, 'relativeDeteriorationScore'],
  ]) {
    const changed = calculateBaseCustomerScore(base.row, context)
    assert.notEqual(changed.componentScores[component], base.componentScores[component])
    for (const key of Object.keys(base.componentScores).filter(k => k !== component)) assert.equal(changed.componentScores[key], base.componentScores[key], key)
  }
  const totalOnly = calculateBaseCustomerScore(base.row, { ...base.context, totalOverdueOutstandingBase: 2000 })
  assert.deepEqual(totalOnly.componentScores, base.componentScores)
  assert.notEqual(totalOnly.explanationInputs.exposureSharePercent, base.explanationInputs.exposureSharePercent)
  const belowMean = calculateBaseCustomerScore(original.row, { ...original.context, maxWeightedAvgOverdueDays: 120 })
  assert.equal(belowMean.componentScores.urgencyScore, original.componentScores.urgencyScore)
})

test('calendar boundaries and evidence unknowns retain their distinctions', () => {
  const before = expectedByName.get('utc-due-boundary-0').summary.rows[0]
  const after = expectedByName.get('utc-due-boundary-1').summary.rows[0]
  assert.equal(before.overdue_invoices_count, 0)
  assert.equal(after.overdue_invoices_count, 1)
  assert.equal(after.weighted_avg_overdue_days, 1)
  assert.equal(expectedByName.get('historical-window-boundary-0').summary.rows[0].historical_paid_invoice_count, 3)
  assert.equal(expectedByName.get('historical-window-boundary-1').summary.rows[0].historical_paid_invoice_count, 2)
  assert.deepEqual(expectedByName.get('organisation-day-boundary-0').queue.body.rows, expectedByName.get('organisation-day-boundary-1').queue.body.rows)
  assert.equal(expectedByName.get('organisation-day-boundary-0').queue.body.followUpSchedule.timezone, 'UTC')
  assert.notDeepEqual(expectedByName.get('mapped-organisation-day-boundary-0').queue.body.rows, expectedByName.get('mapped-organisation-day-boundary-1').queue.body.rows)
  for (const name of ['credit-uncertified', 'credit-incomplete', 'credit-no-certificate']) {
    const row = expectedByName.get(name).summary.rows[0]
    assert.equal(row.customer_credit_state, 'unavailable')
    assert.equal(row.available_customer_credit_base_decimal, null)
  }
  const invalid = expectedByName.get('currency-covered-gross-null').summary.rows[0]
  assert.equal(invalid.gross_outstanding_base_decimal, null)
  assert.equal(invalid.collectible_outstanding_base_decimal, '0')
})

test('pure boundaries reject an invalid evaluation date and contain no hidden I/O or wall clock', async () => {
  const input = await captureFeatureInput(scenarioByName.get('basic'))
  for (const evaluationDate of ['2026-02-30', '2026-10-01T12:00:00Z', 'invalid']) assert.throws(() => calculateCustomerFinancialFeatures({ ...input, evaluationDate }), /evaluation date/i)
  for (const path of ['customer-features', 'portfolio-benchmarks', 'prioritization', 'queue-projection']) {
    const source = readFileSync(`lib/collections/${path}.ts`, 'utf8')
    assert.doesNotMatch(source, /supabase|next\/|react|server-only|fetch\(|Date\.now\(|new Date\(\)/i)
  }
  const RealDate = globalThis.Date
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) throw new Error('Implicit clock read')
      super(...args)
    }
    static now() { throw new Error('Implicit clock read') }
  }
  try {
    const features = calculateCustomerFinancialFeatures(input)
    const benchmarks = calculatePortfolioBenchmarks({ rows: features.rows, overdueOnly: true })
    const baseScores = calculatePortfolioBaseScores(benchmarks, features.organisationBaseCurrency)
    const result = projectCollectionQueue({
      benchmarks, baseScores, organisationBaseCurrency: features.organisationBaseCurrency,
      currencyHealth: features.currencyHealth, sourceCounts: features.sourceCounts,
      reviewRequiredCustomerCount: features.reviewRequiredCustomers.length,
      overrideLevelByCustomerSourceId: new Map(), latestV1ByCustomerSourceId: new Map(),
      latestLegacyActionByCustomerSourceId: new Map(), actionsTakenByCustomerId: {},
      organisationTodayDateIso: '2026-10-01', legacyTodayDateIso: '2026-10-01', limit: 50,
    })
    assert.deepEqual(json(result.rows), expectedByName.get('basic').queue.body.rows)
  } finally { globalThis.Date = RealDate }
})

test('base validity reports nonfinite evidence without silently substituting zero', () => {
  const reference = baseById(calculation('basic'), 'acme')
  const invalid = calculateBaseCustomerScore({ ...reference.row, customer_overdue_to_chase_base: Number.NaN }, reference.context)
  assert.equal(invalid.validity, 'non_finite')
  assert.ok(Number.isNaN(invalid.baseScore))
  assert.ok(Number.isNaN(adjustCustomerPriority(invalid, 'normal').final_score))
})
