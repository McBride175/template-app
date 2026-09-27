import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const { deriveInvoicePromise } = loadTypeScriptModule('lib/collections/invoice-promises.ts')
const promise = overrides => ({
  id: 'promise-1', user_id: 'user-1', tenant_id: 'tenant-1', source_system: 'xero',
  invoice_source_id: 'invoice-1', customer_source_id: 'customer-1', currency_code: 'GBP',
  promised_amount_native: '4000', qualifying_paid_amount_native: '0', status: 'active',
  ...overrides,
})

test('absence is explicit and does not invent a commitment', () => {
  assert.deepEqual(deriveInvoicePromise(null, '10000'), {
    status: null, isActive: false, recordedPromisedAmountNative: null,
    qualifyingPaidAmountNative: null, remainingPromiseCommitmentNative: null,
    activePromisedCoverageAmountNative: '0',
  })
})

test('fixed commitment remains unchanged across balance growth and caps to smaller debt', () => {
  const record = Object.freeze(promise())
  for (const [eligible, expected] of [['10000', '4000'], ['12000', '4000'], ['2000', '2000'], ['0', '0']]) {
    const result = deriveInvoicePromise(record, eligible)
    assert.equal(result.recordedPromisedAmountNative, '4000')
    assert.equal(result.remainingPromiseCommitmentNative, '4000')
    assert.equal(result.activePromisedCoverageAmountNative, expected)
  }
})

for (const [paid, remaining] of [['1000', '3000'], ['4000', '0'], ['5000', '0']]) {
  test(`certified paid total ${paid} reduces commitment to ${remaining} without resolving it`, () => {
    const result = deriveInvoicePromise(promise({ qualifying_paid_amount_native: paid }), '9000')
    assert.equal(result.remainingPromiseCommitmentNative, remaining)
    assert.equal(result.activePromisedCoverageAmountNative, remaining)
    assert.equal(result.status, 'active')
  })
}

for (const status of ['kept', 'missed', 'unclear', 'cancelled']) {
  test(`${status} preserves terms and certified payment but supplies zero coverage`, () => {
    const result = deriveInvoicePromise(promise({ status, qualifying_paid_amount_native: '1000' }), '9000')
    assert.equal(result.recordedPromisedAmountNative, '4000')
    assert.equal(result.qualifyingPaidAmountNative, '1000')
    assert.equal(result.remainingPromiseCommitmentNative, '3000')
    assert.equal(result.activePromisedCoverageAmountNative, '0')
    assert.equal(result.isActive, false)
  })
}

test('past promised date and unrelated evidence cannot expire or alter active coverage', () => {
  const result = deriveInvoicePromise(promise({ promised_date: '2000-01-01', unapplied_cash: '999999' }), '10000')
  assert.equal(result.activePromisedCoverageAmountNative, '4000')
  assert.equal(result.status, 'active')
})

test('decimal fractions and amounts beyond binary number precision remain exact', () => {
  const result = deriveInvoicePromise(promise({
    promised_amount_native: '12345678901234567890.123456789',
    qualifying_paid_amount_native: '0.023456788',
  }), '12345678901234567899')
  assert.equal(result.remainingPromiseCommitmentNative, '12345678901234567890.100000001')
  assert.equal(result.activePromisedCoverageAmountNative, '12345678901234567890.100000001')
})

test('unknown eligible debt is unavailable rather than zero active coverage', () => {
  assert.equal(deriveInvoicePromise(promise(), null).activePromisedCoverageAmountNative, null)
  assert.equal(deriveInvoicePromise(promise({ status: 'missed' }), null).activePromisedCoverageAmountNative, '0')
})

for (const [label, terms, eligible] of [
  ['negative commitment', { promised_amount_native: '-1' }, '10'],
  ['zero commitment', { promised_amount_native: '0' }, '10'],
  ['negative paid', { qualifying_paid_amount_native: '-1' }, '10'],
  ['malformed paid', { qualifying_paid_amount_native: 'NaN' }, '10'],
  ['missing paid', { qualifying_paid_amount_native: null }, '10'],
  ['negative eligible debt', {}, '-1'],
  ['malformed eligible debt', {}, 'bad'],
]) {
  test(`${label} fails safely`, () => assert.throws(
    () => deriveInvoicePromise(promise(terms), eligible), /invalid_amount/))
}

test('unknown status and invalid commitment currency fail closed', () => {
  assert.throws(() => deriveInvoicePromise(promise({ status: 'expired' }), '10'), /invalid_status/)
  assert.throws(() => deriveInvoicePromise(promise({ currency_code: 'GB' }), '10'), /currency_mismatch/)
})
