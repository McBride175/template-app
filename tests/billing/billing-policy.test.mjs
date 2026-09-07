import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const POLICY_PATH = new URL('../../lib/billing/policy.ts', import.meta.url)
const {
  decideFreeUsage,
  getConfiguredPaidPriceIds,
  getUtcUsageDate,
  isSubscriptionPaid,
} = loadTypeScriptModule(POLICY_PATH)

const paidPriceIds = new Set(['price_basic', 'price_pro'])
const futurePeriodEnd = '2026-10-01T00:00:00.000Z'
const now = new Date('2026-09-06T12:00:00.000Z')

function subscription(overrides = {}) {
  return {
    status: 'active',
    current_period_end: futurePeriodEnd,
    stripe_price_id: 'price_basic',
    ...overrides,
  }
}

test('five distinct UTC usage dates are usable and the sixth is blocked', () => {
  const consumedDates = []

  for (let day = 1; day <= 5; day += 1) {
    const usageDate = `2026-09-0${day}`
    const beforeClaim = decideFreeUsage({
      usageDates: consumedDates,
      usageDate,
      freeUsageDaysLimit: 5,
    })

    assert.equal(beforeClaim.canUseFreeAllowance, true, `day ${day} should be usable`)
    consumedDates.push(usageDate)

    const afterClaim = decideFreeUsage({
      usageDates: consumedDates,
      usageDate,
      freeUsageDaysLimit: 5,
    })
    assert.equal(afterClaim.usageDaysConsumed, day)
    assert.equal(afterClaim.usageDaysRemaining, 5 - day)
    assert.equal(afterClaim.canUseFreeAllowance, true)
  }

  const sixthDay = decideFreeUsage({
    usageDates: consumedDates,
    usageDate: '2026-09-06',
    freeUsageDaysLimit: 5,
  })
  assert.equal(sixthDay.usageDaysConsumed, 5)
  assert.equal(sixthDay.usageDaysRemaining, 0)
  assert.equal(sixthDay.usageDateConsumed, false)
  assert.equal(sixthDay.canUseFreeAllowance, false)
})

test('repeated sessions and requests on usage day five remain usable', () => {
  const decision = decideFreeUsage({
    usageDates: [
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-05',
    ],
    usageDate: '2026-09-05',
    freeUsageDaysLimit: 5,
  })

  assert.equal(decision.usageDaysConsumed, 5)
  assert.equal(decision.usageDateConsumed, true)
  assert.equal(decision.canUseFreeAllowance, true)
})

test('neither switching tenant nor switching user resets an exhausted scope', () => {
  const fiveDates = [
    '2026-09-01',
    '2026-09-02',
    '2026-09-03',
    '2026-09-04',
    '2026-09-05',
  ]

  const sameUserNewTenant = decideFreeUsage({
    usageDates: fiveDates,
    tenantUsageDates: [],
    usageDate: '2026-09-06',
    freeUsageDaysLimit: 5,
  })
  const newUserSameTenant = decideFreeUsage({
    usageDates: [],
    tenantUsageDates: fiveDates,
    usageDate: '2026-09-06',
    freeUsageDaysLimit: 5,
  })

  assert.equal(sameUserNewTenant.canUseFreeAllowance, false)
  assert.equal(newUserSameTenant.canUseFreeAllowance, false)

  const exhaustedUserOnTenantWhoseCurrentDayWasUsed = decideFreeUsage({
    usageDates: fiveDates,
    tenantUsageDates: ['2026-09-06'],
    usageDate: '2026-09-06',
    freeUsageDaysLimit: 5,
  })
  const userWhoseCurrentDayWasUsedOnExhaustedTenant = decideFreeUsage({
    usageDates: ['2026-09-06'],
    tenantUsageDates: fiveDates,
    usageDate: '2026-09-06',
    freeUsageDaysLimit: 5,
  })

  assert.equal(exhaustedUserOnTenantWhoseCurrentDayWasUsed.canUseFreeAllowance, false)
  assert.equal(userWhoseCurrentDayWasUsedOnExhaustedTenant.canUseFreeAllowance, false)
})

test('usage dates are UTC calendar dates rather than sessions or rolling 24-hour windows', () => {
  assert.equal(getUtcUsageDate(new Date('2026-09-05T23:59:59.999Z')), '2026-09-05')
  assert.equal(getUtcUsageDate(new Date('2026-09-06T00:00:00.000Z')), '2026-09-06')
  assert.equal(getUtcUsageDate(new Date('2026-09-06T00:30:00+01:00')), '2026-09-05')
  assert.throws(() => getUtcUsageDate(new Date('invalid')), /invalid clock value/)
})

test('only configured active and trialing subscriptions with future period ends are paid', () => {
  for (const status of ['active', 'trialing']) {
    assert.equal(
      isSubscriptionPaid({ subscription: subscription({ status }), now, paidPriceIds }),
      true,
      status
    )
  }

  for (const status of [
    'past_due',
    'unpaid',
    'canceled',
    'incomplete',
    'incomplete_expired',
    'paused',
    'pending',
  ]) {
    assert.equal(
      isSubscriptionPaid({ subscription: subscription({ status }), now, paidPriceIds }),
      false,
      status
    )
  }
})

test('paid-through and price boundaries fail closed', () => {
  assert.equal(
    isSubscriptionPaid({
      subscription: subscription({ current_period_end: now.toISOString() }),
      now,
      paidPriceIds,
    }),
    false
  )
  assert.equal(
    isSubscriptionPaid({
      subscription: subscription({ current_period_end: null }),
      now,
      paidPriceIds,
    }),
    false
  )
  assert.equal(
    isSubscriptionPaid({
      subscription: subscription({ current_period_end: 'not-a-date' }),
      now,
      paidPriceIds,
    }),
    false
  )
  assert.equal(
    isSubscriptionPaid({
      subscription: subscription({ stripe_price_id: 'price_unrecognized' }),
      now,
      paidPriceIds,
    }),
    false
  )
  assert.equal(isSubscriptionPaid({ subscription: null, now, paidPriceIds }), false)
})

test('cancel-at-period-end retains access only while Stripe still reports active and paid-through', () => {
  assert.equal(
    isSubscriptionPaid({
      subscription: subscription({ status: 'active' }),
      now,
      paidPriceIds,
    }),
    true
  )
  assert.equal(
    isSubscriptionPaid({
      subscription: subscription({
        status: 'active',
        current_period_end: '2026-09-06T11:59:59.999Z',
      }),
      now,
      paidPriceIds,
    }),
    false
  )
})

test('configured price IDs omit empty values and support both plans', () => {
  assert.deepEqual(
    [...getConfiguredPaidPriceIds({
      STRIPE_PRICE_ID_BASIC: ' price_basic ',
      STRIPE_PRICE_ID_PRO: 'price_pro',
    })].sort(),
    ['price_basic', 'price_pro']
  )
  assert.deepEqual([...getConfiguredPaidPriceIds({})], [])
})
