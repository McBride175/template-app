import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const { deriveCollectionsCurrencyContext } = loadTypeScriptModule(
  'lib/collections/currency-context.ts'
)
const { resolveCollectionsCurrencyAccess } = loadTypeScriptModule(
  'lib/billing/collections-access.ts'
)

function invoice({
  currency = 'GBP',
  amountDue = '100',
  status = 'AUTHORISED',
  type = 'ACCREC',
  customerSourceId = 'customer-1',
} = {}) {
  return {
    type,
    status,
    customer_source_id: customerSourceId,
    transaction_currency_code: currency,
    amount_due_native: amountDue,
  }
}

function entitlement({ isPaid = false, paidPlan = null, hasActionsAccess = true } = {}) {
  return {
    plan: isPaid ? 'paid' : 'free',
    isPaid,
    paidPlan,
    tenantId: 'tenant-1',
    usageDaysConsumed: isPaid ? 0 : 1,
    usageDaysRemaining: isPaid ? null : 4,
    freeUsageDaysLimit: 5,
    hasActionsAccess,
    usageDate: '2026-09-12',
    usageDateConsumed: true,
  }
}

test('one open GBP currency is single-currency even with historical USD invoices', () => {
  const context = deriveCollectionsCurrencyContext([
    invoice({ currency: 'GBP' }),
    invoice({ currency: 'USD', status: 'PAID', amountDue: '0' }),
  ])

  assert.deepEqual(context, {
    mode: 'single_currency',
    invoicedCurrencies: ['GBP'],
    relevantInvoiceCount: 1,
  })
})

test('open GBP and USD receivables are multi-currency', () => {
  const context = deriveCollectionsCurrencyContext([
    invoice({ currency: 'GBP', customerSourceId: 'customer-gbp' }),
    invoice({ currency: ' usd ', customerSourceId: 'customer-usd' }),
  ])

  assert.deepEqual(context.invoicedCurrencies, ['GBP', 'USD'])
  assert.equal(context.mode, 'multi_currency')
})

test('paid historical foreign invoices do not trigger multi-currency access', () => {
  const context = deriveCollectionsCurrencyContext([
    invoice({ currency: 'GBP' }),
    invoice({ currency: 'USD', status: 'PAID', amountDue: '0' }),
    invoice({ currency: 'EUR', status: 'VOIDED', amountDue: '0' }),
  ])

  assert.equal(context.mode, 'single_currency')
  assert.deepEqual(context.invoicedCurrencies, ['GBP'])
})

test('Xero multi-currency capability does not affect a GBP-only open portfolio', () => {
  const context = deriveCollectionsCurrencyContext([
    { ...invoice({ currency: 'GBP' }), use_multicurrency: true },
  ])

  assert.equal(context.mode, 'single_currency')
})

test('two open currencies for the same customer are multi-currency', () => {
  const context = deriveCollectionsCurrencyContext([
    invoice({ currency: 'GBP', customerSourceId: 'customer-mixed' }),
    invoice({ currency: 'EUR', customerSourceId: 'customer-mixed' }),
  ])

  assert.equal(context.mode, 'multi_currency')
})

test('foreign invoices with no positive amount due are outside the access population', () => {
  const context = deriveCollectionsCurrencyContext([
    invoice({ currency: 'GBP', amountDue: '500' }),
    invoice({ currency: 'USD', amountDue: '0' }),
    invoice({ currency: 'EUR', amountDue: '-10' }),
  ])

  assert.equal(context.mode, 'single_currency')
  assert.deepEqual(context.invoicedCurrencies, ['GBP'])
})

test('free access includes the complete single- and multi-currency product on days one and five', () => {
  const singleCurrency = deriveCollectionsCurrencyContext([invoice({ currency: 'GBP' })])
  const multiCurrency = deriveCollectionsCurrencyContext([
    invoice({ currency: 'GBP' }),
    invoice({ currency: 'USD' }),
  ])

  for (const usageDaysConsumed of [1, 5]) {
    const free = {
      ...entitlement(),
      usageDaysConsumed,
      usageDaysRemaining: 5 - usageDaysConsumed,
    }
    assert.equal(
      resolveCollectionsCurrencyAccess({ entitlement: free, currencyContext: singleCurrency })
        .allowed,
      true
    )
    assert.equal(
      resolveCollectionsCurrencyAccess({ entitlement: free, currencyContext: multiCurrency })
        .allowed,
      true
    )
  }
})

test('Basic allows single-currency and requires Pro for multi-currency', () => {
  const basic = entitlement({ isPaid: true, paidPlan: 'basic' })
  const singleCurrency = deriveCollectionsCurrencyContext([invoice({ currency: 'GBP' })])
  const multiCurrency = deriveCollectionsCurrencyContext([
    invoice({ currency: 'GBP' }),
    invoice({ currency: 'USD' }),
  ])

  assert.deepEqual(
    resolveCollectionsCurrencyAccess({ entitlement: basic, currencyContext: singleCurrency }),
    { allowed: true, requiresPro: false, reason: 'allowed' }
  )
  assert.deepEqual(
    resolveCollectionsCurrencyAccess({ entitlement: basic, currencyContext: multiCurrency }),
    {
      allowed: false,
      requiresPro: true,
      reason: 'multi_currency_requires_pro',
    }
  )
})

test('Pro allows both single- and multi-currency collections', () => {
  const pro = entitlement({ isPaid: true, paidPlan: 'pro' })

  for (const currencies of [['GBP'], ['GBP', 'USD']]) {
    const currencyContext = deriveCollectionsCurrencyContext(
      currencies.map((currency) => invoice({ currency }))
    )
    assert.equal(
      resolveCollectionsCurrencyAccess({ entitlement: pro, currencyContext }).allowed,
      true
    )
  }
})

test('Basic access follows current receivables as currencies appear and settle', () => {
  const basic = entitlement({ isPaid: true, paidPlan: 'basic' })
  const yesterday = deriveCollectionsCurrencyContext([invoice({ currency: 'GBP' })])
  const today = deriveCollectionsCurrencyContext([
    invoice({ currency: 'GBP' }),
    invoice({ currency: 'USD' }),
  ])
  const settled = deriveCollectionsCurrencyContext([
    invoice({ currency: 'GBP' }),
    invoice({ currency: 'USD', status: 'PAID', amountDue: '0' }),
  ])

  assert.equal(resolveCollectionsCurrencyAccess({ entitlement: basic, currencyContext: yesterday }).allowed, true)
  assert.equal(resolveCollectionsCurrencyAccess({ entitlement: basic, currencyContext: today }).allowed, false)
  assert.equal(resolveCollectionsCurrencyAccess({ entitlement: basic, currencyContext: settled }).allowed, true)
})

test('an effective downgrade from Pro to Basic gates a current multi-currency portfolio', () => {
  const currencyContext = deriveCollectionsCurrencyContext([
    invoice({ currency: 'GBP' }),
    invoice({ currency: 'USD' }),
  ])

  assert.equal(
    resolveCollectionsCurrencyAccess({
      entitlement: entitlement({ isPaid: true, paidPlan: 'pro' }),
      currencyContext,
    }).allowed,
    true
  )
  assert.equal(
    resolveCollectionsCurrencyAccess({
      entitlement: entitlement({ isPaid: true, paidPlan: 'basic' }),
      currencyContext,
    }).allowed,
    false
  )
})
