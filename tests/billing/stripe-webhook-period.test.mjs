import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const STRIPE_CACHE_PATH = new URL('../../lib/billing/stripe-cache.ts', import.meta.url)

function createSupabaseAdminMock(userId, rpcWrites) {
  return {
    async rpc(name, values) {
      assert.equal(name, 'apply_stripe_subscription_cache')
      rpcWrites.push(values)
      return { data: true, error: null }
    },
    from(table) {
      assert.equal(table, 'stripe_customers')
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        async maybeSingle() {
          return { data: { user_id: userId }, error: null }
        },
      }
    },
  }
}

async function runSubscriptionCacheWrite({ status, periodEnd, created = 1_790_000_000 }) {
  const rpcWrites = []
  const userId = 'user_test'
  const supabaseAdmin = createSupabaseAdminMock(userId, rpcWrites)
  const { applyStripeSubscriptionCache } = loadTypeScriptModule(STRIPE_CACHE_PATH, {
    mocks: {
      'server-only': {},
      '@/lib/supabase-admin': {
        createSupabaseAdminClient() {
          throw new Error('injected admin client should be used')
        },
      },
    },
  })

  const result = await applyStripeSubscriptionCache({
    supabaseAdmin,
    userId,
    subscription: {
      id: 'sub_test',
      customer: 'cus_test',
      created,
      status,
      items: {
        data: [
          {
            current_period_end: periodEnd,
            price: { id: 'price_test' },
          },
        ],
      },
    },
  })

  assert.equal(rpcWrites.length, 1)
  return { result, write: rpcWrites[0] }
}

test('active subscription persists its subscription item period end', async () => {
  const periodEnd = 1_800_000_000
  const { result, write } = await runSubscriptionCacheWrite({
    status: 'active',
    periodEnd,
  })

  assert.equal(write.p_status, 'active')
  assert.equal(write.p_current_period_end, new Date(periodEnd * 1000).toISOString())
  assert.equal(write.p_stripe_price_id, 'price_test')
  assert.equal(result.applied, true)
})

test('trialing subscription persists its item period and creation timestamps', async () => {
  const periodEnd = 1_810_000_000
  const created = 1_795_000_000
  const { write } = await runSubscriptionCacheWrite({
    status: 'trialing',
    periodEnd,
    created,
  })

  assert.equal(write.p_status, 'trialing')
  assert.equal(write.p_current_period_end, new Date(periodEnd * 1000).toISOString())
  assert.equal(
    write.p_stripe_subscription_created_at,
    new Date(created * 1000).toISOString()
  )
})

test('missing period end remains null and cannot grant access in the entitlement policy', async () => {
  const { write } = await runSubscriptionCacheWrite({
    status: 'active',
    periodEnd: undefined,
  })

  assert.equal(write.p_current_period_end, null)
})

test('checkout metadata cannot claim a Stripe customer mapped to another user', async () => {
  const { resolveStripeSubscriptionUser } = loadTypeScriptModule(STRIPE_CACHE_PATH, {
    mocks: {
      'server-only': {},
      '@/lib/supabase-admin': { createSupabaseAdminClient: () => ({}) },
    },
  })
  const supabaseAdmin = {
    from(table) {
      assert.equal(table, 'stripe_customers')
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        async maybeSingle() {
          return { data: { user_id: 'actual_owner' }, error: null }
        },
      }
    },
  }

  await assert.rejects(
    resolveStripeSubscriptionUser({
      supabaseAdmin,
      userHint: 'attacker',
      subscription: {
        id: 'sub_owned',
        customer: 'cus_owned',
      },
    }),
    /does not own the session customer/
  )
})
