import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const {
  BASE_AMOUNT_DECIMAL_SCALE,
  BASE_AMOUNT_ROUNDING_MODE,
  convertCurrencyAmounts,
  normalizeCurrencyCode,
} = loadTypeScriptModule('lib/money/currency.ts')

function convert({ transactionCurrency, baseCurrency, rate, amount }) {
  return convertCurrencyAmounts({
    transactionCurrency,
    organisationBaseCurrency: baseCurrency,
    xeroCurrencyRate: rate,
    amounts: { amountDue: amount },
  })
}

test('base-currency invoices use identity conversion without inventing a rate', () => {
  const result = convert({
    transactionCurrency: 'GBP',
    baseCurrency: 'GBP',
    rate: null,
    amount: '100.00',
  })

  assert.equal(result.status, 'identity')
  assert.equal(result.failureReason, null)
  assert.equal(result.xeroCurrencyRate, null)
  assert.deepEqual(result.amounts.amountDue, { native: '100', base: '100' })
})

test('Xero foreign-per-base rate is divided, not multiplied', () => {
  const result = convert({
    transactionCurrency: 'EUR',
    baseCurrency: 'GBP',
    rate: '1.10',
    amount: '110.00',
  })

  assert.equal(result.status, 'converted')
  assert.equal(result.xeroCurrencyRate, '1.1')
  assert.equal(result.amounts.amountDue.base, '100.00000000')
  assert.notEqual(result.amounts.amountDue.base, '121.00000000')
})

test('USD organisations use USD identity conversion with no GBP assumption', () => {
  const result = convert({
    transactionCurrency: 'USD',
    baseCurrency: 'USD',
    rate: undefined,
    amount: 250,
  })

  assert.equal(result.organisationBaseCurrencyCode, 'USD')
  assert.deepEqual(result.amounts.amountDue, { native: '250', base: '250' })
})

test('AUD organisations use AUD identity conversion with no GBP assumption', () => {
  const result = convert({
    transactionCurrency: 'AUD',
    baseCurrency: 'AUD',
    rate: undefined,
    amount: 250,
  })

  assert.equal(result.organisationBaseCurrencyCode, 'AUD')
  assert.deepEqual(result.amounts.amountDue, { native: '250', base: '250' })
})

test('a foreign invoice with a missing rate retains native money and is incomplete', () => {
  const result = convert({
    transactionCurrency: 'USD',
    baseCurrency: 'GBP',
    rate: null,
    amount: '125.00',
  })

  assert.equal(result.status, 'incomplete')
  assert.equal(result.failureReason, 'missing_rate')
  assert.equal(result.amounts.amountDue.native, '125')
  assert.equal(result.amounts.amountDue.base, null)
})

for (const rate of [0, '-1.25', Number.NaN, Number.POSITIVE_INFINITY]) {
  test(`an unusable foreign rate (${String(rate)}) never converts or falls back to one`, () => {
    const result = convert({
      transactionCurrency: 'USD',
      baseCurrency: 'GBP',
      rate,
      amount: 125,
    })

    assert.equal(result.status, 'incomplete')
    assert.equal(result.failureReason, 'invalid_rate')
    assert.equal(result.xeroCurrencyRate, null)
    assert.equal(result.amounts.amountDue.base, null)
  })
}

test('a foreign rate of exactly one remains mathematically valid', () => {
  const result = convert({
    transactionCurrency: 'USD',
    baseCurrency: 'GBP',
    rate: 1,
    amount: 125,
  })

  assert.equal(result.status, 'converted')
  assert.equal(result.xeroCurrencyRate, '1')
  assert.equal(result.amounts.amountDue.base, '125.00000000')
})

test('currency codes are trimmed and normalised without a currency whitelist', () => {
  const result = convert({
    transactionCurrency: ' eur ',
    baseCurrency: ' gbp ',
    rate: 1.1,
    amount: 110,
  })

  assert.equal(normalizeCurrencyCode(' nzd '), 'NZD')
  assert.equal(result.transactionCurrencyCode, 'EUR')
  assert.equal(result.organisationBaseCurrencyCode, 'GBP')
  assert.equal(result.status, 'converted')
})

test('clearly invalid transaction currency produces explicit incomplete state', () => {
  const result = convert({
    transactionCurrency: 'GB',
    baseCurrency: 'GBP',
    rate: 1,
    amount: 100,
  })

  assert.equal(result.transactionCurrencyCode, null)
  assert.equal(result.status, 'incomplete')
  assert.equal(result.failureReason, 'invalid_transaction_currency')
  assert.equal(result.amounts.amountDue.native, '100')
  assert.equal(result.amounts.amountDue.base, null)
})

test('missing and invalid base currencies remain distinguishable', () => {
  const missing = convert({
    transactionCurrency: 'EUR',
    baseCurrency: null,
    rate: 1.1,
    amount: 110,
  })
  const invalid = convert({
    transactionCurrency: 'EUR',
    baseCurrency: 'UK',
    rate: 1.1,
    amount: 110,
  })

  assert.equal(missing.failureReason, 'missing_base_currency')
  assert.equal(invalid.failureReason, 'invalid_base_currency')
})

test('derived base amounts use deterministic eight-place half-away-from-zero rounding', () => {
  const positive = convert({
    transactionCurrency: 'EUR',
    baseCurrency: 'GBP',
    rate: 3,
    amount: 2,
  })
  const negative = convert({
    transactionCurrency: 'EUR',
    baseCurrency: 'GBP',
    rate: 3,
    amount: -2,
  })

  assert.equal(BASE_AMOUNT_DECIMAL_SCALE, 8)
  assert.equal(BASE_AMOUNT_ROUNDING_MODE, 'half_away_from_zero')
  assert.equal(positive.amounts.amountDue.base, '0.66666667')
  assert.equal(negative.amounts.amountDue.base, '-0.66666667')
})
