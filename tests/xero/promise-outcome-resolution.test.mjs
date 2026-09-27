import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
import { promise, payment, cash, observation, valuation as currencyValuation } from './test-helpers/promise-evidence-fixture.mjs'
const { qualifyPromisePayments: qualify } = loadTypeScriptModule('lib/collections/promise-payment-qualification.ts')
const { resolvePromiseOutcome: resolve } = loadTypeScriptModule('lib/collections/promise-outcome-resolution.ts')
function input({ terms = {}, payments = [payment()], cashRows = [], observed = {}, valuation = null } = {}) {
  const record = promise(terms), obs = observation(payments, cashRows, observed)
  return { promise: record, observation: obs, cash: cashRows, promiseValuation: valuation,
    qualifiedPayments: qualify({ promise: record, observation: obs, payments }) }
}
const early = { started: '2026-09-28T12:00:00Z', completed: '2026-09-28T12:01:00Z' }
test('early fulfilment returns Kept with accounting effective date, no fabricated cash instant', () => {
  const result = resolve(input({ payments: [payment({ amount_native: '4000' })], observed: early }))
  assert.equal(result.decision, 'kept'); assert.equal(result.transition_required, true)
  assert.equal(result.effective_date, '2026-09-28'); assert.equal(result.effective_at, null)
})
test('overfulfilment remains truthful and crossing date follows accounting chronology', () => {
  const result = resolve(input({ payments: [payment({ amount_native: '3000' }), payment({ source_id: 'p2', amount_native: '2000', payment_date: '2026-09-30' })] }))
  assert.equal(result.decision, 'kept'); assert.equal(result.qualifying_paid_amount_native, '5000')
  assert.equal(result.effective_date, '2026-09-30')
})
test('actual payment fulfilment does not depend on cash resources or FX', () => {
  const value = input({ payments: [payment({ amount_native: '4000' })], observed: { ready: false } })
  value.observation.resources[1].complete = false
  assert.equal(resolve(value).decision, 'kept')
})
test('partial payment before deadline retains Active with remaining commitment', () => {
  const result = resolve(input({ observed: early }))
  assert.equal(result.decision, 'retain_active'); assert.equal(result.qualifying_paid_amount_native, '1000')
  assert.equal(result.remaining_unpaid_amount_native, '3000'); assert.equal(result.terminal, false)
})
test('pre-deadline cash failure is not required for a payment-only retain decision', () => {
  const value = input({ observed: { ...early, ready: false } }); value.observation.resources[1].complete = false
  assert.equal(resolve(value).decision, 'retain_active')
})
for (const resource of ['payments', 'overpayments', 'prepayments']) {
  test(`${resource} observation straddling midnight cannot establish negative outcome`, () => {
    const value = input()
    const row = value.observation.resources.find(row => row.resource === resource)
    row.started_at = '2026-09-30T22:59:59Z'; row.completed_at = '2026-10-01T00:01:00Z'
    value.qualifiedPayments = qualify({ promise: value.promise, observation: value.observation, payments: [payment()] })
    assert.equal(resolve(value).decision, 'retain_active')
  })
}
test('start exactly at the next-local-day boundary is eligible without grace period', () => {
  const value = input({ observed: { started: '2026-09-30T23:00:00Z', completed: '2026-09-30T23:01:00Z' } })
  const result = resolve(value)
  assert.equal(result.decision, 'missed'); assert.equal(result.effective_at, '2026-09-30T23:00:00.000Z')
})
test('partial paid and complete zero cash after deadline is Missed with paid evidence retained', () => {
  const result = resolve(input())
  assert.equal(result.decision, 'missed'); assert.equal(result.qualifying_paid_amount_native, '1000')
  assert.equal(result.evidence.payments.length, 1)
})
for (const [amount, decision] of [['3000', 'unclear'], ['3500', 'unclear'], ['2000', 'missed']]) {
  test(`cash ${amount} compares to remaining 3000 rather than original 4000: ${decision}`, () => {
    assert.equal(resolve(input({ cashRows: [cash({ remaining_credit_native: amount, remaining_credit_base: amount })] })).decision, decision)
  })
}
test('prepayment and overpayment amounts sum without allocation', () => {
  const result = resolve(input({ cashRows: [cash({ remaining_credit_native: '1000' }), cash({ source_kind: 'prepayment', source_id: 'cash-2', provider_type: 'RECEIVE-PREPAYMENT', remaining_credit_native: '2000' })] }))
  assert.equal(result.decision, 'unclear')
})
test('one customer balance can independently make two promises Unclear, never Kept', () => {
  const rows = [cash({ remaining_credit_native: '3000' })]
  for (const [id, amount] of [['promise-a', '2000'], ['promise-b', '2500']]) {
    const result = resolve(input({ terms: { id, promised_amount_native: amount }, payments: [], cashRows: rows }))
    assert.equal(result.decision, 'unclear')
  }
  assert.equal(rows[0].remaining_credit_native, '3000')
})
for (const resource of ['payments', 'overpayments', 'prepayments']) {
  test(`incomplete ${resource} evidence defers and cannot assert Missed`, () => {
    const value = input(); value.observation.resources.find(row => row.resource === resource).complete = false
    value.qualifiedPayments = qualify({ promise: value.promise, observation: value.observation, payments: [payment()] })
    assert.equal(resolve(value).decision, 'defer')
  })
}
test('failed sync and false readiness are never absence of cash', () => {
  assert.equal(resolve(input({ observed: { status: 'failed' } })).decision, 'defer')
  assert.equal(resolve(input({ observed: { ready: false } })).decision, 'defer')
})
test('safe foreign valuation compares through one authoritative base currency', () => {
  const foreign = cash({ currency_code: 'USD', remaining_credit_native: '6000', xero_currency_rate: '2',
    remaining_credit_base: '3000.00000000', currency_conversion_status: 'converted' })
  const valuation = currencyValuation()
  assert.equal(resolve(input({ cashRows: [foreign], valuation })).decision, 'unclear')
  assert.equal(resolve(input({ cashRows: [{ ...foreign, remaining_credit_native: '4000', remaining_credit_base: '2000.00000000' }], valuation })).decision, 'missed')
})
test('foreign Promise target and cash use authoritative currency rates without currency mixing', () => {
  const value = input({ terms: { currency_code: 'EUR' }, payments: [payment({ currency_code: 'EUR' })],
    cashRows: [cash({ remaining_credit_native: '1500', remaining_credit_base: '1500' })],
    valuation: currencyValuation({ currency_code: 'EUR', xero_currency_rate: '2', currency_conversion_status: 'converted' }) })
  assert.equal(resolve(value).decision, 'unclear')
})
test('known same-currency coverage is sufficient despite irrelevant unavailable foreign FX', () => {
  const rows = [cash(), cash({ source_id: 'foreign', currency_code: 'USD', remaining_credit_base: null,
    currency_conversion_status: 'incomplete', currency_conversion_failure_reason: 'missing_rate' })]
  assert.equal(resolve(input({ cashRows: rows })).decision, 'unclear')
})
test('potentially material unvalued foreign cash defers rather than inventing Unclear or Missed', () => {
  const foreign = cash({ currency_code: 'USD', remaining_credit_base: null,
    currency_conversion_status: 'incomplete', currency_conversion_failure_reason: 'missing_rate' })
  const valuation = currencyValuation()
  for (const inputValuation of [null, valuation]) assert.equal(resolve(input({ cashRows: [foreign], valuation: inputValuation })).decision, 'defer')
})
test('forged or mismatched base values cannot establish a definitive negative result', () => {
  const foreign = cash({ currency_code: 'USD', remaining_credit_native: '6000', xero_currency_rate: '2',
    remaining_credit_base: '1', currency_conversion_status: 'converted' })
  const valuation = currencyValuation()
  assert.equal(resolve(input({ cashRows: [foreign], valuation })).decision, 'defer')
})
for (const overrides of [{ status: 'VOIDED' }, { status: 'DELETED' }, { status: 'PAID' },
  { provider_type: 'SPEND-OVERPAYMENT' }, { accounting_date: '2026-10-01' },
  { customer_source_id: 'other-customer' }, { remaining_credit_native: '0' }]) {
  test(`ineligible cash cannot veto Missed: ${JSON.stringify(overrides)}`, () => {
    assert.equal(resolve(input({ cashRows: [cash(overrides)] })).decision, 'missed')
  })
}
test('cash cross-owner/tenant/generation or malformed relevant records defers', () => {
  for (const overrides of [{ user_id: 'other' }, { tenant_id: 'other' }, { sync_run_id: 'other' },
    { remaining_credit_native: '-1' }, { accounting_date: 'invalid' }, { currency_code: 'GB' }]) {
    assert.equal(resolve(input({ cashRows: [cash(overrides)] })).decision, 'defer')
  }
})
test('duplicate cash source and missing returned cash records defer', () => {
  assert.equal(resolve(input({ cashRows: [cash(), cash()] })).decision, 'defer')
  const value = input({ cashRows: [cash()] }); value.cash = []
  assert.equal(resolve(value).decision, 'defer')
})
test('credit-only/paid/missing invoice state cannot manufacture Kept', () => {
  for (const extra of [{ invoice_status: 'PAID', current_outstanding: '0' }, { invoice: null }]) {
    const value = input({ payments: [] }); Object.assign(value, extra)
    assert.equal(resolve(value).decision, 'missed')
  }
})
test('missing required payment identity/currency context defers', () => {
  assert.equal(resolve(input({ payments: [payment({ currency_code: null })] })).decision, 'defer')
})
test('late payment cannot fulfil the deadline commitment', () => {
  const result = resolve(input({ payments: [payment({ amount_native: '4000', payment_date: '2026-10-01' })] }))
  assert.equal(result.decision, 'missed'); assert.equal(result.qualifying_paid_amount_native, '0')
})
for (const status of ['kept', 'missed', 'unclear', 'cancelled']) {
  test(`terminal ${status} never transitions, even with later sufficient payments or invalid observation`, () => {
    const value = input({ terms: { status, qualifying_paid_amount_native: '1000' },
      payments: [payment({ amount_native: '5000' })], observed: { timezone_iana: null, status: 'failed' } })
    const result = resolve(value)
    assert.equal(result.decision, 'defer'); assert.equal(result.reason_code, 'terminal_promise_unchanged')
    assert.equal(result.terminal, true); assert.equal(result.transition_required, false)
    assert.equal(result.qualifying_paid_amount_native, '1000'); assert.equal(result.evidence, null)
  })
}
test('missing timezone defers, with no wall-clock or UTC fallback', () => {
  assert.equal(resolve(input({ observed: { timezone_iana: null } })).decision, 'defer')
})
test('qualification is bound to Promise revision, generation, currency and changed terms', () => {
  for (const change of [{ promise_revision: 2 }, { generation_id: 'other' }, { promised_amount_native: '1' },
    { promised_date: '2026-10-01' }, { currency_code: 'USD' }]) {
    const value = input(); Object.assign(value.qualifiedPayments, change)
    assert.equal(resolve(value).decision, 'defer')
  }
})
test('foreign comparison cannot borrow another invoice, generation, owner or tenant valuation', () => {
  const foreign = cash({ currency_code: 'USD', remaining_credit_native: '6000', xero_currency_rate: '2',
    remaining_credit_base: '3000.00000000', currency_conversion_status: 'converted' })
  for (const change of [{ invoice_source_id: 'other' }, { sync_run_id: 'other' }, { user_id: 'other' }, { tenant_id: 'other' }]) {
    assert.equal(resolve(input({ cashRows: [foreign], valuation: currencyValuation(change) })).decision, 'defer')
  }
})
test('foreign cash is summed exactly rather than through floating-point totals', () => {
  const rows = ['a', 'b', 'c'].map(source_id => cash({ source_id, currency_code: 'USD', remaining_credit_native: '0.1',
    xero_currency_rate: '1', remaining_credit_base: '0.10000000', currency_conversion_status: 'converted' }))
  const result = resolve(input({ terms: { promised_amount_native: '0.3' }, payments: [], cashRows: rows, valuation: currencyValuation() }))
  assert.equal(result.decision, 'unclear')
  assert.equal(result.evidence.cash_comparison.foreign_amount_base, '0.3')
})
test('known foreign cash may prove sufficiency without allocating other unvalued cash', () => {
  const known = cash({ currency_code: 'USD', remaining_credit_native: '6000', xero_currency_rate: '2',
    remaining_credit_base: '3000.00000000', currency_conversion_status: 'converted' })
  const unknown = cash({ source_id: 'unknown', currency_code: 'EUR', remaining_credit_base: null,
    currency_conversion_status: 'incomplete', currency_conversion_failure_reason: 'missing_rate' })
  const result = resolve(input({ cashRows: [known, unknown], valuation: currencyValuation() }))
  assert.equal(result.decision, 'unclear')
  assert.equal(result.evidence.cash_comparison.unavailable_foreign_count, 1)
})
test('changing observation timestamps after qualification invalidates the handoff', () => {
  const value = input(); value.observation.resources[0].started_at = '2026-10-01T00:00:30Z'
  assert.equal(resolve(value).reason_code, 'observation_invalid')
})
test('incomplete pre-deadline payment observation defers and cannot resolve negatively', () => {
  const value = input({ observed: early }); value.observation.resources[0].complete = false
  const result = resolve(value)
  assert.equal(result.decision, 'defer')
  assert.equal(result.payment_evaluation_valid, false)
  assert.equal(result.qualifying_paid_amount_native, null)
})
test('cash uncertainty defers lifecycle but retains independently certified payment facts', () => {
  const value = input(); value.observation.resources[1].complete = false
  const result = resolve(value)
  assert.equal(result.decision, 'defer'); assert.equal(result.transition_required, false)
  assert.equal(result.payment_evaluation_valid, true)
  assert.equal(result.qualifying_paid_amount_native, '1000')
  assert.equal(result.remaining_unpaid_amount_native, '3000')
  assert.equal(result.source_sync_run_id, 'run-1')
})
test('qualified total tampering, duplicate or baseline contribution cannot produce Kept', () => {
  const value = input(); value.qualifiedPayments.qualifying_paid_amount_native = '4000'
  assert.equal(resolve(value).decision, 'defer')
  for (const id of ['old-payment', 'payment-1']) {
    const another = input(); another.qualifiedPayments.contributions.push({ source_id: id, amount_native: '3000', payment_date: '2026-09-28' })
    another.qualifiedPayments.qualifying_paid_amount_native = '4000'
    assert.equal(resolve(another).decision, 'defer')
  }
})
test('resolution is deterministic and does not mutate operational/evidence inputs', () => {
  const value = input({ cashRows: [cash()] }); const before = JSON.stringify(value)
  const first = resolve(value), second = resolve(value)
  assert.deepEqual(first, second); assert.equal(JSON.stringify(value), before)
  assert.equal(first.evidence.source_sync_run_id, 'run-1')
  assert.equal(first.evidence.cash_comparison.same_currency_amount_native, '3500')
  assert.equal('excluded' in first.evidence, false)
})
test('focused decision invariants across payment/cash/boundary combinations', () => {
  for (const paid of ['0', '1000', '4000', '5000']) for (const amount of ['0', '2000', '4000']) for (const before of [true, false]) {
    const result = resolve(input({ payments: [payment({ amount_native: paid })],
      cashRows: [cash({ remaining_credit_native: amount })], observed: before ? early : {} }))
    if (result.decision === 'kept') assert.ok(Number(paid) >= 4000)
    if (result.decision === 'missed') { assert.equal(before, false); assert.ok(Number(paid) + Number(amount) < 4000) }
    if (result.decision === 'unclear') { assert.equal(before, false); assert.ok(Number(paid) < 4000); assert.ok(Number(paid) + Number(amount) >= 4000) }
    if (before && Number(paid) < 4000) assert.equal(result.decision, 'retain_active')
  }
})
