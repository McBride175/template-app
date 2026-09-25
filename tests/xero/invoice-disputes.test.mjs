import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const {
  deriveInvoiceDispute,
  validateNewPartialDisputedAmount,
} = loadTypeScriptModule('lib/collections/invoice-disputes.ts')

function invoice(amountDue, overrides = {}) {
  return {
    user_id: 'user-1', tenant_id: 'tenant-1',
    source_id: 'invoice-1', source_system: 'xero', customer_source_id: 'customer-1',
    type: 'ACCREC', status: 'AUTHORISED', amount_due_native: amountDue,
    amount_due_base: amountDue, transaction_currency_code: 'GBP',
    organisation_base_currency_code: 'GBP', xero_currency_rate: null,
    ...overrides,
  }
}

function dispute(mode, recorded, overrides = {}) {
  return {
    id: 'dispute-1', user_id: 'user-1', tenant_id: 'tenant-1',
    source_system: 'xero', invoice_source_id: 'invoice-1',
    dispute_mode: mode, recorded_disputed_amount_native: recorded,
    amount_due_at_last_review_native: '10000', note: null,
    is_active: true, resolved_at: null,
    created_at: '2026-09-24T00:00:00Z', updated_at: '2026-09-24T00:00:00Z',
    ...overrides,
  }
}

test('full dispute follows both decreases and increases without overwriting the recorded amount', () => {
  const record = dispute('full', '10000')
  for (const [due, review] of [['10000', false], ['8000', true], ['12000', true]]) {
    const result = deriveInvoiceDispute(invoice(due), record)
    assert.equal(result.recordedDisputedAmountNative, '10000')
    assert.equal(result.effectiveDisputedAmountNative, due)
    assert.equal(result.collectibleAmountNative, '0')
    assert.equal(result.needsReview, review)
    assert.equal(result.isActive, true)
  }
})

test('partial dispute caps historical recorded amount and a deliberate review clears only the baseline', () => {
  const record = dispute('partial', '3000')
  const initial = deriveInvoiceDispute(invoice('10000'), record)
  assert.equal(initial.effectiveDisputedAmountNative, '3000')
  assert.equal(initial.collectibleAmountNative, '7000')
  assert.equal(initial.hasCollectibleBalance, true)

  const reduced = deriveInvoiceDispute(invoice('2000'), record)
  assert.equal(reduced.recordedDisputedAmountNative, '3000')
  assert.equal(reduced.effectiveDisputedAmountNative, '2000')
  assert.equal(reduced.collectibleAmountNative, '0')
  assert.equal(reduced.needsReview, true)

  const confirmed = deriveInvoiceDispute(invoice('2000'), {
    ...record, amount_due_at_last_review_native: '2000',
  })
  assert.equal(confirmed.recordedDisputedAmountNative, '3000')
  assert.equal(confirmed.needsReview, false)
  assert.throws(() => validateNewPartialDisputedAmount('3000', '2000'), /invalid_amount/)
})

test('resolution, reactivation, settlement and later reopening stay distinct', () => {
  const record = dispute('partial', '4000')
  const resolved = deriveInvoiceDispute(invoice('6000'), {
    ...record, is_active: false, resolved_at: '2026-09-25T00:00:00Z',
  })
  assert.equal(resolved.effectiveDisputedAmountNative, '0')
  assert.equal(resolved.collectibleAmountNative, '6000')
  assert.equal(resolved.isResolved, true)

  const reactivated = deriveInvoiceDispute(invoice('6000'), {
    ...record, amount_due_at_last_review_native: '6000',
  })
  assert.equal(reactivated.effectiveDisputedAmountNative, '4000')
  assert.equal(reactivated.needsReview, false)

  const settled = deriveInvoiceDispute(invoice('0', { status: 'PAID' }), record)
  assert.equal(settled.invoiceState, 'settled')
  assert.equal(settled.isOperationallySettled, true)
  assert.equal(settled.isResolved, false)
  assert.equal(settled.effectiveDisputedAmountNative, '0')
  assert.equal(settled.collectibleAmountNative, '0')

  const reopened = deriveInvoiceDispute(invoice('6000'), record)
  assert.equal(reopened.effectiveDisputedAmountNative, '4000')
  assert.equal(reopened.needsReview, true)
  const absent = deriveInvoiceDispute(null, record)
  assert.equal(absent.invoiceState, 'unavailable')
  assert.equal(absent.isOperationallySettled, false)
})

test('stable provider identity survives a new canonical row and cannot attach to a future invoice', () => {
  const record = dispute('full', '10000')
  const oldGeneration = invoice('10000', { id: 'generation-row-a' })
  const newGeneration = invoice('8000', { id: 'generation-row-b' })
  assert.equal(deriveInvoiceDispute(oldGeneration, record).collectibleAmountNative, '0')
  assert.equal(deriveInvoiceDispute(newGeneration, record).collectibleAmountNative, '0')
  assert.equal(deriveInvoiceDispute(invoice('1000', { source_id: 'future-invoice' }), null).collectibleAmountNative, '1000')
  assert.throws(() => deriveInvoiceDispute(invoice('1000', { source_id: 'future-invoice' }), record), /identity_mismatch/)
  assert.throws(() => deriveInvoiceDispute(invoice('1000', { tenant_id: 'other-tenant' }), record), /identity_mismatch/)
})

test('foreign-currency derived base amounts reconcile using the canonical Xero rate', () => {
  const result = deriveInvoiceDispute(invoice('10', {
    transaction_currency_code: 'USD', organisation_base_currency_code: 'GBP',
    xero_currency_rate: '3', amount_due_base: '3.33333333',
  }), dispute('partial', '4', { amount_due_at_last_review_native: '10' }))
  assert.equal(result.collectibleAmountBase, '2.00000000')
  assert.equal(result.effectiveDisputedAmountBase, '1.33333333')
  assert.equal(result.grossOpenAmountBase, '3.33333333')
})
