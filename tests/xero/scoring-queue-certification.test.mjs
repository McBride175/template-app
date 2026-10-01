import assert from 'node:assert/strict'
import test, { before, after, mock } from 'node:test'
import { createDisputesJourney, journeyInvoice, daysAgo, USER_ID, TENANT_ID } from './test-helpers/disputes-journey-fixture.mjs'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T12:00:00Z') }))
after(() => mock.timers.reset())
const owner = { user_id: USER_ID, tenant_id: TENANT_ID, source_system: 'xero' }
const { isEligibleActiveQueueRow } = loadTypeScriptModule('lib/collections/queue-eligibility.ts')
const invoice = (id, customer, amount, age, extra = {}) => journeyInvoice(id, customer, amount, { due_date: daysAgo(age), ...extra })
function history(customer, lateDays) {
  return lateDays.map((late, i) => invoice(`${customer}-paid-${i}`, customer, '0', 40 + late,
    { status: 'PAID', total_native: '100', amount_paid_native: '100', fully_paid_date: daysAgo(40) }))
}
function appFor(invoices) {
  const observed = []
  const app = createDisputesJourney({ invoices, observeScoring: (row, context, override) => observed.push({ row, context, override }) })
  return { ...app, observed, async queue(query = 'overdueOnly=true') {
    observed.length = 0
    const response = await app.actions(query)
    assert.equal(response.status, 200)
    return response.body
  } }
}
function credit(app, amounts) {
  app.tables.xero_customer_credit_validations = [{ ...owner, sync_run_id: 'generation-1',
    contract_version: 'customer_credit_v1', invoice_money_contract_version: 'invoice_exact_v1',
    readiness_state: 'ready', reason_code: 'stable_observation', consistency_result: 'matched',
    resource_observations: { initial: { overpayments: { count: 0 }, prepayments: { count: 0 }, creditnotes: { count: amounts.length } } } }]
  app.tables.canonical_customer_credit_evidence_exact = amounts.map(([customer, amount]) => ({ ...owner,
    sync_run_id: 'generation-1', source_kind: 'credit_note', source_id: `credit-${customer}`,
    customer_source_id: customer, provider_type: 'ACCRECCREDIT', status: 'AUTHORISED',
    residual_state: 'qualifying', remaining_credit_native: amount, currency_code: 'GBP',
    organisation_base_currency_code: 'GBP', xero_currency_rate: '1' }))
}
function dispute(app, id, amount, extra = {}) {
  app.tables.invoice_disputes.push({ ...owner, id: `dispute-${id}`, invoice_source_id: id,
    dispute_mode: 'partial', is_active: true, recorded_disputed_amount_native: amount,
    amount_due_at_last_review_native: amount, revision: 1, ...extra })
}
function promise(app, id, customer, amount, extra = {}) {
  app.tables.invoice_promises.push({ ...owner, id: `promise-${id}`, invoice_source_id: id,
    customer_source_id: customer, currency_code: 'GBP', promised_amount_native: amount,
    qualifying_paid_amount_native: '0', status: 'active', promised_date: '2026-10-08', ...extra })
}
const find = (queue, id) => queue.rows.find(row => row.customer_source_id === id)
const evidence = (app, id) => app.observed.find(item => item.row.customer_source_id === id)
const scoreFields = ['customer_source_id', 'exposure_score', 'urgency_score', 'relative_lateness_score',
  'payment_recency_score', 'base_score', 'final_score', 'priority_score']
const scores = queue => queue.rows.map(row => scoreFields.map(key => row[key]))
function assertBinary(actual, expected) {
  assert.ok(Number.isFinite(actual))
  assert.ok(Math.abs(actual - expected) <= Number.EPSILON * Math.max(1, Math.abs(expected)) * 8,
    `${actual} differs from ${expected}`)
}

test('real queue constructs singleton, two-customer, tied and skewed benchmarks including self', async t => {
  for (const [name, fixtures, expected] of [
    ['singleton', [[100, 30]], [100, 100, 30, 30]],
    ['two different customers', [[100, 10], [300, 30]], [400, 300, 25, 30]],
    ['identical customers', [[100, 20], [100, 20], [100, 20]], [300, 100, 20, 20]],
    ['skewed portfolio', [[1000, 10], [1, 100]], [1001, 1000, 10100 / 1001, 100]],
  ]) await t.test(name, async () => {
    const app = appFor(fixtures.map(([money, age], i) => invoice(`i${i}`, `c${i}`, String(money), age)))
    const queue = await app.queue()
    assert.equal(app.observed.length, fixtures.length)
    for (const { context } of app.observed) {
      const actual = [context.totalOverdueOutstandingBase, context.maxOverdueOutstandingBase,
        context.overallWeightedAvgOverdueDays, context.maxWeightedAvgOverdueDays]
      actual.forEach((value, i) => assertBinary(value, expected[i]))
    }
    if (name === 'singleton') assert.deepEqual([find(queue, 'c0').exposure_score, find(queue, 'c0').urgency_score], [100, 100])
    if (name === 'two different customers') {
      assertBinary(find(queue, 'c0').exposure_score, 33.333333333333336)
      assert.equal(find(queue, 'c0').urgency_score, 20)
      assert.deepEqual([find(queue, 'c1').exposure_score, find(queue, 'c1').urgency_score], [100, 100])
    }
  })
})

test('unequal invoice balances weight age before the separate invoice-count bonus', async () => {
  const app = appFor([invoice('young', 'acme', '900', 10), invoice('old', 'acme', '100', 100),
    invoice('b1', 'baker', '100', 40), invoice('b2', 'baker', '100', 40)])
  const queue = await app.queue()
  // Acme: (900*10 + 100*100)/1000 = 19, not the unweighted age 55.
  // Portfolio: (1000*19 + 200*40)/1200 = 22.5, maximum customer age 40.
  // Acme urgency: 19/22.5*50 + 5 = 425/9; Baker: min(100,100+5).
  assert.equal(evidence(app, 'acme').row.weighted_avg_overdue_days, 19)
  assert.equal(evidence(app, 'baker').row.weighted_avg_overdue_days, 40)
  assert.equal(evidence(app, 'acme').context.overallWeightedAvgOverdueDays, 22.5)
  assert.equal(evidence(app, 'acme').context.maxWeightedAvgOverdueDays, 40)
  assertBinary(find(queue, 'acme').urgency_score, 425 / 9)
  assert.equal(find(queue, 'baker').urgency_score, 100)
  assert.equal(find(queue, 'acme').base_score, 71.8)
  assert.equal(find(queue, 'baker').base_score, 45)
})

test('invoice suppression and partial payments set weighted age; customer credit changes only monetary scoring inputs', async () => {
  const app = appFor([invoice('old', 'acme', '900', 100, { total_native: '1000', amount_paid_native: '100' }),
    invoice('young', 'acme', '100', 10), invoice('full-dispute', 'acme', '300', 200),
    invoice('full-promise', 'acme', '400', 300), invoice('other', 'baker', '200', 25), ...history('acme', [0, 10, 50])])
  dispute(app, 'old', '600'); promise(app, 'old', 'acme', '200')
  dispute(app, 'full-dispute', '300'); promise(app, 'full-promise', 'acme', '400')
  const before = await app.queue()
  assert.equal(evidence(app, 'acme').row.weighted_avg_overdue_days, 55) // (100*100 + 100*10)/200
  assert.equal(evidence(app, 'acme').row.overdue_invoices_count, 2)
  assert.equal(evidence(app, 'acme').row.relative_lateness_days, 45) // 55 - median(0,10,50)
  credit(app, [['acme', '100']])
  const after = await app.queue()
  const a = evidence(app, 'acme'), b = evidence(app, 'baker')
  assert.deepEqual([a.row.customer_overdue_to_chase_base, a.row.invoice_overdue_to_chase_base,
    a.row.weighted_avg_overdue_days, a.row.overdue_invoices_count], [100, 200, 55, 2])
  assert.deepEqual([a.context.totalOverdueOutstandingBase, a.context.maxOverdueOutstandingBase,
    a.context.overallWeightedAvgOverdueDays, a.context.maxWeightedAvgOverdueDays], [300, 200, 40, 55])
  assert.deepEqual(b.context, a.context)
  assert.deepEqual([find(after, 'acme').exposure_score, find(after, 'acme').urgency_score,
    find(after, 'acme').relative_lateness_score, find(after, 'acme').payment_recency_score,
    find(after, 'acme').base_score], [50, 100, 100, 100, 75])
  assert.equal(find(after, 'baker').urgency_score, 31.25)
  assert.equal(find(after, 'baker').base_score, 67.8)
  for (const field of ['urgency_score', 'relative_lateness_score', 'payment_recency_score']) {
    assert.equal(find(after, 'acme')[field], find(before, 'acme')[field])
  }
})

test('credit-zero, deferred and founder-suppressed customers retain the approved ageing/reference populations', async () => {
  const app = appFor([...[25, 30, 35, 40, 45].flatMap((age, i) =>
    [invoice(`i${i}`, `c${i}`, '100', age), ...history(`c${i}`, [0, 0, 0])]),
  invoice('disputed', 'disputed', '1000', 500), invoice('promised', 'promised', '1000', 600),
  invoice('paid', 'paid', '0', 700, { status: 'PAID' })])
  dispute(app, 'disputed', '1000'); promise(app, 'promised', 'promised', '1000')
  app.override('c3', 'do_not_chase')
  app.tables.collection_actions.push({ ...owner, id: 'deferred', customer_source_id: 'c2',
    action_type: 'outcome', outcome: 'message_sent', action_timestamp: '2026-10-01T10:00:00Z', next_action_date: '2026-10-02' })
  credit(app, [['c4', '100']])
  const queue = await app.queue()
  const benchmark = evidence(app, 'c0').context
  assert.deepEqual([benchmark.totalOverdueOutstandingBase, benchmark.maxOverdueOutstandingBase,
    benchmark.overallWeightedAvgOverdueDays, benchmark.maxWeightedAvgOverdueDays], [400, 100, 35, 45])
  assert.deepEqual(benchmark.relativeLateness, { mode: 'portfolio-relative', materialObservationCount: 5,
    midpointAnchorDays: 35, highAnchorDays: 48.5, materialP50Days: 35, materialP90Days: 43 })
  assert.deepEqual(app.observed.map(item => item.row.customer_source_id).sort(), ['c0', 'c1', 'c2', 'c3'])
  assert.equal(find(queue, 'c0').base_score, 74.1)
  assert.equal(find(queue, 'c1').base_score, 77)
  assert.equal(find(queue, 'c3').base_score, 89)
  assert.equal(find(queue, 'c3').final_score, 0)
  assert.deepEqual(app.firstValue(queue).map(row => row.customer_source_id), ['c1', 'c0'])
  const beforeInputs = structuredClone(app.observed)
  credit(app, [['c4', '1000000']])
  const excess = await app.queue()
  assert.deepEqual(app.observed, beforeInputs)
  assert.deepEqual(scores(excess), scores(queue))
  assert.deepEqual(excess.portfolio, queue.portfolio)
  // Two historical observations do not join the deterioration reference, but
  // the customer's current debt/age and missing recency remain ordinary inputs.
  app.tables.canonical_invoices.push(invoice('sparse', 'sparse', '100', 10), ...history('sparse', [0, 0]))
  const withSparse = await app.queue()
  const sparse = evidence(app, 'sparse')
  assert.equal(sparse.context.totalOverdueOutstandingBase, 500)
  assertBinary(sparse.context.overallWeightedAvgOverdueDays, 185 / 6)
  assert.deepEqual(sparse.context.relativeLateness, benchmark.relativeLateness)
  assert.equal(sparse.row.relative_lateness_days, null)
  assert.equal(find(withSparse, 'sparse').relative_lateness_score, 0)
  assert.equal(find(withSparse, 'sparse').payment_recency_score, 100)
})

test('latest canonical payment uses held customer/tenant/provider scope, never operational events', async () => {
  const app = appFor([invoice('a', 'acme', '100', 30), invoice('b', 'baker', '100', 30)])
  const payment = (id, date, extra = {}) => ({ ...owner, sync_run_id: 'generation-1', source_id: id,
    invoice_source_id: 'a', customer_source_id: 'acme', payment_date: date, ...extra })
  app.tables.canonical_payments.push(payment('old', daysAgo(31)), payment('middle', daysAgo(14)),
    payment('latest', daysAgo(7), { customer_source_id: null }),
    payment('other-customer', daysAgo(0), { invoice_source_id: 'b', customer_source_id: 'baker' }),
    ...[{ user_id: 'other' }, { tenant_id: 'other' }, { source_system: 'other' }, { sync_run_id: 'old' }]
      .map((extra, i) => payment(`foreign-${i}`, daysAgo(0), extra)))
  app.tables.invoice_promise_events = [{ invoice_source_id: 'a', created_at: '2026-10-01T10:00:00Z' }]
  promise(app, 'a', 'acme', '100', { status: 'missed', resolved_at: '2026-10-01T10:00:00Z' })
  dispute(app, 'a', '100', { is_active: false, resolved_at: '2026-10-01T10:00:00Z' })
  app.tables.collection_actions.push({ ...owner, id: 'history', customer_source_id: 'acme', action_type: 'outcome',
    outcome: 'reviewed_no_chase', action_timestamp: '2026-10-01T10:00:00Z', next_action_date: '2026-10-01' })
  credit(app, [['acme', '10']])
  const queue = await app.queue()
  assert.equal(evidence(app, 'acme').row.last_payment_date, '2026-09-24')
  assert.equal(evidence(app, 'acme').row.last_payment_days_ago, 7)
  assert.equal(find(queue, 'acme').payment_recency_score, 10)
  assert.equal(find(queue, 'baker').payment_recency_score, 0)
  assert.equal(app.calls.includes('invoice_promise_events'), false)
})

test('history-only changes preserve scorer inputs, benchmarks, components and final score', async () => {
  const app = appFor([invoice('a', 'acme', '100', 30), invoice('b', 'baker', '200', 20), ...history('acme', [0, 10, 20])])
  const before = await app.queue(), inputs = structuredClone(app.observed)
  // A newly retained inactive dispute has no effective suppression; timestamps
  // and notes are history facts, not a new signal.
  dispute(app, 'a', '100', { is_active: false, note: 'Resolved history', resolved_at: '2026-09-30T10:00:00Z' })
  promise(app, 'a', 'acme', '100', { status: 'cancelled' })
  app.tables.invoice_promise_events = [{ event_type: 'cancelled', promise_id: 'promise-a' }]
  app.tables.collection_actions.push({ ...owner, id: 'event', customer_source_id: 'acme', action_type: 'outcome',
    outcome: 'responded_no_commitment', action_timestamp: '2026-09-30T10:00:00Z', next_action_date: '2026-10-01' })
  const after = await app.queue()
  assert.deepEqual(app.observed, inputs)
  assert.deepEqual(scores(after), scores(before))
  assert.deepEqual(after.portfolio, before.portfolio)
  app.tables.invoice_disputes[0].note = 'Edited narrative'
  app.tables.invoice_promises[0].note = 'Edited retained commitment note'
  assert.deepEqual(scores(await app.queue()), scores(before))
})

test('production queue ranking uses adjusted rounded score, exact money, names, then stable input order', async () => {
  const cases = [['safe', '1000'], ['priority', '500'], ['normal', '800'], ['close-high', '602'],
    ['close-low', '600'], ['alpha', '500'], ['beta', '500'], ['exact', '500.000000000000000001'],
    ['same-a', '300'], ['same-b', '300'], ['sparse', '100'], ['never', '900'], ['zero', '0']]
  const app = appFor([...cases.map(([id, amount]) => invoice(id, id, amount, 30)), ...history('sparse', [0, 0])])
  for (const c of app.tables.canonical_customers) {
    if (['same-a', 'same-b'].includes(c.source_id)) c.name = 'Same name'
    if (c.source_id === 'exact') c.name = 'Zeta'
  }
  app.override('safe', 'safe'); app.override('priority', 'priority'); app.override('never', 'do_not_chase')
  const queue = await app.queue()
  const expected = [['priority', 60, 96], ['normal', 75, 75], ['close-high', 65.1, 65.1],
    ['close-low', 65, 65], ['exact', 60, 60], ['alpha', 60, 60], ['beta', 60, 60],
    ['same-a', 50, 50], ['same-b', 50, 50], ['sparse', 40, 40], ['safe', 85, 34], ['never', 80, 0]]
  assert.deepEqual(queue.rows.map(row => [row.customer_source_id, row.base_score, row.final_score]), expected)
  const active = queue.rows.filter(row => isEligibleActiveQueueRow(row, queue.actionsTakenByCustomerId))
  assert.deepEqual(active.map(row => row.customer_source_id), expected.slice(0, -1).map(row => row[0]))
  assert.equal(find(queue, 'never').queue_eligibility_reason, 'do_not_chase')
  assert.equal(find(queue, 'zero'), undefined)
  assert.equal(find(queue, 'sparse').relative_lateness_score, 0)
  app.tables.canonical_invoices.reverse(); app.tables.canonical_customers.reverse()
  assert.deepEqual(scores(await app.queue()), scores(queue))
})

test('tiny positive amounts remain finite and zero portfolios never divide by zero', async () => {
  for (const amount of ['0', '0.000000000000000001', '1e-100']) {
    const app = appFor([invoice('a', 'acme', amount, 30)])
    const queue = await app.queue()
    if (amount === '0') {
      assert.equal(queue.rows.length, 0); assert.equal(queue.portfolio.totalOverdueBase, 0)
    } else {
      assert.equal(find(queue, 'acme').has_actionable_overdue_balance, true)
      assert.deepEqual([find(queue, 'acme').exposure_score, find(queue, 'acme').urgency_score, find(queue, 'acme').base_score], [100, 100, 85])
      for (const field of scoreFields.slice(1)) assert.ok(Number.isFinite(find(queue, 'acme')[field]))
    }
  }
})

test('supported large values retain age while out-of-range/nonfinite money never reaches scoring', async () => {
  const huge = '1' + '0'.repeat(95)
  const app = appFor([invoice('a', 'acme', huge, 100), invoice('b', 'baker', huge, 100)])
  const queue = await app.queue()
  assert.equal(evidence(app, 'acme').context.overallWeightedAvgOverdueDays, 100)
  assert.equal(queue.portfolio.weightedAverageOverdueDays, 100)
  assert.equal(find(queue, 'acme').base_score, 85)
  // Production decimal parsing permits at most 100 digits/exponent magnitude.
  for (const amount of ['1e306', 'NaN', 'Infinity']) {
    const invalid = appFor([invoice('a', 'acme', amount, 100)])
    assert.equal((await invalid.queue()).rows.length, 0)
    assert.equal(invalid.observed.length, 0)
  }
})

test('weighted-age intermediate exceeding exact arithmetic range fails closed, never becomes zero age', async () => {
  // 1e99 is a valid 100-digit balance; multiplying by 100 days produces a
  // 102-digit intermediate. A failed exact sum must not be substituted with 0.
  const app = appFor([invoice('a', 'acme', '1' + '0'.repeat(99), 100)])
  const response = await app.actions('overdueOnly=true')
  assert.equal(response.status, 500)
  assert.equal(app.observed.length, 0)
})
