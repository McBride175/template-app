import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createDisputesJourney, journeyInvoice, daysAgo, USER_ID, TENANT_ID,
  createNoDisputeParityJourney, noDisputeParityProjection } from './test-helpers/disputes-journey-fixture.mjs'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
const { PRIORITIZATION_CONFIG, OVERRIDE_MULTIPLIERS, prioritiseCustomer } = loadTypeScriptModule('lib/collections/prioritization.ts')
const { buildRelativeLatenessContext } = loadTypeScriptModule('lib/collections/relative-lateness.ts')
const snapshotModule = loadTypeScriptModule('lib/xero/authoritative-snapshot.ts')
const { resolveXeroAuthoritativeSnapshot } = snapshotModule
const { loadActiveInvoicePromises } = loadTypeScriptModule('lib/collections/invoice-promises-loading.ts', { mocks: { '@/lib/xero/authoritative-snapshot': snapshotModule } })

function promise(app, invoiceId = 'a', amount = '4000', paid = '0', status = 'active') {
  const invoice = app.tables.canonical_invoices.find(row => row.source_id === invoiceId)
  const row = { id: `promise-${invoiceId}`, user_id: USER_ID, tenant_id: TENANT_ID, source_system: 'xero',
    invoice_source_id: invoiceId, customer_source_id: invoice.customer_source_id,
    currency_code: invoice.transaction_currency_code, status, promised_amount_native: amount,
    qualifying_paid_amount_native: paid, promised_date: daysAgo(-7), revision: '3',
    payment_baseline: { secret: 'not-for-DTOs' }, evidence: { secret: 'not-for-DTOs' } }
  app.tables.invoice_promises.push(row)
  return row
}
async function views(app, customer = 'acme') {
  const [customers, actions, invoices] = await Promise.all([app.customers(), app.actions(), app.invoices(customer)])
  for (const response of [customers, actions, invoices]) assert.equal(response.status, 200, JSON.stringify(response.body))
  return { customer: customers.body.rows.find(row => row.customer_source_id === customer),
    queue: actions.body, rank: actions.body.rows.find(row => row.customer_source_id === customer),
    invoices: invoices.body.invoices }
}

for (const [name, outstanding, amount, paid, coverage, toChase] of [
  ['fixed partial', 10000, '2000', '0', '2000', '8000'],
  ['full current balance', 10000, '10000', '0', '10000', '0'],
  ['fixed commitment does not grow', 12000, '4000', '0', '4000', '8000'],
  ['payment is not subtracted twice', 9000, '4000', '1000', '3000', '6000'],
  ['current balance caps coverage', 2000, '4000', '0', '2000', '0'],
  ['exact decimal coverage', '0.33', '0.3', '0.1', '0.2', '0.13'],
]) test(`${name}: summary, invoice, queue and first-value agree`, async () => {
  const app = createDisputesJourney({ invoices: [journeyInvoice('a', 'acme', outstanding)] })
  promise(app, 'a', amount, paid)
  const result = await views(app)
  assert.equal(result.customer.active_promised_outstanding_base_decimal, coverage)
  assert.equal(result.customer.to_chase_outstanding_base_decimal, toChase)
  assert.equal(result.customer.effective_disputed_outstanding_base_decimal, '0')
  assert.equal(result.customer.total_outstanding_base, Number(outstanding))
  assert.equal(result.invoices[0].toChaseAmountNative, toChase)
  assert.equal(result.invoices[0].activePromise.promisedAmountNative, amount)
  assert.equal(result.invoices[0].activePromisedCoverageAmountNative, coverage)
  assert.equal(result.invoices[0].collectibleAmountNative, toChase)
  assert.equal(JSON.stringify(result).includes('not-for-DTOs'), false)
  if (toChase === '0') {
    assert.equal(result.rank, undefined)
    assert.equal(result.queue.portfolio.totalOverdueBase, 0)
    assert.equal(result.customer.actionable_overdue_invoices_count, 0)
    assert.deepEqual(app.firstValue(result.queue), [])
    assert.equal((await app.actions('overdueOnly=false')).body.rows.length, 0)
  } else {
    assert.equal(result.rank.to_chase_overdue_base_decimal, toChase)
    assert.equal(result.rank.collectible_overdue_base, Number(toChase))
    assert.equal(result.queue.portfolio.totalOverdueBase, Number(toChase))
    const [first] = app.firstValue(result.queue)
    assert.equal(first.collectible_overdue_base, Number(toChase))
    assert.equal(first.actionable_overdue_invoices_count, 1)
  }
})

for (const status of ['kept', 'missed', 'unclear', 'cancelled']) test(`terminal ${status} restores ordinary chase debt`, async () => {
  const app = createDisputesJourney()
  promise(app, 'a', '10000', '1000', status)
  const result = await views(app)
  assert.equal(result.customer.active_promised_outstanding_base_decimal, '0')
  assert.equal(result.customer.to_chase_outstanding_base_decimal, '10000')
  assert.equal(result.invoices[0].activePromise, null)
  assert.equal(result.rank.collectible_overdue_base, 10000)
})

test('dispute precedence, removal and worklist agree without changing dispute history', async () => {
  const app = createDisputesJourney()
  await app.mutate({ operation: 'partial', invoiceSourceId: 'a', disputedAmountNative: '8000' })
  const stored = promise(app)
  let result = await views(app)
  assert.equal(result.customer.effective_disputed_outstanding_base_decimal, '8000')
  assert.equal(result.customer.active_promised_outstanding_base_decimal, '2000')
  assert.equal(result.customer.to_chase_outstanding_base_decimal, '0')
  assert.equal(result.customer.collectible_native_currency_breakdown[0].active_promised_outstanding_native, '2000')
  assert.equal(result.rank, undefined)
  const worklist = await app.worklist()
  assert.equal(worklist.body.rows[0].collectibleAmountNative, '0')
  assert.equal(worklist.body.rows[0].collectibleBase, '0')
  assert.equal(stored.promised_amount_native, '4000')
  await app.mutate({ operation: 'resolve', disputeId: app.tables.invoice_disputes[0].id, expected_revision: '1' })
  result = await views(app)
  assert.equal(result.customer.active_promised_outstanding_base_decimal, '4000')
  assert.equal(result.customer.to_chase_outstanding_base_decimal, '6000')
  assert.equal(result.customer.effective_disputed_outstanding_base_decimal, '0')
})

test('no Active Promises exactly preserve the existing golden scoring/currency/first-value contract', async () => {
  const expected = JSON.parse(await readFile(new URL('./fixtures/disputes-no-dispute-baseline.json', import.meta.url))).expected
  const app = createNoDisputeParityJourney()
  assert.deepEqual(await noDisputeParityProjection(app), expected)
  promise(app, 'a-young', '100', '0', 'missed')
  assert.deepEqual(await noDisputeParityProjection(app), expected)
})

test('portfolio, weighted age, current deterioration and scorer inputs share the To-chase population', async () => {
  const app = createNoDisputeParityJourney()
  const before = await views(app)
  const oldOther = before.queue.rows.find(row => row.customer_source_id === 'baker')
  promise(app, 'a-old', '10000')
  const after = await views(app)
  assert.equal(after.customer.actionable_overdue_invoices_count, 1)
  assert.equal(after.customer.weighted_avg_overdue_days, 10)
  assert.equal(after.customer.historical_normal_days_late, before.customer.historical_normal_days_late)
  assert.equal(after.customer.relative_lateness_days, 10 - after.customer.historical_normal_days_late)
  assert.equal(after.rank.payment_recency_score, before.rank.payment_recency_score)
  assert.equal(after.customer.last_payment_days_ago, before.customer.last_payment_days_ago)
  const rankingRows = (await app.customers()).body.rows.filter(row => row.to_chase_outstanding_base > 0)
  const overdue = rankingRows.filter(row => row.to_chase_overdue_base > 0)
  const total = overdue.reduce((sum, row) => sum + row.to_chase_overdue_base, 0)
  const maximum = Math.max(...overdue.map(row => row.to_chase_overdue_base))
  const weightedAge = overdue.reduce((sum, row) => sum + row.to_chase_overdue_base * row.weighted_avg_overdue_days, 0) / total
  assert.equal(after.queue.portfolio.totalOverdueBase, total)
  assert.equal(after.queue.portfolio.largestCustomerOverdueBase, maximum)
  assert.equal(after.queue.portfolio.weightedAverageOverdueDays, weightedAge)
  const expected = prioritiseCustomer({ ...after.customer,
    customer_overdue_to_chase_base: after.customer.to_chase_overdue_base,
    has_actionable_overdue_balance: after.customer.to_chase_overdue_base > 0,
    invoice_overdue_to_chase_base: after.customer.to_chase_overdue_base,
    total_outstanding_base: after.customer.to_chase_outstanding_base,
    overdue_invoices_count: after.customer.actionable_overdue_invoices_count,
    open_invoices_count: after.customer.actionable_open_invoices_count,
  }, { totalOverdueOutstandingBase: total, maxOverdueOutstandingBase: maximum,
    overallWeightedAvgOverdueDays: weightedAge, maxWeightedAvgOverdueDays: Math.max(...overdue.map(row => row.weighted_avg_overdue_days)),
    relativeLateness: buildRelativeLatenessContext(overdue.map(row => ({ overdueOutstandingBase: row.to_chase_overdue_base, relativeLatenessDays: row.relative_lateness_days }))),
  }, after.customer.override_level)
  for (const field of ['priority_score','base_score','exposure_score','urgency_score','relative_lateness_score','payment_recency_score','override_multiplier']) {
    assert.equal(after.rank[field], expected[field], field)
  }
  const newOther = after.queue.rows.find(row => row.customer_source_id === 'baker')
  assert.notEqual(oldOther.exposure_share_percent, newOther.exposure_share_percent)
  assert.notEqual(oldOther.priority_score, newOther.priority_score)
  assert.deepEqual(PRIORITIZATION_CONFIG.weights, { exposure: .5, urgency: .25, relativeDeterioration: .15, behaviour: .1 })
  assert.deepEqual(OVERRIDE_MULTIPLIERS, { safe: .4, normal: 1, priority: 1.6, do_not_chase: 0 })
})

test('equal scores use To-chase overdue money, then the existing customer-name tie', async () => {
  const app = createDisputesJourney()
  for (const id of ['acme', 'baker', 'cedar']) app.override(id, 'do_not_chase')
  promise(app, 'a', '4000')
  assert.deepEqual((await app.actions()).body.rows.map(row => row.customer_source_id), ['baker', 'acme', 'cedar'])
  promise(app, 'b', '2000')
  assert.deepEqual((await app.actions()).body.rows.map(row => row.customer_source_id), ['acme', 'baker', 'cedar'])
})

test('legacy promise contact history never suppresses; explicit postponement still does', async () => {
  const app = createDisputesJourney()
  const base = { user_id: USER_ID, tenant_id: TENANT_ID, source_system: 'xero',
    action_timestamp: daysAgo(2) + 'T10:00:00Z', next_action_date: daysAgo(-7) }
  app.tables.collection_actions.push({ ...base, id: 'legacy', customer_source_id: 'acme', action_type: 'called', outcome: 'promised_to_pay' },
    { ...base, id: 'snooze', customer_source_id: 'baker', action_type: 'postponed', outcome: 'promised_to_pay' })
  let queue = (await app.actions()).body
  assert.ok(queue.rows.some(row => row.customer_source_id === 'acme'))
  assert.equal(queue.suppression, undefined)
  assert.equal(queue.queue.suppression.promisedToPayCustomerCount, 0)
  assert.equal(queue.queue.suppression.postponedCustomerCount, 1)
  promise(app, 'a', '2000')
  queue = (await app.actions()).body
  assert.equal(queue.rows.find(row => row.customer_source_id === 'acme').collectible_overdue_base, 8000)
  assert.equal(queue.rows.find(row => row.customer_source_id === 'acme').last_action_outcome, 'promised_to_pay')
  assert.equal(app.tables.collection_actions.length, 2)
})

for (const [name, amount, paid, disputed, fx, expected, review] of [
  ['valid foreign', '4000', '0', null, '5', '3200', false],
  ['foreign overlap', '4000', '1000', '18000', '5', '0', false],
  ['full coverage with unavailable FX', '20000', '0', null, null, '0', false],
  ['partial coverage with unavailable FX', '4000', '0', null, null, null, true],
]) test(`${name}: native actionability controls ranking health, gross controls entitlement`, async () => {
  const app = createDisputesJourney({ invoices: [journeyInvoice('a', 'acme', 20000, {
    transaction_currency_code: 'USD', xero_currency_rate: fx, amount_due_base: fx ? '4000' : null,
    currency_conversion_status: fx ? 'converted' : 'incomplete', currency_conversion_failure_reason: fx ? null : 'missing_rate',
  }), journeyInvoice('b', 'baker', 1000)] })
  if (disputed) await app.mutate({ operation: 'partial', invoiceSourceId: 'a', disputedAmountNative: disputed })
  const stored = promise(app, 'a', amount, paid)
  const queue = (await app.actions()).body
  assert.equal(queue.reviewRequiredCustomers.some(row => row.customer_source_id === 'acme'), review)
  const customers = (await app.customers()).body
  const row = customers.rows.find(row => row.customer_source_id === 'acme')
  if (!review) assert.equal(row.to_chase_outstanding_base_decimal, expected)
  if (fx && row) assert.equal(Number(row.gross_outstanding_base_decimal), Number(row.effective_disputed_outstanding_base_decimal) + Number(row.active_promised_outstanding_base_decimal) + row.to_chase_outstanding_base)
  app.setPlan('basic')
  assert.equal((await app.actions()).body.currencyAccess.allowed, false)
  app.setPlan('pro')
  stored.status = 'missed'
  if (!fx) assert.ok((await app.actions()).body.reviewRequiredCustomers.some(row => row.customer_source_id === 'acme'))
})

test('scoped Promise loading is one batch for many invoices; no history/evidence in SELECT', async () => {
  const app = createDisputesJourney({ invoices: Array.from({ length: 50 }, (_, i) => journeyInvoice(`i${i}`, `c${i}`, 100)) })
  for (let i = 0; i < 50; i++) promise(app, `i${i}`, '10')
  const selections = [], original = app.admin.from
  app.admin.from = table => { const query = original(table); const select = query.select
    query.select = value => { if (table === 'invoice_promises') selections.push(value); return select.call(query, value) }; return query }
  const queue = await app.actions()
  assert.equal(queue.status, 200)
  assert.equal(app.calls.filter(table => table === 'invoice_promises').length, 1)
  assert.equal(selections.length, 1)
  assert.match(selections[0], /promised_amount_native::text/)
  assert.match(selections[0], /qualifying_paid_amount_native::text/)
  assert.doesNotMatch(selections[0], /baseline|evidence|note|promised_date|revision/)
  assert.equal(app.calls.some(table => table === 'invoice_promise_events'), false)
})

test('loader paginates Active state and ignores foreign owner/tenant/provider and terminals', async () => {
  const app = createDisputesJourney()
  const p = promise(app)
  app.tables.invoice_promises = Array.from({ length: 1001 }, (_, i) => ({ ...p, id: String(i).padStart(5, '0'), invoice_source_id: `i${i}` }))
  app.tables.invoice_promises.push({ ...p, user_id: 'other' }, { ...p, tenant_id: 'other' }, { ...p, source_system: 'other' }, { ...p, status: 'missed' })
  const snapshot = await resolveXeroAuthoritativeSnapshot({ supabaseAdmin: app.admin, userId: USER_ID, tenantId: TENANT_ID })
  const rows = await loadActiveInvoicePromises({ admin: app.admin, userId: USER_ID, tenantId: TENANT_ID, snapshot })
  assert.equal(rows.size, 1001)
  assert.equal(app.calls.filter(table => table === 'invoice_promises').length, 2)
})

for (const [name, corrupt] of [
  ['duplicate active identity', app => app.tables.invoice_promises.push({ ...app.tables.invoice_promises[0], id: 'other' })],
  ['currency mismatch', app => app.tables.invoice_promises[0].currency_code = 'USD'],
  ['customer identity mismatch', app => app.tables.invoice_promises[0].customer_source_id = 'other'],
  ['missing authoritative invoice', app => app.tables.canonical_invoices = app.tables.canonical_invoices.filter(row => row.source_id !== 'a')],
  ['non-exact money transport', app => app.tables.invoice_promises[0].promised_amount_native = 4000],
]) test(`${name} fails closed rather than erasing or misvaluing debt`, async () => {
  const app = createDisputesJourney(); promise(app); corrupt(app)
  assert.equal((await app.actions()).status, 500)
})

test('snapshot promotion during Promise loading rejects mixed accounting/evaluation generations', async () => {
  const app = createDisputesJourney(); promise(app)
  const original = app.admin.from
  app.admin.from = table => { if (table === 'invoice_promises') app.promote({ a: { amount_due_native: '9000', amount_due_base: '9000' } }); return original(table) }
  assert.equal((await app.actions()).status, 500)
})

test('an elapsed Promise date does not independently expire operationally Active coverage', async () => {
  const app = createDisputesJourney()
  const stored = promise(app)
  stored.promised_date = daysAgo(30)
  assert.equal((await views(app)).customer.to_chase_outstanding_base_decimal, '6000')
  stored.status = 'missed'
  assert.equal((await views(app)).customer.to_chase_outstanding_base_decimal, '10000')
})

test('cash evidence cannot enter actionability or recommendation reads', async () => {
  const app = createDisputesJourney(); promise(app)
  app.tables.canonical_unapplied_cash = [{ customer_source_id: 'acme', remaining_credit_native: '999999' }]
  const result = await views(app)
  assert.equal(result.customer.to_chase_outstanding_base_decimal, '6000')
  assert.equal(app.calls.includes('canonical_unapplied_cash'), false)
  assert.equal(app.calls.includes('canonical_payment_evidence'), false)
})

test('long exact commitment decimals reach canonical coverage without number normalization', async () => {
  const app = createDisputesJourney({ invoices: [journeyInvoice('a', 'acme', '0.330000000000000001')] })
  promise(app, 'a', '0.300000000000000001', '0.1')
  const result = await views(app)
  assert.equal(result.customer.collectible_native_currency_breakdown[0].active_promised_outstanding_native, '0.200000000000000001')
  assert.equal(result.customer.to_chase_outstanding_base_decimal, '0.13')
  assert.equal(result.invoices[0].activePromise.promisedAmountNative, '0.300000000000000001')
})

test('credit balance reduction never becomes payment and baseline/evidence loader errors never become empty Promises', async () => {
  const app = createDisputesJourney({ invoices: [journeyInvoice('a', 'acme', 0, { amount_credited_native: '10000' })] })
  const stored = promise(app)
  const result = await views(app)
  assert.equal(result.customer.to_chase_outstanding_base_decimal, '0')
  assert.equal(stored.qualifying_paid_amount_native, '0')
  assert.equal(stored.status, 'active')
  const original = app.admin.from
  app.admin.from = table => {
    const query = original(table)
    if (table === 'invoice_promises') query.range = async () => ({ data: null, error: new Error('Promise storage unavailable') })
    return query
  }
  assert.equal((await app.actions()).status, 500)
})
