import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const { deriveInvoiceActionability: derive } = loadTypeScriptModule('lib/collections/invoice-actionability.ts')
const { deriveInvoiceDispute } = loadTypeScriptModule('lib/collections/invoice-disputes.ts')
const { sumDecimalValues, compareDecimalValues } = loadTypeScriptModule('lib/money/currency.ts')
const invoice = (due = '10000', overrides = {}) => ({
  user_id: 'user-1', tenant_id: 'tenant-1', source_system: 'xero', source_id: 'invoice-1',
  customer_source_id: 'customer-1', type: 'ACCREC', status: 'AUTHORISED',
  amount_due_native: due, amount_due_base: due, transaction_currency_code: 'GBP',
  organisation_base_currency_code: 'GBP', xero_currency_rate: null, ...overrides,
})
const promise = (overrides = {}) => ({
  id: 'promise-1', user_id: 'user-1', tenant_id: 'tenant-1', source_system: 'xero',
  invoice_source_id: 'invoice-1', customer_source_id: 'customer-1', currency_code: 'GBP',
  promised_amount_native: '4000', qualifying_paid_amount_native: '0', status: 'active', ...overrides,
})
const dispute = (amount = '8000', overrides = {}) => ({
  id: 'dispute-1', user_id: 'user-1', tenant_id: 'tenant-1', source_system: 'xero',
  invoice_source_id: 'invoice-1', dispute_mode: 'partial', recorded_disputed_amount_native: amount,
  amount_due_at_last_review_native: '10000', note: null, is_active: true, resolved_at: null,
  created_at: '2026-09-25T00:00:00Z', updated_at: '2026-09-25T00:00:00Z', revision: 1, ...overrides,
})
function reconciles(result) {
  assert.equal(compareDecimalValues(sumDecimalValues([
    result.effectiveDisputedAmountBase, result.activePromisedCoverageAmountBase, result.toChaseAmountBase,
  ]), result.grossOpenAmountBase), 0)
}

for (const [label, due, disputed, terms, remaining, covered, chase] of [
  ['A: simple fixed promise', '10000', null, {}, '4000', '4000', '6000'],
  ['B: balance grows without promise growth', '12000', null, {}, '4000', '4000', '8000'],
  ['C: payment must not be subtracted twice', '9000', null, { qualifying_paid_amount_native: '1000' }, '3000', '3000', '6000'],
  ['D: disputed pounds cannot also be promised', '10000', '8000', {}, '4000', '2000', '0'],
  ['F: balance below commitment', '2000', null, {}, '4000', '2000', '0'],
]) {
  test(label, () => {
    const result = derive(invoice(due), disputed ? dispute(disputed) : null, promise(terms))
    assert.equal(result.remainingPromiseCommitmentNative, remaining)
    assert.equal(result.activePromisedCoverageAmountNative, covered)
    assert.equal(result.toChaseAmountNative, chase)
    assert.equal(result.recordedPromisedAmountNative, '4000')
    reconciles(result)
  })
}

test('E: dispute resolution restores active coverage up to the same fixed commitment', () => {
  const record = Object.freeze(promise())
  assert.equal(derive(invoice(), dispute(), record).activePromisedCoverageAmountNative, '2000')
  for (const resolved of [null, dispute('8000', { is_active: false, resolved_at: '2026-09-26T00:00:00Z' })]) {
    const result = derive(invoice(), resolved, record)
    assert.equal(result.activePromisedCoverageAmountNative, '4000')
    assert.equal(result.toChaseAmountNative, '6000')
  }
})

for (const status of ['kept', 'missed', 'unclear', 'cancelled']) {
  test(`G: terminal ${status} leaves all current undisputed debt to chase`, () => {
    const result = derive(invoice('9000'), null, promise({ status, qualifying_paid_amount_native: '1000' }))
    assert.equal(result.activePromisedCoverageAmountNative, '0')
    assert.equal(result.toChaseAmountNative, '9000')
    reconciles(result)
  })
}

test('no promise exactly preserves the existing dispute monetary derivation', () => {
  for (const record of [null, dispute(), dispute('4000', { dispute_mode: 'full' })]) {
    const inv = invoice()
    const result = derive(inv, record, null)
    const existing = deriveInvoiceDispute(inv, record)
    assert.deepEqual(result.dispute, existing)
    assert.equal(result.toChaseAmountNative, existing.collectibleAmountNative)
    assert.equal(result.toChaseAmountBase, existing.collectibleAmountBase)
    reconciles(result)
  }
})

test('full disputes retain dynamic balance and needsReview; partial disputes remain fixed/capped', () => {
  const full = dispute('10000', { dispute_mode: 'full' })
  for (const due of ['8000', '12000']) {
    const result = derive(invoice(due), full, promise())
    assert.equal(result.effectiveDisputedAmountNative, due)
    assert.equal(result.activePromisedCoverageAmountNative, '0')
    assert.equal(result.dispute.needsReview, true)
  }
  assert.equal(derive(invoice('2000'), dispute('3000'), promise()).effectiveDisputedAmountNative, '2000')
})

test('non-payment balance changes cap coverage without changing certified paid amount or outcome', () => {
  for (const due of ['1000', '0']) {
    const result = derive(invoice(due), null, promise())
    assert.equal(result.activePromisedCoverageAmountNative, due)
    assert.equal(result.toChaseAmountNative, '0')
    assert.equal(result.qualifyingPaidAmountNative, '0')
    assert.equal(result.promise.status, 'active')
  }
})

test('exact fractional debt is reconciled without binary money arithmetic', () => {
  const result = derive(invoice('0.3'), dispute('0.1'), promise({
    promised_amount_native: '0.2', qualifying_paid_amount_native: '0.1',
  }))
  assert.equal(result.activePromisedCoverageAmountNative, '0.1')
  assert.equal(result.toChaseAmountNative, '0.1')
  reconciles(result)
})

test('a full-current-balance commitment stays fixed when later accounting grows', () => {
  const record = promise({ promised_amount_native: '10000' })
  assert.equal(derive(invoice('10000'), null, record).toChaseAmountNative, '0')
  const grown = derive(invoice('12000'), null, record)
  assert.equal(grown.activePromisedCoverageAmountNative, '10000')
  assert.equal(grown.toChaseAmountNative, '2000')
})

test('satisfied Active commitment creates no coverage and does not resolve itself', () => {
  for (const paid of ['4000', '5000']) {
    const result = derive(invoice('6000'), null, promise({ qualifying_paid_amount_native: paid }))
    assert.equal(result.activePromisedCoverageAmountNative, '0')
    assert.equal(result.toChaseAmountNative, '6000')
    assert.equal(result.promise.status, 'active')
    reconciles(result)
  }
})

test('coverage is independent of deadline and unapplied-cash properties on operational input', () => {
  const result = derive(invoice(), null, promise({ promised_date: '2000-01-01', unapplied_cash: '100000' }))
  assert.equal(result.activePromisedCoverageAmountNative, '4000')
  assert.equal(result.toChaseAmountNative, '6000')
})

test('decimal boundary combinations conserve debt and never exceed either coverage limit', () => {
  for (const due of ['0.01', '0.3', '10000']) {
    for (const disputed of ['0.01', '0.1', '8000']) {
      for (const paid of ['0', '0.02', '4001']) {
        const result = derive(invoice(due), dispute(disputed), promise({ qualifying_paid_amount_native: paid }))
        assert.equal(compareDecimalValues(sumDecimalValues([
          result.effectiveDisputedAmountNative, result.activePromisedCoverageAmountNative, result.toChaseAmountNative,
        ]), due), 0)
        assert.notEqual(compareDecimalValues(result.activePromisedCoverageAmountNative, result.remainingPromiseCommitmentNative), 1)
        assert.notEqual(compareDecimalValues(result.activePromisedCoverageAmountNative, result.postDisputeAmountNative), 1)
        assert.notEqual(compareDecimalValues(result.toChaseAmountNative, '0'), -1)
        reconciles(result)
      }
    }
  }
})

test('foreign partial dispute and payment-adjusted promise reconcile residual base components', () => {
  const result = derive(invoice('10', {
    transaction_currency_code: 'USD', amount_due_base: '3.33333333', xero_currency_rate: '3',
  }), dispute('4'), promise({ currency_code: 'USD', promised_amount_native: '3', qualifying_paid_amount_native: '1' }))
  assert.equal(result.dispute.effectiveDisputedAmountBase, '1.33333333')
  assert.equal(result.toChaseAmountNative, '4')
  assert.equal(result.toChaseAmountBase, '1.33333333')
  assert.equal(result.activePromisedCoverageAmountBase, '0.66666667')
  reconciles(result)
})

test('rounding-sensitive split derives promise base as the residual, not independently rounded', () => {
  const result = derive(invoice('2', {
    transaction_currency_code: 'USD', amount_due_base: '0.66666667', xero_currency_rate: '3',
  }), dispute('0.5'), promise({ currency_code: 'USD', promised_amount_native: '0.5' }))
  assert.equal(result.effectiveDisputedAmountBase, '0.16666667')
  assert.equal(result.activePromisedCoverageAmountBase, '0.16666667')
  assert.equal(result.toChaseAmountBase, '0.33333333')
  reconciles(result)
})

test('missing FX never guesses a partial base split or turns unavailable values into zero', () => {
  for (const base of [null, '5']) {
    const result = derive(invoice('10', { transaction_currency_code: 'USD', amount_due_base: base }), null,
      promise({ currency_code: 'USD', promised_amount_native: '4' }))
    assert.equal(result.activePromisedCoverageAmountNative, '4')
    assert.equal(result.toChaseAmountNative, '6')
    assert.equal(result.activePromisedCoverageAmountBase, null)
    assert.equal(result.toChaseAmountBase, null)
  }
})

test('inconsistent canonical gross valuation cannot be used for a partial promise split', () => {
  for (const overrides of [
    { transaction_currency_code: 'USD', xero_currency_rate: '3', amount_due_base: '99' },
    { amount_due_base: '99' },
  ]) {
    const inv = invoice('10', overrides)
    const result = derive(inv, null, promise({ currency_code: inv.transaction_currency_code, promised_amount_native: '4' }))
    assert.equal(result.toChaseAmountBase, null)
    assert.equal(result.activePromisedCoverageAmountBase, null)
  }
})

test('no split preserves canonical base and full coverage uses its entire known remainder', () => {
  const inv = invoice('10', { transaction_currency_code: 'USD', amount_due_base: '5' })
  assert.equal(derive(inv, null, null).toChaseAmountBase, '5')
  const result = derive(inv, null, promise({ currency_code: 'USD', promised_amount_native: '10' }))
  assert.equal(result.activePromisedCoverageAmountBase, '5')
  assert.equal(result.toChaseAmountBase, '0')
  reconciles(result)
})

test('missing invoice leaves current monetary values unavailable and retains commitment terms', () => {
  const result = derive(null, null, promise())
  assert.equal(result.invoiceState, 'unavailable')
  for (const key of ['currentAmountDueNative', 'effectiveDisputedAmountNative', 'postDisputeAmountNative',
    'activePromisedCoverageAmountNative', 'toChaseAmountNative', 'toChaseAmountBase']) assert.equal(result[key], null)
  assert.equal(result.remainingPromiseCommitmentNative, '4000')
})

test('known settled/ineligible invoices preserve accounting amount but create no actionability', () => {
  for (const overrides of [{ status: 'PAID' }, { status: 'VOIDED' }, { type: 'ACCPAY' }]) {
    const result = derive(invoice('10', overrides), null, promise())
    assert.equal(result.invoiceState, 'settled')
    assert.equal(result.currentAmountDueNative, '10')
    assert.equal(result.activePromisedCoverageAmountNative, '0')
    assert.equal(result.toChaseAmountNative, '0')
    assert.equal(result.promise.status, 'active')
  }
})

test('invalid balances and missing denomination remain unavailable, including settled rows', () => {
  for (const inv of [invoice('-1'), invoice('bad'), invoice(null), invoice('10', { transaction_currency_code: null }),
    invoice('bad', { status: 'PAID' })]) {
    const result = derive(inv, null, null)
    assert.equal(result.invoiceState, 'invalid')
    assert.equal(result.toChaseAmountNative, null)
    assert.equal(result.toChaseAmountBase, null)
  }
})

test('identity boundaries reject cross-owner/tenant/provider/invoice/customer commitments', () => {
  for (const overrides of [{ user_id: 'other' }, { tenant_id: 'other' }, { source_system: 'other' },
    { invoice_source_id: 'other' }, { customer_source_id: 'other' }]) {
    assert.throws(() => derive(invoice(), null, promise(overrides)), /identity_mismatch/)
  }
  assert.throws(() => derive(null, dispute(), promise({ tenant_id: 'other' })), /identity_mismatch/)
  assert.throws(() => derive(invoice(), dispute('10', { user_id: 'other' }), promise()), /identity_mismatch/)
})

test('currency mismatch fails closed even for a terminal commitment', () => {
  for (const status of ['active', 'missed']) assert.throws(
    () => derive(invoice(), null, promise({ currency_code: 'USD', status })), /currency_mismatch/)
})
