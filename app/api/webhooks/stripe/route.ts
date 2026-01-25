/**
 * API Route: Stripe Webhook Handler
 * 
 * TEMPLATE CODE: This endpoint handles Stripe webhook events and syncs
 * subscription data to the Supabase subscriptions table.
 * 
 * Webhook events handled:
 * - checkout.session.completed: Creates subscription record
 * - customer.subscription.updated: Updates subscription status/period
 * - customer.subscription.deleted: Marks subscription as cancelled
 * 
 * Setup:
 * 1. In Stripe Dashboard, add webhook endpoint: https://yourdomain.com/api/webhooks/stripe
 * 2. Select events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted
 * 3. Copy webhook signing secret to STRIPE_WEBHOOK_SECRET env variable
 */
import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

// Use service role key for webhook operations (bypasses RLS)
// TEMPLATE CODE: Webhooks need elevated permissions to write to subscriptions table
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 }
    )
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    return NextResponse.json(
      { error: 'STRIPE_WEBHOOK_SECRET not configured' },
      { status: 500 }
    )
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 400 }
    )
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session

        // Get subscription details
        const subscription = await stripe.subscriptions.retrieve(
          session.subscription as string
        )

        // Get user ID from metadata
        const userId = session.metadata?.supabase_user_id
        if (!userId) {
          console.error('Missing supabase_user_id in checkout session metadata')
          break
        }

        // Upsert subscription record
        await supabaseAdmin
          .from('subscriptions')
          .upsert({
            user_id: userId,
            stripe_customer_id: subscription.customer as string,
            stripe_subscription_id: subscription.id,
            status: subscription.status,
            current_period_end: new Date(
              subscription.current_period_end * 1000
            ).toISOString(),
          })

        console.log(`Subscription created for user ${userId}`)
        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription

        // Find user by customer ID
        const { data: existingSub } = await supabaseAdmin
          .from('subscriptions')
          .select('user_id')
          .eq('stripe_customer_id', subscription.customer as string)
          .single()

        if (!existingSub) {
          console.error(
            `Subscription not found for customer ${subscription.customer}`
          )
          break
        }

        // Update subscription record
        await supabaseAdmin
          .from('subscriptions')
          .update({
            status: subscription.status,
            current_period_end: new Date(
              subscription.current_period_end * 1000
            ).toISOString(),
          })
          .eq('stripe_subscription_id', subscription.id)

        console.log(`Subscription updated for user ${existingSub.user_id}`)
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription

        // Update subscription status to cancelled
        await supabaseAdmin
          .from('subscriptions')
          .update({
            status: 'canceled',
          })
          .eq('stripe_subscription_id', subscription.id)

        console.log(`Subscription cancelled: ${subscription.id}`)
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Error processing webhook:', error)
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    )
  }
}

// Route segment config: ensure we get raw body for webhook verification
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
