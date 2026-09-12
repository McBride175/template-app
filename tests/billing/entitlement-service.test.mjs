import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const ENTITLEMENTS_PATH = new URL('../../lib/billing/entitlements.ts', import.meta.url)

function thenableResult(result) {
  return {
    select() {
      return this
    },
    eq() {
      return this
    },
    order() {
      return this
    },
    limit() {
      return this
    },
    async maybeSingle() {
      return result
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject)
    },
  }
}

function createSessionClient(subscription) {
  return {
    from(table) {
      if (table === 'subscriptions') {
        return thenableResult({ data: subscription, error: null })
      }
      if (table === 'xero_connections_public') {
        return thenableResult({
          data: [
            {
              tenant_id: 'tenant_test',
              auth_state: 'active',
              updated_at: '2026-09-06T00:00:00Z',
            },
          ],
          error: null,
        })
      }
      throw new Error(`Unexpected session table: ${table}`)
    },
  }
}

function createAdminClient({ usageDates = [], claim, claimError = null }) {
  let rpcCalls = 0
  return {
    get rpcCalls() {
      return rpcCalls
    },
    from(table) {
      assert.equal(table, 'billing_usage_days')
      return thenableResult({
        data: usageDates.map((usage_date) => ({ usage_date })),
        error: null,
      })
    },
    rpc(name, args) {
      rpcCalls += 1
      assert.equal(name, 'claim_billing_usage_day')
      assert.equal(args.p_user_id, 'user_test')
      assert.equal(args.p_tenant_id, 'tenant_test')
      assert.equal(args.p_free_usage_days_limit, 5)
      return {
        async single() {
          return { data: claim ?? null, error: claimError }
        },
      }
    },
  }
}

function loadEntitlements() {
  return loadTypeScriptModule(ENTITLEMENTS_PATH, {
    mocks: {
      'server-only': {},
      '@/lib/supabase-admin': {
        createSupabaseAdminClient() {
          throw new Error('test must inject the admin client')
        },
      },
      '@/lib/supabase-server': {
        async createServerSupabaseClient() {
          throw new Error('test must inject the session client')
        },
      },
    },
  })
}

test('claim records first dashboard use before granting free access', async () => {
  const { claimActionsEntitlementStatus } = loadEntitlements()
  const admin = createAdminClient({
    claim: {
      allowed: true,
      usage_days_consumed: 1,
      usage_date_already_recorded: true,
    },
  })

  const result = await claimActionsEntitlementStatus({
    userId: 'user_test',
    supabase: createSessionClient(null),
    supabaseAdmin: admin,
    now: new Date('2026-09-01T12:00:00Z'),
  })

  assert.equal(admin.rpcCalls, 1)
  assert.equal(result.usageDaysConsumed, 1)
  assert.equal(result.usageDaysRemaining, 4)
  assert.equal(result.usageDate, '2026-09-01')
  assert.equal(result.hasActionsAccess, true)
  assert.equal(result.paidPlan, null)
})

test('claim blocks the first attempt on a sixth distinct date', async () => {
  const { claimActionsEntitlementStatus } = loadEntitlements()
  const usageDates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']
  const admin = createAdminClient({
    usageDates,
    claim: {
      allowed: false,
      usage_days_consumed: 5,
      usage_date_already_recorded: false,
    },
  })

  const result = await claimActionsEntitlementStatus({
    userId: 'user_test',
    supabase: createSessionClient(null),
    supabaseAdmin: admin,
    now: new Date('2026-09-06T00:00:00Z'),
  })

  assert.equal(result.usageDaysConsumed, 5)
  assert.equal(result.usageDateConsumed, false)
  assert.equal(result.hasActionsAccess, false)
})

test('all requests on already-recorded day five remain allowed', async () => {
  const { claimActionsEntitlementStatus } = loadEntitlements()
  const usageDates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']
  const admin = createAdminClient({
    usageDates,
    claim: {
      allowed: true,
      usage_days_consumed: 5,
      usage_date_already_recorded: true,
    },
  })

  const result = await claimActionsEntitlementStatus({
    userId: 'user_test',
    supabase: createSessionClient(null),
    supabaseAdmin: admin,
    now: new Date('2026-09-05T23:59:59Z'),
  })

  assert.equal(result.usageDaysRemaining, 0)
  assert.equal(result.usageDateConsumed, true)
  assert.equal(result.hasActionsAccess, true)
})

test('valid paid entitlement bypasses free-day recording', async () => {
  const previousPrice = process.env.STRIPE_PRICE_ID_BASIC
  process.env.STRIPE_PRICE_ID_BASIC = 'price_basic'
  try {
    const { claimActionsEntitlementStatus } = loadEntitlements()
    const admin = createAdminClient({ usageDates: [] })
    const result = await claimActionsEntitlementStatus({
      userId: 'user_test',
      supabase: createSessionClient({
        status: 'active',
        stripe_price_id: 'price_basic',
        current_period_end: '2026-10-01T00:00:00Z',
      }),
      supabaseAdmin: admin,
      now: new Date('2026-09-06T12:00:00Z'),
    })

    assert.equal(result.isPaid, true)
    assert.equal(result.paidPlan, 'basic')
    assert.equal(result.hasActionsAccess, true)
    assert.equal(result.usageDaysRemaining, null)
    assert.equal(admin.rpcCalls, 0)
  } finally {
    if (previousPrice === undefined) delete process.env.STRIPE_PRICE_ID_BASIC
    else process.env.STRIPE_PRICE_ID_BASIC = previousPrice
  }
})

test('trustworthy paid-through cache does not depend on the free-usage ledger', async () => {
  const previousPrice = process.env.STRIPE_PRICE_ID_PRO
  process.env.STRIPE_PRICE_ID_PRO = 'price_pro'
  try {
    const { claimActionsEntitlementStatus } = loadEntitlements()
    const admin = {
      from() {
        throw new Error('free-usage ledger unavailable')
      },
      rpc() {
        throw new Error('paid requests must not claim a free day')
      },
    }

    const result = await claimActionsEntitlementStatus({
      userId: 'user_test',
      supabase: createSessionClient({
        status: 'active',
        stripe_price_id: 'price_pro',
        current_period_end: '2026-10-01T00:00:00Z',
      }),
      supabaseAdmin: admin,
      now: new Date('2026-09-06T12:00:00Z'),
    })

    assert.equal(result.isPaid, true)
    assert.equal(result.paidPlan, 'pro')
    assert.equal(result.hasActionsAccess, true)
  } finally {
    if (previousPrice === undefined) delete process.env.STRIPE_PRICE_ID_PRO
    else process.env.STRIPE_PRICE_ID_PRO = previousPrice
  }
})

test('an exhausted user gains access after a valid paid cache update', async () => {
  const previousPrice = process.env.STRIPE_PRICE_ID_BASIC
  process.env.STRIPE_PRICE_ID_BASIC = 'price_basic'
  try {
    const { claimActionsEntitlementStatus } = loadEntitlements()
    const admin = createAdminClient({
      usageDates: ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'],
    })
    const result = await claimActionsEntitlementStatus({
      userId: 'user_test',
      supabase: createSessionClient({
        status: 'active',
        stripe_price_id: 'price_basic',
        current_period_end: '2026-10-01T00:00:00Z',
      }),
      supabaseAdmin: admin,
      now: new Date('2026-09-06T12:00:00Z'),
    })

    assert.equal(result.isPaid, true)
    assert.equal(result.paidPlan, 'basic')
    assert.equal(result.hasActionsAccess, true)
    assert.equal(admin.rpcCalls, 0)
  } finally {
    if (previousPrice === undefined) delete process.env.STRIPE_PRICE_ID_BASIC
    else process.env.STRIPE_PRICE_ID_BASIC = previousPrice
  }
})

test('checkout return before a trustworthy webhook update does not grant access', async () => {
  const { claimActionsEntitlementStatus } = loadEntitlements()
  const admin = createAdminClient({
    usageDates: ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'],
    claim: {
      allowed: false,
      usage_days_consumed: 5,
      usage_date_already_recorded: false,
    },
  })
  const result = await claimActionsEntitlementStatus({
    userId: 'user_test',
    supabase: createSessionClient({
      status: 'pending',
      stripe_price_id: 'price_basic',
      current_period_end: null,
    }),
    supabaseAdmin: admin,
    now: new Date('2026-09-06T12:00:00Z'),
  })

  assert.equal(result.isPaid, false)
  assert.equal(result.hasActionsAccess, false)
  assert.equal(admin.rpcCalls, 1)
})

test('usage claim database errors fail closed', async () => {
  const { claimActionsEntitlementStatus } = loadEntitlements()
  const admin = createAdminClient({
    claimError: { message: 'database unavailable' },
  })

  await assert.rejects(
    claimActionsEntitlementStatus({
      userId: 'user_test',
      supabase: createSessionClient(null),
      supabaseAdmin: admin,
      now: new Date('2026-09-06T12:00:00Z'),
    }),
    /Failed to claim billing usage day: database unavailable/
  )
})
