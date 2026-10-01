import assert from 'node:assert/strict'
import test, { before, after, mock } from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
import { createDisputesJourney, journeyInvoice, USER_ID, TENANT_ID } from './test-helpers/disputes-journey-fixture.mjs'

// Fixed calendar; only database/auth transport is mocked. These assertions run
// the production mapper, actionability domains, summary, routes and scorer.
before(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T12:00:00Z') }))
after(() => mock.timers.reset())
const owner = { user_id: USER_ID, tenant_id: TENANT_ID, source_system: 'xero' }
const { deriveInvoiceActionability } = loadTypeScriptModule('lib/collections/invoice-actionability.ts')
const { sumDecimalValues } = loadTypeScriptModule('lib/money/currency.ts')
const { buildXeroCanonicalRows } = loadTypeScriptModule('lib/xero/canonical-mapper.ts')
const snapshots = loadTypeScriptModule('lib/xero/authoritative-snapshot.ts')
const { loadCustomerCollectionsSummaryWithMetadata: loadSummary } = loadTypeScriptModule('lib/collections/customer-summary.ts', {
  mocks: { '@/lib/supabase-server': {}, '@/lib/xero/authoritative-snapshot': snapshots,
    '@/lib/collections/invoice-promises-loading': loadTypeScriptModule('lib/collections/invoice-promises-loading.ts', {
      mocks: { '@/lib/xero/authoritative-snapshot': snapshots },
    }) },
})
const types = { overpayment: 'RECEIVE-OVERPAYMENT', prepayment: 'RECEIVE-PREPAYMENT', credit_note: 'ACCRECCREDIT' }
function credit(kind, amount, extra = {}) {
  return { ...owner, sync_run_id: 'generation-1', source_kind: kind, source_id: `${kind}-1`,
    customer_source_id: 'acme', provider_type: types[kind], status: 'AUTHORISED',
    residual_state: amount === '0' ? 'zero' : 'qualifying', remaining_credit_native: amount,
    currency_code: 'GBP', organisation_base_currency_code: 'GBP', xero_currency_rate: '1', ...extra }
}
function certifyCredit(app, rows = []) {
  const count = kind => rows.filter(row => row.source_kind === kind).length
  app.tables.xero_customer_credit_validations = [{ ...owner, sync_run_id: 'generation-1',
    contract_version: 'customer_credit_v1', invoice_money_contract_version: 'invoice_exact_v1',
    readiness_state: 'ready', reason_code: 'stable_observation', consistency_result: 'matched',
    resource_observations: { initial: { overpayments: { count: count('overpayment') },
      prepayments: { count: count('prepayment') }, creditnotes: { count: count('credit_note') } } } }]
  app.tables.canonical_customer_credit_evidence_exact = rows
}
function promise(id, amount, extra = {}) {
  return { ...owner, id: `promise-${id}`, invoice_source_id: id, customer_source_id: 'acme',
    status: 'active', currency_code: 'GBP', promised_amount_native: amount,
    qualifying_paid_amount_native: '0', promised_date: '2026-10-08', revision: '1', ...extra }
}
function dispute(id, amount, extra = {}) {
  return { ...owner, id: `dispute-${id}`, invoice_source_id: id, dispute_mode: 'partial',
    is_active: true, recorded_disputed_amount_native: amount, amount_due_at_last_review_native: '1000',
    revision: 1, note: null, resolved_at: null, ...extra }
}
async function read(app, customerSourceId = 'acme', tenantId = TENANT_ID) {
  const result = await loadSummary(app.admin, USER_ID, tenantId)
  const row = result.rows.find(row => row.customer_source_id === customerSourceId)
  assert.ok(row, `missing customer ${customerSourceId}`)
  return row
}
const moneyFields = ['gross_outstanding_base_decimal', 'effective_disputed_outstanding_base_decimal',
  'active_promised_outstanding_base_decimal', 'invoice_to_chase_overdue_base_decimal',
  'available_customer_credit_base_decimal', 'customer_credit_applied_base_decimal',
  'customer_to_chase_overdue_base_decimal', 'excess_available_customer_credit_base_decimal']
function assertMoney(row, expected) {
  assert.deepEqual(moneyFields.map(field => row[field]), expected, moneyFields.join(', '))
  // Reconcile returned components, without implementing suppression rules here.
  assert.equal(sumDecimalValues([expected[1], expected[2], row.to_chase_outstanding_base_decimal]), expected[0])
  assert.equal(sumDecimalValues([expected[5], expected[6]]), expected[3])
  assert.equal(sumDecimalValues([expected[5], expected[7]]), expected[4])
}
function assertInvoice(invoice, d, p, expected) {
  const result = deriveInvoiceActionability(invoice, d ?? null, p ?? null)
  assert.deepEqual([result.currentAmountDueNative, result.effectiveDisputedAmountNative,
    result.activePromisedCoverageAmountNative, result.toChaseAmountNative], expected)
}

test('provider AmountDue, not Total minus a second payment deduction, reaches customer and queue', async t => {
  for (const [name, inputs, expectedInvoices, expectedTotal] of [
    ['unpaid', [['1000', '0', '1000', 'AUTHORISED']], ['1000'], '1000'],
    ['multiple unpaid', [['1000', '0', '1000', 'AUTHORISED'], ['250', '0', '250', 'AUTHORISED']], ['1000', '250'], '1250'],
    ['partial payment', [['1000', '300', '700', 'AUTHORISED']], ['700'], '700'],
    ['fully paid', [['1000', '1000', '0', 'PAID']], ['0'], '0'],
    ['paid and unpaid', [['1000', '1000', '0', 'PAID'], ['250', '0', '250', 'AUTHORISED']], ['0', '250'], '250'],
    ['zero open balance', [['1000', '1000', '0', 'AUTHORISED']], ['0'], '0'],
    ['near zero exact balance', [['0.000000000000000001', '0', '0.000000000000000001', 'AUTHORISED']], ['0.000000000000000001'], '0.000000000000000001'],
  ]) await t.test(name, async () => {
    const raw = (source_id, raw_json) => ({ source_id, raw_json, fetched_at: '2026-10-01T10:00:00Z' })
    const mapped = buildXeroCanonicalRows({ userId: USER_ID, tenantId: TENANT_ID,
      organisationRows: [raw(TENANT_ID, { OrganisationID: TENANT_ID, BaseCurrency: 'GBP' })],
      organisationActionRows: [], contactRows: [raw('acme', { ContactID: 'acme', Name: 'Acme', IsCustomer: true })],
      invoiceRows: inputs.map(([Total, AmountPaid, AmountDue, Status], i) => raw(`i${i}`, {
        InvoiceID: `i${i}`, Contact: { ContactID: 'acme' }, Type: 'ACCREC', Status,
        CurrencyCode: 'GBP', Total, AmountPaid, AmountDue, AmountCredited: '0',
        DateString: '2026-08-01', DueDateString: '2026-09-01',
      })), paymentSource: 'resource' })
    const invoices = mapped.invoices.map(row => ({ ...row, sync_run_id: 'generation-1' }))
    const app = createDisputesJourney({ invoices }); certifyCredit(app)
    invoices.forEach((invoice, i) => assertInvoice(invoice, null, null, [expectedInvoices[i], '0', '0', expectedInvoices[i]]))
    const row = await read(app)
    assertMoney(row, [expectedTotal, '0', '0', expectedTotal, '0', '0', expectedTotal, '0'])
    const queue = await app.actions('overdueOnly=true')
    assert.equal(queue.status, 200)
    assert.equal(queue.body.portfolio.totalOverdueBaseDecimal, expectedTotal)
    assert.equal(queue.body.rows.length, expectedTotal === '0' ? 0 : 1)
  })
})

test('explicit cross-feature waterfall and credit source matrix', async t => {
  // Expected tuples: gross / effective dispute / effective Promise / invoice
  // aggregate / available credit / applied credit / customer To chase / excess.
  for (const [name, disputed, promised, credits, expected] of [
    ['full dispute', '1000', null, [], ['1000', '1000', '0', '0', '0', '0', '0', '0']],
    ['partial dispute', '200', null, [], ['1000', '200', '0', '800', '0', '0', '800', '0']],
    ['partial active promise', null, '300', [], ['1000', '0', '300', '700', '0', '0', '700', '0']],
    ['full active promise', null, '1000', [], ['1000', '0', '1000', '0', '0', '0', '0', '0']],
    ['A: dispute plus promise', '200', '300', [], ['1000', '200', '300', '500', '0', '0', '500', '0']],
    ['B: dispute plus credit', '200', null, [credit('credit_note', '150')], ['1000', '200', '0', '800', '150', '150', '650', '0']],
    ['C: promise plus credit', null, '300', [credit('prepayment', '150')], ['1000', '0', '300', '700', '150', '150', '550', '0']],
    ['D: dispute plus promise plus credit', '200', '300', [credit('overpayment', '150')], ['1000', '200', '300', '500', '150', '150', '350', '0']],
    ['E: collectively covered with excess', '200', '700', [credit('credit_note', '150')], ['1000', '200', '700', '100', '150', '100', '0', '50']],
    ['promise capped after dispute', '800', '700', [credit('prepayment', '150')], ['1000', '800', '200', '0', '150', '0', '0', '150']],
    ['overpayment only', null, null, [credit('overpayment', '300')], ['1000', '0', '0', '1000', '300', '300', '700', '0']],
    ['prepayment only', null, null, [credit('prepayment', '300')], ['1000', '0', '0', '1000', '300', '300', '700', '0']],
    ['authorised AR credit note only', null, null, [credit('credit_note', '300')], ['1000', '0', '0', '1000', '300', '300', '700', '0']],
    ['three eligible sources', null, null, [credit('overpayment', '100'), credit('prepayment', '200'), credit('credit_note', '300')], ['1000', '0', '0', '1000', '600', '600', '400', '0']],
    ['zero residual', null, null, [credit('credit_note', '0')], ['1000', '0', '0', '1000', '0', '0', '1000', '0']],
    ['credit equals debt', null, null, [credit('credit_note', '1000')], ['1000', '0', '0', '1000', '1000', '1000', '0', '0']],
    ['credit exceeds debt', null, null, [credit('credit_note', '1200')], ['1000', '0', '0', '1000', '1200', '1000', '0', '200']],
  ]) await t.test(name, async () => {
    const invoice = journeyInvoice('a', 'acme', '1000')
    const app = createDisputesJourney({ invoices: [invoice] })
    const d = disputed ? dispute('a', disputed, { dispute_mode: name === 'full dispute' ? 'full' : 'partial' }) : null
    const p = promised ? promise('a', promised) : null
    if (d) app.tables.invoice_disputes.push(d)
    if (p) app.tables.invoice_promises.push(p)
    certifyCredit(app, credits)
    assertInvoice(invoice, d, p, ['1000', expected[1], expected[2], expected[3]])
    assertMoney(await read(app), expected)
    const queue = await app.actions()
    assert.equal(queue.status, 200)
    assert.equal(queue.body.portfolio.totalOverdueBaseDecimal, expected[6])
    assert.equal(queue.body.rows.length, expected[6] === '0' ? 0 : 1)
    if (expected[6] !== '0') assert.equal(queue.body.rows[0].customer_to_chase_overdue_base_decimal, expected[6])
  })
})

test('dispute resolution/reactivation and later payment change effective coverage without double deduction', async () => {
  const app = createDisputesJourney({ invoices: [journeyInvoice('a', 'acme', '1000')] }); certifyCredit(app)
  const saved = await app.mutate({ operation: 'partial', invoiceSourceId: 'a', disputedAmountNative: '600' })
  assert.equal(saved.status, 200)
  assertMoney(await read(app), ['1000', '600', '0', '400', '0', '0', '400', '0'])
  const d = app.tables.invoice_disputes[0]
  assert.equal((await app.mutate({ operation: 'resolve', disputeId: d.id, expected_revision: String(d.revision) })).status, 200)
  assertMoney(await read(app), ['1000', '0', '0', '1000', '0', '0', '1000', '0'])
  assert.equal((await app.mutate({ operation: 'reactivate', disputeId: d.id, expected_revision: String(d.revision) })).status, 200)
  assertMoney(await read(app), ['1000', '600', '0', '400', '0', '0', '400', '0'])
  Object.assign(app.tables.canonical_invoices[0], { amount_due_native: '400', amount_due_base: '400', amount_paid_native: '600' })
  assertInvoice(app.tables.canonical_invoices[0], d, null, ['400', '400', '0', '0'])
  assertMoney(await read(app), ['400', '400', '0', '0', '0', '0', '0', '0'])
  d.dispute_mode = 'full'
  assertMoney(await read(app), ['400', '400', '0', '0', '0', '0', '0', '0'])
})

test('fixed Promise remainder follows certified payments; terminal histories never suppress', async () => {
  const invoice = journeyInvoice('a', 'acme', '700', { total_native: '1000', amount_paid_native: '300' })
  const app = createDisputesJourney({ invoices: [invoice] }); certifyCredit(app)
  const p = promise('a', '500', { qualifying_paid_amount_native: '300' })
  app.tables.invoice_promises.push(p)
  assertInvoice(invoice, null, p, ['700', '0', '200', '500'])
  assertMoney(await read(app), ['700', '0', '200', '500', '0', '0', '500', '0'])
  // An elapsed date is not an operational expired status in the approved model.
  p.promised_date = '2026-09-01'
  assertMoney(await read(app), ['700', '0', '200', '500', '0', '0', '500', '0'])
  for (const status of ['kept', 'missed', 'unclear', 'cancelled']) {
    p.status = status
    assertInvoice(invoice, null, p, ['700', '0', '0', '700'])
    assertMoney(await read(app), ['700', '0', '0', '700', '0', '0', '700', '0'])
  }
  // Several retained commitments, only one active; no lifecycle event read.
  app.tables.invoice_promises.push(promise('a', '100', { id: 'new-active' }))
  app.tables.invoice_promise_events = [{ promise_id: p.id, event_type: 'missed', promised_amount_native: '999999' }]
  assertMoney(await read(app), ['700', '0', '100', '600', '0', '0', '600', '0'])
  assert.equal(app.calls.includes('invoice_promise_events'), false)
})

test('customer, tenant, owner, provider and held-generation identities cannot mix totals', async () => {
  const app = createDisputesJourney({ invoices: [journeyInvoice('a', 'acme', '1000'),
    journeyInvoice('a2', 'acme', '400'), journeyInvoice('paid', 'acme', '0', { status: 'PAID' }),
    journeyInvoice('b', 'baker', '700')] })
  app.tables.invoice_disputes.push(dispute('a', '200'), dispute('a2', '100'))
  app.tables.invoice_promises.push(promise('a', '300'))
  certifyCredit(app, [credit('credit_note', '150'), credit('prepayment', '50', { customer_source_id: 'baker' })])
  const expectedAcme = ['1400', '300', '300', '800', '150', '150', '650', '0']
  assertMoney(await read(app), expectedAcme)
  assertMoney(await read(app, 'baker'), ['700', '0', '0', '700', '50', '50', '650', '0'])
  // Colliding durable IDs in unrelated scopes must not become second invoices,
  // override a customer name/base currency, or attach a foreign payment date.
  for (const extra of [{ user_id: 'other-owner' }, { tenant_id: 'other-tenant' },
    { source_system: 'other-provider' }, { sync_run_id: 'retained-generation' }, { sync_run_id: null }]) {
    for (const table of ['canonical_customers', 'canonical_invoices', 'canonical_organisations', 'canonical_payments']) {
      const rows = table === 'canonical_payments' ? [{ ...owner, sync_run_id: 'generation-1', source_id: 'p1',
        invoice_source_id: 'a', customer_source_id: 'acme', payment_date: '2026-10-01' }] : app.tables[table].filter(row => row.source_system === 'xero' && row.sync_run_id === 'generation-1' && row.user_id === USER_ID && row.tenant_id === TENANT_ID)
      app.tables[table].push(...rows.map(row => ({ ...row, ...extra })))
    }
  }
  assertMoney(await read(app), expectedAcme)
  assert.equal((await read(app)).last_payment_date, null)
  const snapshot = await snapshots.resolveXeroAuthoritativeSnapshot({ supabaseAdmin: app.admin, userId: USER_ID, tenantId: TENANT_ID })
  const scoped = await loadSummary(app.admin, USER_ID, TENANT_ID, { customerSourceId: 'acme', snapshot })
  assert.equal(scoped.rows.length, 1)
  assertMoney(scoped.rows[0], expectedAcme)
  assert.equal(scoped.rows[0].actionable_open_invoices_count, 2)
  assert.equal(scoped.rows[0].last_payment_date, null)
  app.tables.xero_sync_tenant_state.push({ ...app.tables.xero_sync_tenant_state[0], tenant_id: 'other-tenant' })
  app.tables.xero_sync_runs.push({ ...app.tables.xero_sync_runs[0], tenant_id: 'other-tenant' })
  app.tables.xero_customer_credit_validations.push({ ...app.tables.xero_customer_credit_validations[0], tenant_id: 'other-tenant' })
  app.tables.canonical_customer_credit_evidence_exact.push(...app.tables.canonical_customer_credit_evidence_exact.map(row => ({ ...row, tenant_id: 'other-tenant' })))
  // The same customer and invoice IDs in the second tenant have their own
  // balances and credit; first-tenant dispute/Promise state cannot leak across.
  assertMoney(await read(app, 'acme', 'other-tenant'), ['1400', '0', '0', '1400', '150', '150', '1250', '0'])
})

test('pagination and retained generations never count the same invoice twice', async () => {
  const app = createDisputesJourney({ invoices: Array.from({ length: 1001 }, (_, i) => journeyInvoice(`i${String(i).padStart(4, '0')}`, 'acme', '0.01')) })
  app.tables.canonical_invoices.push(...app.tables.canonical_invoices.map(row => ({ ...row, sync_run_id: 'old' })))
  certifyCredit(app, [credit('credit_note', '0.01')])
  const row = await read(app)
  assertMoney(row, ['10.01', '0', '0', '10.01', '0.01', '0.01', '10', '0'])
  assert.equal(row.actionable_open_invoices_count, 1001)
})

test('each canonical read excludes another provider before identity mapping', async t => {
  for (const table of ['canonical_customers', 'canonical_invoices', 'canonical_payments', 'canonical_organisations']) {
    await t.test(table, async () => {
      const app = createDisputesJourney({ invoices: [journeyInvoice('a', 'acme', '1000')] }); certifyCredit(app)
      const foreign = table === 'canonical_payments'
        ? { ...owner, sync_run_id: 'generation-1', source_id: 'p1', invoice_source_id: 'a',
          customer_source_id: 'acme', payment_date: '2026-10-01' }
        : { ...app.tables[table][0] }
      foreign.source_system = 'other-provider'
      if (table === 'canonical_customers') foreign.source_id = 'foreign-customer'
      app.tables[table].push(foreign)
      const result = await loadSummary(app.admin, USER_ID, TENANT_ID)
      assert.equal(result.currencyHealth.status, 'healthy')
      assert.deepEqual(result.sourceCounts, { customers: 1, invoices: 1, payments: 0 })
      assert.equal(result.rows.length, 1)
      assertMoney(result.rows[0], ['1000', '0', '0', '1000', '0', '0', '1000', '0'])
      assert.equal(result.rows[0].last_payment_date, null)
    })
  }
})

test('ordinary/allocated payments, refunds, bank receipts and supplier credits cannot become available credit', async () => {
  const app = createDisputesJourney({ invoices: [journeyInvoice('a', 'acme', '700', { total_native: '1000', amount_paid_native: '300' })] })
  certifyCredit(app)
  app.tables.canonical_payments = ['ACCRECPAYMENT', 'ARCREDITPAYMENT', 'ACCPAYPAYMENT'].map((payment_type, i) => ({
    ...owner, sync_run_id: 'generation-1', source_id: `p${i}`, invoice_source_id: 'a',
    customer_source_id: 'acme', payment_date: '2026-09-20', amount_native: '300', payment_type,
  }))
  assertMoney(await read(app), ['700', '0', '0', '700', '0', '0', '700', '0'])
  for (const [source_kind, provider_type] of [['payment', 'ACCRECPAYMENT'], ['allocation', 'ACCRECPAYMENT'],
    ['refund', 'ARCREDITPAYMENT'], ['bank_transaction', 'RECEIVE'], ['credit_note', 'ACCPAYCREDIT'],
    ['overpayment', 'SPEND-OVERPAYMENT'], ['prepayment', 'SPEND-PREPAYMENT']]) {
    certifyCredit(app, [credit(source_kind, '300', { provider_type })])
    const row = await read(app)
    assert.equal(row.customer_credit_state, 'unavailable', provider_type)
    assert.equal(row.available_customer_credit_base_decimal, null)
    assert.equal(row.customer_credit_applied_base_decimal, '0')
    assert.equal(row.customer_to_chase_overdue_base_decimal, '700')
  }
})

test('native FX splits reconcile in base currency; foreign credit is explicitly unsupported', async () => {
  const usd = journeyInvoice('usd', 'acme', '1000', { transaction_currency_code: 'USD',
    xero_currency_rate: '3', amount_due_base: '333.33333333', currency_conversion_status: 'converted' })
  const app = createDisputesJourney({ invoices: [usd, journeyInvoice('gbp', 'acme', '100')] })
  app.tables.invoice_disputes.push(dispute('usd', '200'))
  app.tables.invoice_promises.push(promise('usd', '300', { currency_code: 'USD' }))
  certifyCredit(app, [credit('credit_note', '50')])
  assertInvoice(usd, app.tables.invoice_disputes[0], app.tables.invoice_promises[0], ['1000', '200', '300', '500'])
  const row = await read(app)
  assert.deepEqual([row.gross_outstanding_base_decimal, row.effective_disputed_outstanding_base_decimal,
    row.active_promised_outstanding_base_decimal, row.invoice_to_chase_overdue_base_decimal],
  ['433.33333333', '66.66666666', '100', '266.66666667'])
  assert.equal(sumDecimalValues(['66.66666666', '100', '266.66666667']), '433.33333333')
  assert.equal(row.customer_credit_state, 'unsupported_currency')
  assert.equal(row.customer_credit_applied_base_decimal, '0')
  assert.equal(row.customer_to_chase_overdue_base_decimal, '266.66666667')
  assert.deepEqual(row.native_currency_breakdown.map(item => [item.currency_code, item.total_outstanding_native]), [['GBP', '100'], ['USD', '1000']])
})

test('creating Action History changes eligibility but preserves every monetary input, benchmark and score', async () => {
  const app = createDisputesJourney({ invoices: [journeyInvoice('a', 'acme', '1000'), journeyInvoice('b', 'baker', '700')] })
  app.tables.invoice_disputes.push(dispute('a', '200'))
  app.tables.invoice_promises.push(promise('a', '300'))
  certifyCredit(app, [credit('credit_note', '150')])
  const { createActionHistory } = loadTypeScriptModule('lib/collections/action-history-server.ts', {
    mocks: {
      '@/lib/supabase-server': { createServerSupabaseClient: async () => ({ auth: {
        getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
      } }) },
      '@/lib/supabase-admin': { createSupabaseAdminClient: () => app.admin },
      '@/lib/billing/entitlements': { claimActionsEntitlementStatus: async () => ({ tenantId: TENANT_ID, hasActionsAccess: true }) },
    },
  })
  const beforeMoney = await read(app)
  assertMoney(beforeMoney, ['1000', '200', '300', '500', '150', '150', '350', '0'])
  const accountingBefore = structuredClone(Object.fromEntries(Object.entries(app.tables).filter(([key]) => key !== 'collection_actions')))
  const beforeQueue = (await app.actions()).body
  const result = await createActionHistory({ action_id: '00000000-0000-4000-8000-000000000001',
    tenant_id: TENANT_ID, source_system: 'xero', customer_source_id: 'acme', outcome: 'message_sent',
    note: 'Synthetic follow-up', next_action_date: '2026-10-02' }, new Date('2026-10-01T12:00:00Z'))
  assert.equal(result.replayed, false)
  assert.equal(app.tables.collection_actions.length, 1)
  assert.deepEqual(await read(app), beforeMoney)
  assert.deepEqual(Object.fromEntries(Object.entries(app.tables).filter(([key]) => key !== 'collection_actions')), accountingBefore)
  const afterQueue = (await app.actions()).body
  assert.deepEqual(afterQueue.portfolio, beforeQueue.portfolio)
  assert.equal(afterQueue.rows.some(row => row.customer_source_id === 'acme'), false)
  const scoreFields = ['base_score', 'priority_score', 'exposure_score', 'urgency_score', 'relative_lateness_score', 'payment_recency_score']
  const scores = (queue, id) => scoreFields.map(key => queue.rows.find(row => row.customer_source_id === id)[key])
  assert.deepEqual(scores(afterQueue, 'baker'), scores(beforeQueue, 'baker'))
  // An already-due follow-up keeps the history record while exposing its score.
  app.tables.collection_actions[0].next_action_date = '2026-10-01'
  assert.deepEqual(scores((await app.actions()).body, 'acme'), scores(beforeQueue, 'acme'))
})
