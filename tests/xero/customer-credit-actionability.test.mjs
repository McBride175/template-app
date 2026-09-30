import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const { deriveCustomerCreditActionability: derive } = loadTypeScriptModule('lib/collections/customer-credit-actionability.ts')
const scope = { syncRunId: 'run-1', userId: 'owner-1', tenantId: 'tenant-1', sourceSystem: 'xero', customerSourceId: 'customer-1' }
const certificate = { sync_run_id: scope.syncRunId, user_id: scope.userId, tenant_id: scope.tenantId,
  source_system: scope.sourceSystem, contract_version: 'customer_credit_v1', invoice_money_contract_version: 'invoice_exact_v1',
  readiness_state: 'ready', reason_code: 'stable_observation', consistency_result: 'matched' }
const type = { overpayment: 'RECEIVE-OVERPAYMENT', prepayment: 'RECEIVE-PREPAYMENT', credit_note: 'ACCRECCREDIT' }
function row(kind, residual, overrides = {}) {
  return { sync_run_id: scope.syncRunId, user_id: scope.userId, tenant_id: scope.tenantId,
    source_system: scope.sourceSystem, customer_source_id: scope.customerSourceId,
    source_kind: kind, source_id: `${kind}-1`, provider_type: type[kind],
    status: 'AUTHORISED', residual_state: residual === '0' ? 'zero' : 'qualifying',
    remaining_credit_native: residual, currency_code: 'GBP', organisation_base_currency_code: 'GBP', xero_currency_rate: '1', ...overrides }
}
function calculate(rows = [], overrides = {}) {
  return derive({ scope, certificate, organisationBaseCurrency: 'GBP', overdueInvoiceToChase: '1000',
    positiveOverdueInvoiceCurrencies: ['GBP'], creditRows: rows, ...overrides })
}

test('each authoritative source contributes its exact current residual once', () => {
  for (const kind of Object.keys(type)) {
    const result = calculate([row(kind, '300')])
    assert.equal(result.state, 'ready')
    assert.equal(result.availableCustomerCredit, '300')
    assert.equal(result.customerOverdueToChase, '700')
    assert.equal(result.sourceBreakdown[kind], '300')
  }
  const all = calculate([row('overpayment', '100'), row('prepayment', '200'), row('credit_note', '300')])
  assert.equal(all.availableCustomerCredit, '600')
  assert.equal(all.creditApplied, '600')
  assert.equal(all.customerOverdueToChase, '400')
  assert.deepEqual(all.sourceBreakdown, { overpayment: '100', prepayment: '200', credit_note: '300' })
})

test('ready observed zero, consumed residuals, and clamp remain distinct from unavailable', () => {
  const zero = calculate([row('overpayment', '0'), row('credit_note', '0', { status: 'PAID' })])
  assert.equal(zero.state, 'ready')
  assert.equal(zero.availableCustomerCredit, '0')
  assert.equal(zero.customerOverdueToChase, '1000')
  const clamped = calculate([row('credit_note', '500')], { overdueInvoiceToChase: '200' })
  assert.deepEqual([clamped.creditApplied, clamped.customerOverdueToChase, clamped.excessAvailableCredit], ['200', '0', '300'])
  for (const invalidCertificate of [null, { ...certificate, readiness_state: 'unavailable', reason_code: 'credit_state_changed' },
    { ...certificate, sync_run_id: 'old-run' }]) {
    const result = calculate([row('credit_note', '500')], { certificate: invalidCertificate })
    assert.equal(result.state, 'unavailable')
    assert.equal(result.availableCustomerCredit, null)
    assert.equal(result.creditApplied, '0')
    assert.equal(result.customerOverdueToChase, '1000')
  }
})

test('currency contract fails closed per customer, without disqualifying foreign future debt', () => {
  assert.equal(calculate([row('credit_note', '300')]).state, 'ready')
  assert.equal(calculate([row('credit_note', '300', { currency_code: 'USD' })]).state, 'unsupported_currency')
  assert.equal(calculate([row('credit_note', '300')], { positiveOverdueInvoiceCurrencies: ['USD'] }).state, 'unsupported_currency')
  assert.equal(calculate([row('credit_note', '300')], { positiveOverdueInvoiceCurrencies: ['GBP'], futureInvoiceCurrencies: ['USD'] }).state, 'ready')
  assert.equal(calculate([row('credit_note', '300')], { organisationBaseCurrency: null }).state, 'unsupported_currency')
  assert.equal(calculate([row('credit_note', '300', { organisation_base_currency_code: 'USD' })]).state, 'unsupported_currency')
  assert.equal(calculate([row('credit_note', '300', { xero_currency_rate: '1.2' })]).state, 'unsupported_currency')
  const foreign = calculate([row('overpayment', '100'), row('credit_note', '300', { currency_code: 'USD' })])
  assert.equal(foreign.availableCustomerCredit, null)
  assert.equal(foreign.creditApplied, '0')
})

test('invalid scope, duplicate identities, contradictory lifecycle, and mismatched types withhold all credit', () => {
  for (const rows of [
    [row('credit_note', '300'), row('credit_note', '300')],
    [row('credit_note', '300', { customer_source_id: 'other' })],
    [row('credit_note', '300', { status: 'PAID', residual_state: 'invalid' })],
    [row('credit_note', '300', { provider_type: 'ACCPAYCREDIT' })],
  ]) assert.equal(calculate(rows).state, 'unavailable')
})

test('decimal subtraction and comparison never round through binary numbers', () => {
  const result = calculate([row('overpayment', '9007199254740993.000000000000000001'),
    row('prepayment', '0.000000000000000002')], { overdueInvoiceToChase: '9007199254740993.000000000000000004' })
  assert.equal(result.availableCustomerCredit, '9007199254740993.000000000000000003')
  assert.equal(result.customerOverdueToChase, '0.000000000000000001')
  assert.equal(result.excessAvailableCredit, '0')
})
