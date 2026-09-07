import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const WEBHOOK_ROUTE_PATH = new URL('../../app/api/webhooks/stripe/route.ts', import.meta.url)

function nextResponseMock() {
  return {
    json(body, init = {}) {
      return { body, status: init.status ?? 200 }
    },
  }
}

function webhookRequest() {
  return {
    async text() {
      return '{"signed":true}'
    },
    headers: {
      get(name) {
        return name === 'stripe-signature' ? 'signature' : null
      },
    },
  }
}

async function withWebhookSecret(run) {
  const previous = process.env.STRIPE_WEBHOOK_SECRET
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
  try {
    return await run()
  } finally {
    if (previous === undefined) delete process.env.STRIPE_WEBHOOK_SECRET
    else process.env.STRIPE_WEBHOOK_SECRET = previous
  }
}

test('webhook rejects an invalid Stripe signature before any cache write', async () => {
  let cacheWrites = 0
  const route = loadTypeScriptModule(WEBHOOK_ROUTE_PATH, {
    mocks: {
      'next/server': { NextResponse: nextResponseMock() },
      '@/lib/stripe': {
        stripe: {
          webhooks: {
            constructEvent() {
              throw new Error('bad signature')
            },
          },
        },
      },
      '@/lib/supabase-admin': { createSupabaseAdminClient: () => ({}) },
      '@/lib/billing/stripe-cache': {
        async resolveStripeSubscriptionUser() {
          return 'user_test'
        },
        async applyStripeSubscriptionCache() {
          cacheWrites += 1
        },
      },
    },
  })

  const response = await withWebhookSecret(() => route.POST(webhookRequest()))
  assert.equal(response.status, 400)
  assert.equal(cacheWrites, 0)
})

test('signed checkout completion retrieves Stripe state and binds it to session metadata user', async () => {
  const subscription = {
    id: 'sub_checkout',
    customer: 'cus_checkout',
    created: 1_790_000_000,
    status: 'active',
    items: { data: [] },
  }
  const calls = []
  const route = loadTypeScriptModule(WEBHOOK_ROUTE_PATH, {
    mocks: {
      'next/server': { NextResponse: nextResponseMock() },
      '@/lib/stripe': {
        stripe: {
          webhooks: {
            constructEvent() {
              return {
                type: 'checkout.session.completed',
                data: {
                  object: {
                    id: 'cs_test',
                    mode: 'subscription',
                    subscription: subscription.id,
                    metadata: { supabase_user_id: 'user_checkout' },
                  },
                },
              }
            },
          },
          subscriptions: {
            async retrieve(id) {
              assert.equal(id, subscription.id)
              return subscription
            },
          },
        },
      },
      '@/lib/supabase-admin': { createSupabaseAdminClient: () => ({ marker: 'admin' }) },
      '@/lib/billing/stripe-cache': {
        async resolveStripeSubscriptionUser(args) {
          calls.push({ kind: 'resolve', ...args })
          return args.userHint
        },
        async applyStripeSubscriptionCache(args) {
          calls.push({ kind: 'apply', ...args })
          return {
            applied: true,
            customerId: subscription.customer,
            currentPeriodEnd: '2026-10-01T00:00:00.000Z',
          }
        },
      },
    },
  })

  const response = await withWebhookSecret(() => route.POST(webhookRequest()))
  assert.equal(response.status, 200)
  assert.equal(calls[0].userHint, 'user_checkout')
  assert.equal(calls[1].userId, 'user_checkout')
  assert.equal(calls[1].subscription.id, 'sub_checkout')
})

test('visiting a checkout success URL cannot invoke signed webhook processing', async () => {
  const routeSource = await import('node:fs/promises').then(({ readFile }) =>
    readFile(WEBHOOK_ROUTE_PATH, 'utf8')
  )

  assert.match(routeSource, /constructEvent\(body, signature, webhookSecret\)/)
  assert.doesNotMatch(routeSource, /checkout=success/)
})

test('webhook covers checkout and the full subscription lifecycle', async () => {
  const routeSource = await import('node:fs/promises').then(({ readFile }) =>
    readFile(WEBHOOK_ROUTE_PATH, 'utf8')
  )

  for (const eventType of [
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
  ]) {
    assert.match(routeSource, new RegExp(eventType.replaceAll('.', '\\.'), 'g'))
  }
  assert.match(routeSource, /subscriptions\.retrieve/)
  assert.match(routeSource, /applyStripeSubscriptionCache/)
})
