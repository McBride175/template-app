import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
import { createDisputesJourney, daysAgo, journeyInvoice, USER_ID, TENANT_ID } from './test-helpers/disputes-journey-fixture.mjs'

const snapshotModule = loadTypeScriptModule('lib/xero/authoritative-snapshot.ts')
const { loadCustomerCollectionsSummaryWithMetadata } = loadTypeScriptModule('lib/collections/customer-summary.ts', {
  mocks: { '@/lib/supabase-server': {}, '@/lib/xero/authoritative-snapshot': snapshotModule,
    '@/lib/collections/invoice-promises-loading': loadTypeScriptModule('lib/collections/invoice-promises-loading.ts', {
      mocks: { '@/lib/xero/authoritative-snapshot': snapshotModule },
    }) },
})
const providerType = { overpayment: 'RECEIVE-OVERPAYMENT', prepayment: 'RECEIVE-PREPAYMENT', credit_note: 'ACCRECCREDIT' }
function credit(kind, amount, overrides = {}) {
  return { sync_run_id:'generation-1', user_id:USER_ID, tenant_id:TENANT_ID, source_system:'xero',
    source_kind:kind, source_id:`${kind}-1`, customer_source_id:'acme', provider_type:providerType[kind],
    status:'AUTHORISED', residual_state:amount === '0' ? 'zero' : 'qualifying', remaining_credit_native:amount,
    currency_code:'GBP', organisation_base_currency_code:'GBP', xero_currency_rate:'1', ...overrides }
}
function certify(app, rows, overrides = {}) {
  const count = kind => rows.filter(row => row.source_kind === kind).length
  app.tables.xero_customer_credit_validations = [{ sync_run_id:'generation-1', user_id:USER_ID, tenant_id:TENANT_ID,
    source_system:'xero', contract_version:'customer_credit_v1', invoice_money_contract_version:'invoice_exact_v1',
    readiness_state:'ready', reason_code:'stable_observation', consistency_result:'matched',
    resource_observations:{ initial:{overpayments:{count:count('overpayment')},
      prepayments:{count:count('prepayment')}, creditnotes:{count:count('credit_note')}} }, ...overrides }]
  app.tables.canonical_customer_credit_evidence_exact = rows
}
async function summary(app, customerSourceId) {
  if (!customerSourceId) return loadCustomerCollectionsSummaryWithMetadata(app.admin, USER_ID, TENANT_ID)
  const snapshot = await snapshotModule.resolveXeroAuthoritativeSnapshot({ supabaseAdmin:app.admin, userId:USER_ID, tenantId:TENANT_ID })
  return loadCustomerCollectionsSummaryWithMetadata(app.admin, USER_ID, TENANT_ID, { customerSourceId, snapshot })
}
const customer = result => result.rows.find(row => row.customer_source_id === 'acme')

for (const kind of ['overpayment','prepayment','credit_note']) {
  test(`${kind} exact residual appears only in the new customer overdue contract`, async () => {
    const app = createDisputesJourney({ invoices:[journeyInvoice('a','acme',1000)] })
    certify(app, [credit(kind,'300')])
    const row = customer(await summary(app))
    assert.deepEqual([row.invoice_to_chase_overdue_base_decimal, row.available_customer_credit_base_decimal,
      row.customer_credit_applied_base_decimal, row.customer_to_chase_overdue_base_decimal,
      row.excess_available_customer_credit_base_decimal], ['1000','300','300','700','0'])
    assert.equal(row.customer_credit_state, 'ready')
    assert.equal(row.to_chase_overdue_base_decimal, '1000')
    assert.equal(row.collectible_overdue_base_decimal, '1000')
    assert.equal(row.to_chase_outstanding_base_decimal, '1000')
  })
}

test('three credit kinds combine once, clamp at zero, and leave invoice ageing and counts intact', async () => {
  const app = createDisputesJourney({ invoices:[
    journeyInvoice('old','acme',800,{ due_date:daysAgo(100) }),
    journeyInvoice('young','acme',200,{ due_date:daysAgo(20) }),
  ] })
  const before = customer(await summary(app))
  certify(app, [credit('overpayment','100'),credit('prepayment','200'),credit('credit_note','300')])
  const after = customer(await summary(app))
  assert.equal(after.available_customer_credit_base_decimal, '600')
  assert.equal(after.customer_to_chase_overdue_base_decimal, '400')
  assert.equal(after.weighted_avg_overdue_days, 84)
  assert.equal(after.weighted_avg_overdue_days, before.weighted_avg_overdue_days)
  assert.equal(after.actionable_overdue_invoices_count, 2)
  assert.equal(after.overdue_invoices_count, 2)
  assert.equal(after.to_chase_overdue_base_decimal, '1000')
  certify(app, [credit('credit_note','1500')])
  const clamped = customer(await summary(app))
  assert.deepEqual([clamped.customer_credit_applied_base_decimal, clamped.customer_to_chase_overdue_base_decimal,
    clamped.excess_available_customer_credit_base_decimal], ['1000','0','500'])
  assert.equal(clamped.weighted_avg_overdue_days, 84)
  assert.equal(clamped.actionable_overdue_invoices_count, 2)
})

test('future debt and foreign future currency stay outside the overdue credit deduction', async () => {
  const app = createDisputesJourney({ invoices:[journeyInvoice('due','acme',1000),
    journeyInvoice('future','acme',2000,{ due_date:daysAgo(-10), transaction_currency_code:'EUR',
      amount_due_base:'2000', xero_currency_rate:'1', currency_conversion_status:'converted' })] })
  certify(app, [credit('overpayment','600')])
  const row = customer(await summary(app))
  assert.equal(row.customer_credit_state, 'ready')
  assert.equal(row.invoice_to_chase_overdue_base_decimal, '1000')
  assert.equal(row.customer_to_chase_overdue_base_decimal, '400')
  assert.equal(row.to_chase_outstanding_base_decimal, '3000')
  assert.equal(row.total_outstanding_base_decimal, '3000')
  app.tables.canonical_invoices[0].due_date = daysAgo(-5)
  const futureOnly = customer(await summary(app))
  assert.equal(futureOnly.invoice_to_chase_overdue_base_decimal, '0')
  assert.equal(futureOnly.customer_to_chase_overdue_base_decimal, '0')
  assert.equal(futureOnly.available_customer_credit_base_decimal, '600')
  assert.equal(futureOnly.excess_available_customer_credit_base_decimal, '600')
  assert.equal(futureOnly.to_chase_outstanding_base_decimal, '3000')
})

test('ready zero differs from missing, failed, legacy and unsupported currency', async () => {
  const app = createDisputesJourney({ invoices:[journeyInvoice('a','acme',1000)] })
  certify(app, [])
  const zero = customer(await summary(app))
  assert.deepEqual([zero.customer_credit_state,zero.available_customer_credit_base_decimal,
    zero.customer_credit_applied_base_decimal,zero.customer_to_chase_overdue_base_decimal], ['ready','0','0','1000'])
  app.tables.xero_customer_credit_validations = []
  const missing = customer(await summary(app))
  assert.deepEqual([missing.customer_credit_state,missing.available_customer_credit_base_decimal,
    missing.customer_credit_applied_base_decimal,missing.customer_to_chase_overdue_base_decimal], ['unavailable',null,'0','1000'])
  certify(app, [credit('credit_note','300')], { readiness_state:'unavailable', reason_code:'credit_state_changed' })
  assert.equal(customer(await summary(app)).customer_credit_state, 'unavailable')
  certify(app, [credit('credit_note','300',{ currency_code:'EUR' })])
  const foreignCredit = customer(await summary(app))
  assert.deepEqual([foreignCredit.customer_credit_state,foreignCredit.available_customer_credit_base_decimal,
    foreignCredit.customer_credit_applied_base_decimal,foreignCredit.customer_to_chase_overdue_base_decimal],
    ['unsupported_currency',null,'0','1000'])
  app.tables.canonical_invoices[0] = journeyInvoice('a','acme',1000,{ transaction_currency_code:'EUR',
    amount_due_base:'1000', xero_currency_rate:'1', currency_conversion_status:'converted' })
  certify(app, [credit('credit_note','300')])
  assert.equal(customer(await summary(app)).customer_credit_state, 'unsupported_currency')
})

test('held generation, owner and tenant scope prevent borrowing previous or foreign credit', async () => {
  const app = createDisputesJourney({ invoices:[journeyInvoice('a','acme',1000)] })
  certify(app, [credit('credit_note','300',{ user_id:'other' })])
  assert.equal(customer(await summary(app)).customer_credit_state, 'unavailable')
  certify(app, [credit('credit_note','300',{ tenant_id:'other' })])
  assert.equal(customer(await summary(app)).customer_credit_state, 'unavailable')
  certify(app, [credit('credit_note','300',{ sync_run_id:'other' })])
  assert.equal(customer(await summary(app)).customer_credit_state, 'unavailable')
  certify(app, [credit('credit_note','300')], { user_id:'other' })
  assert.equal(customer(await summary(app)).customer_credit_state, 'unavailable')
  certify(app, [credit('credit_note','300')])
  app.promote()
  assert.equal(customer(await summary(app)).customer_credit_state, 'unavailable')
})

test('legacy rows retain invoice actionability and cannot use a newer generation certificate', async () => {
  const app = createDisputesJourney({ invoices:[journeyInvoice('a','acme',1000)] })
  certify(app, [credit('credit_note','300')])
  app.tables.xero_sync_tenant_state = []
  for (const table of ['canonical_organisations','canonical_customers','canonical_invoices','canonical_payments']) {
    for (const row of app.tables[table]) row.sync_run_id = null
  }
  const row = customer(await summary(app))
  assert.equal(row.customer_credit_state, 'unavailable')
  assert.equal(row.invoice_to_chase_overdue_base_decimal, '1000')
  assert.equal(row.customer_to_chase_overdue_base_decimal, '1000')
})

test('duplicates, failed evidence read and mid-read promotion withhold credit safely', async () => {
  const app = createDisputesJourney({ invoices:[journeyInvoice('a','acme',1000)] })
  certify(app, [credit('credit_note','300'),credit('credit_note','300')])
  assert.equal(customer(await summary(app)).customer_credit_state, 'unavailable')
  certify(app, [credit('credit_note','300')])
  const original = app.admin.from
  app.admin.from = table => {
    if (table === 'canonical_customer_credit_evidence_exact') throw new Error('credit read unavailable')
    return original(table)
  }
  assert.equal(customer(await summary(app)).customer_credit_state, 'unavailable')
  app.admin.from = table => {
    if (table === 'canonical_customer_credit_evidence_exact') app.promote()
    return original(table)
  }
  await assert.rejects(summary(app), /snapshot changed/)
})

test('large exact evidence reaches summary without binary rounding; scoped refresh uses bounded reads', async () => {
  const due = '9007199254740993.000000000000000004'
  const app = createDisputesJourney({ invoices:[journeyInvoice('a','acme',due)] })
  certify(app, [credit('credit_note','9007199254740993.000000000000000003')])
  const row = customer(await summary(app,'acme'))
  assert.equal(row.invoice_to_chase_overdue_base_decimal, due)
  assert.equal(row.available_customer_credit_base_decimal, '9007199254740993.000000000000000003')
  assert.equal(row.customer_to_chase_overdue_base_decimal, '0.000000000000000001')
  assert.equal(app.calls.filter(table => table === 'xero_customer_credit_validations').length, 1)
  assert.equal(app.calls.filter(table => table === 'canonical_customer_credit_evidence_exact').length, 2)
})

test('portfolio evidence and certificate loads do not grow with customer count', async () => {
  const invoices = [journeyInvoice('a','acme',1000),
    ...Array.from({length:40}, (_, index) => journeyInvoice(`i${index}`,`c${index}`,100))]
  const app = createDisputesJourney({ invoices })
  certify(app, [credit('credit_note','300')])
  const result = await summary(app)
  assert.equal(result.rows.length, 41)
  assert.equal(customer(result).customer_to_chase_overdue_base_decimal, '700')
  assert.equal(app.calls.filter(table => table === 'xero_customer_credit_validations').length, 1)
  assert.equal(app.calls.filter(table => table === 'canonical_customer_credit_evidence_exact').length, 1)
})

test('Phase 4 uses the net customer amount for Exposure and queue while keeping invoice fields intact', async () => {
  const app = createDisputesJourney({ invoices:[journeyInvoice('a','acme',1000)] })
  const beforeActions = await app.actions()
  const beforeCustomers = await app.customers()
  certify(app, [credit('credit_note','1000')])
  const afterActions = await app.actions()
  const afterCustomers = await app.customers()
  assert.equal(beforeActions.status, 200)
  assert.equal(afterActions.status, 200)
  assert.equal(afterActions.body.rows.length, 0)
  assert.equal(afterActions.body.portfolio.totalOverdueBase, 0)
  assert.equal(afterActions.body.portfolio.weightedAverageOverdueDays, beforeActions.body.portfolio.weightedAverageOverdueDays)
  assert.deepEqual(app.firstValue(afterActions.body), [])
  const before = customer(beforeCustomers.body)
  const after = customer(afterCustomers.body)
  for (const field of ['to_chase_overdue_base_decimal','to_chase_outstanding_base_decimal',
    'collectible_overdue_base_decimal','weighted_avg_overdue_days','actionable_overdue_invoices_count']) {
    assert.equal(after[field], before[field], field)
  }
  assert.equal(after.customer_to_chase_overdue_base_decimal, '0')
})

test('Exposure and portfolio monetary benchmarks use net balances while ageing stays invoice-derived', async () => {
  const app = createDisputesJourney({ invoices:[
    journeyInvoice('a','acme',800,{ due_date:daysAgo(100) }),
    journeyInvoice('a2','acme',200,{ due_date:daysAgo(20) }),
    journeyInvoice('b','baker',700,{ due_date:daysAgo(40) }),
  ] })
  const before = (await app.actions()).body
  const beforeBaker = before.rows.find(row => row.customer_source_id === 'baker')
  certify(app, [credit('overpayment','600')])
  const after = (await app.actions()).body
  const acme = after.rows.find(row => row.customer_source_id === 'acme')
  const baker = after.rows.find(row => row.customer_source_id === 'baker')
  assert.deepEqual([acme.invoice_to_chase_overdue_base_decimal,
    acme.customer_to_chase_overdue_base_decimal,
    acme.collectible_overdue_base_decimal], ['1000','400','1000'])
  assert.equal(after.portfolio.totalOverdueBase, 1100)
  assert.equal(after.portfolio.largestCustomerOverdueBase, 700)
  assert.equal(after.portfolio.analysedOverdueBase, 1100)
  assert.equal(acme.exposure_relative_to_largest_percent, 400 / 700 * 100)
  assert.equal(baker.exposure_score, 100)
  assert.equal(after.portfolio.weightedAverageOverdueDays, before.portfolio.weightedAverageOverdueDays)
  assert.equal(acme.weighted_avg_overdue_days, 84)
  assert.equal(acme.actionable_overdue_invoices_count, 2)
  assert.equal(baker.urgency_score, beforeBaker.urgency_score)
  assert.equal(baker.relative_lateness_score, beforeBaker.relative_lateness_score)
  assert.equal(baker.payment_recency_score, beforeBaker.payment_recency_score)
  assert.equal(acme.to_chase_outstanding_base_decimal, '1000')
})

test('credit-covered zero cannot be revived by invoice count or Priority; partial and unavailable credit remain actionable', async () => {
  const app = createDisputesJourney({ invoices:[journeyInvoice('a','acme',500)] })
  app.override('acme','priority')
  certify(app, [credit('credit_note','500')])
  let queue = (await app.actions()).body
  assert.equal(queue.rows.length, 0)
  assert.equal(queue.queue.status, 'no_eligible_customers')
  assert.equal(queue.portfolio.totalOverdueBase, 0)
  assert.deepEqual(app.firstValue(queue), [])
  assert.equal((await app.customers()).body.rows.find(row => row.customer_source_id === 'acme').actionable_overdue_invoices_count, 1)

  certify(app, [credit('credit_note','800')])
  queue = (await app.actions()).body
  assert.equal(queue.rows.length, 0)

  certify(app, [credit('credit_note','200')])
  queue = (await app.actions()).body
  assert.equal(queue.rows[0].customer_to_chase_overdue_base_decimal, '300')
  assert.equal(queue.rows[0].invoice_to_chase_overdue_base_decimal, '500')
  assert.equal(queue.portfolio.totalOverdueBase, 300)
  assert.equal(app.firstValue(queue)[0].customer_source_id, 'acme')
  assert.match(app.firstValue(queue)[0].first_value_reasons[0].text, /£300 overdue/)

  app.tables.xero_customer_credit_validations = []
  queue = (await app.actions()).body
  assert.equal(queue.rows[0].customer_to_chase_overdue_base_decimal, '500')
  certify(app, [credit('credit_note','200',{ currency_code:'EUR' })])
  queue = (await app.actions()).body
  assert.equal(queue.rows[0].customer_to_chase_overdue_base_decimal, '500')
})

test('future invoice actionability remains separate when credit covers the overdue balance', async () => {
  const app = createDisputesJourney({ invoices:[
    journeyInvoice('due','acme',200),
    journeyInvoice('future','acme',2000,{ due_date:daysAgo(-10) }),
  ] })
  certify(app, [credit('prepayment','500')])
  const row = customer(await summary(app))
  assert.equal(row.to_chase_outstanding_base_decimal, '2200')
  assert.equal(row.invoice_to_chase_overdue_base_decimal, '200')
  assert.equal(row.customer_to_chase_overdue_base_decimal, '0')
  const queue = (await app.actions()).body
  assert.equal(queue.rows.length, 0)
  assert.deepEqual(app.firstValue(queue), [])

  const futureOnlyApp = createDisputesJourney({ invoices:[
    journeyInvoice('future-only','acme',2000,{ due_date:daysAgo(-10) }),
  ] })
  certify(futureOnlyApp, [credit('prepayment','500')])
  const informational = (await futureOnlyApp.actions('overdueOnly=false')).body
  assert.equal(informational.rows.length, 1)
  assert.equal(informational.rows[0].recommended_action, 'No action')
  assert.equal(informational.rows[0].customer_to_chase_overdue_base_decimal, '0')
})

test('equal numeric scores break ties using exact post-credit customer money', async () => {
  const app = createDisputesJourney({ invoices:[
    journeyInvoice('z','zeta','500.000000000000000002'),
    journeyInvoice('a','alpha','500'),
  ] })
  certify(app, [credit('credit_note','0.000000000000000001', {
    customer_source_id:'zeta', source_id:'zeta-credit',
  })])
  const queue = (await app.actions()).body
  assert.equal(queue.rows.length, 2)
  assert.equal(queue.rows[0].customer_source_id, 'zeta')
  assert.equal(queue.rows[0].customer_to_chase_overdue_base_decimal, '500.000000000000000001')
  assert.equal(queue.rows[1].customer_to_chase_overdue_base_decimal, '500')
})
