import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import {
  applyStripeSubscriptionCache,
  resolveStripeSubscriptionUser,
} from '@/lib/billing/stripe-cache'

const HANDLED_SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
])

async function synchronizeSubscription(params: {
  subscription: Stripe.Subscription
  userHint?: string | null
  eventType: string
}) {
  const supabaseAdmin = createSupabaseAdminClient()
  const userId = await resolveStripeSubscriptionUser({
    supabaseAdmin,
    subscription: params.subscription,
    userHint: params.userHint,
  })

  if (!userId) {
    console.warn('[stripe.webhook] Subscription owner was not resolved', {
      event_type: params.eventType,
      subscription_id: params.subscription.id,
    })
    return
  }

  const result = await applyStripeSubscriptionCache({
    supabaseAdmin,
    subscription: params.subscription,
    userId,
  })

  console.log('[stripe.webhook] Subscription cache synchronized', {
    event_type: params.eventType,
    user_id: userId,
    subscription_id: params.subscription.id,
    customer_id: result.customerId,
    cache_applied: result.applied,
    period_end_set: result.currentPeriodEnd !== null,
  })
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    return NextResponse.json({ error: 'STRIPE_WEBHOOK_SECRET not configured' }, { status: 500 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (error) {
    console.error('[stripe.webhook] Signature verification failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      const userId = session.metadata?.supabase_user_id ?? null
      const subscriptionId =
        typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id ?? null

      if (!userId || !subscriptionId || session.mode !== 'subscription') {
        console.warn('[stripe.webhook] Checkout session is missing subscription ownership data', {
          session_id: session.id,
          has_user_id: Boolean(userId),
          has_subscription_id: Boolean(subscriptionId),
          mode: session.mode,
        })
        return NextResponse.json({ received: true })
      }

      const subscription = await stripe.subscriptions.retrieve(subscriptionId)
      await synchronizeSubscription({
        subscription,
        userHint: userId,
        eventType: event.type,
      })
    } else if (HANDLED_SUBSCRIPTION_EVENTS.has(event.type)) {
      const eventSubscription = event.data.object as Stripe.Subscription
      const subscription =
        event.type === 'customer.subscription.deleted'
          ? eventSubscription
          : await stripe.subscriptions.retrieve(eventSubscription.id)

      await synchronizeSubscription({
        subscription,
        eventType: event.type,
      })
    } else {
      console.log('[stripe.webhook] Unhandled event', { event_type: event.type })
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[stripe.webhook] Processing failed', {
      event_type: event.type,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
