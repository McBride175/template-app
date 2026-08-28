import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const WEBHOOK_ROUTE_PATH = new URL(
  '../../app/api/webhooks/stripe/route.ts',
  import.meta.url
)

function createNextResponseMock() {
  return {
    json(body, init = {}) {
      return {
        body,
        status: init.status ?? 200,
      }
    },
  }
}

function createSupabaseAdminMock(userId, subscriptionWrites) {
  return {
    from(table) {
      if (table === 'stripe_customers') {
        return {
          select() {
            return {
              eq() {
                return {
                  async single() {
                    return { data: { user_id: userId }, error: null }
                  },
                }
              },
            }
          },
          async upsert() {
            return { error: null }
          },
        }
      }

      if (table === 'subscriptions') {
        return {
          select() {
            return {
              eq() {
                return {
                  is() {
                    return {
                      async single() {
                        return { data: null, error: null }
                      },
                    }
                  },
                }
              },
            }
          },
          update(values) {
            subscriptionWrites.push(values)
            return {
              eq() {
                return {
                  async select() {
                    return { data: [{ user_id: userId }], error: null }
                  },
                }
              },
            }
          },
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  }
}

async function runSubscriptionEvent({ eventType, status, periodEnd }) {
  const subscriptionWrites = []
  const subscription = {
    id: 'sub_test',
    customer: 'cus_test',
    status,
    items: {
      data: [
        {
          current_period_end: periodEnd,
          price: { id: 'price_test' },
        },
      ],
    },
  }

  const stripe = {
    subscriptions: {
      async retrieve() {
        return subscription
      },
    },
    webhooks: {
      constructEvent() {
        return {
          type: eventType,
          data: { object: { id: subscription.id } },
        }
      },
    },
  }

  const supabaseAdmin = createSupabaseAdminMock('user_test', subscriptionWrites)
  const route = loadTypeScriptModule(WEBHOOK_ROUTE_PATH, {
    mocks: {
      'next/server': { NextResponse: createNextResponseMock() },
      '@/lib/stripe': { stripe },
      '@supabase/supabase-js': {
        createClient() {
          return supabaseAdmin
        },
      },
    },
  })

  const previousWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'

  try {
    const response = await route.POST({
      async text() {
        return '{}'
      },
      headers: {
        get(name) {
          return name === 'stripe-signature' ? 'test-signature' : null
        },
      },
    })

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { received: true })
  } finally {
    if (typeof previousWebhookSecret === 'string') {
      process.env.STRIPE_WEBHOOK_SECRET = previousWebhookSecret
    } else {
      delete process.env.STRIPE_WEBHOOK_SECRET
    }
  }

  assert.equal(subscriptionWrites.length, 1)
  return subscriptionWrites[0]
}

test('created active subscription persists its subscription item period end', async () => {
  const periodEnd = 1_800_000_000
  const write = await runSubscriptionEvent({
    eventType: 'customer.subscription.created',
    status: 'active',
    periodEnd,
  })

  assert.equal(write.status, 'active')
  assert.equal(write.current_period_end, new Date(periodEnd * 1000).toISOString())
  assert.notEqual(write.current_period_end, null)
})

test('updated trialing subscription persists its subscription item period end', async () => {
  const periodEnd = 1_810_000_000
  const write = await runSubscriptionEvent({
    eventType: 'customer.subscription.updated',
    status: 'trialing',
    periodEnd,
  })

  assert.equal(write.status, 'trialing')
  assert.equal(write.current_period_end, new Date(periodEnd * 1000).toISOString())
  assert.notEqual(write.current_period_end, null)
})
