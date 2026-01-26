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

        console.log('[webhook] checkout.session.completed', {
          session_id: session.id,
          subscription_id: session.subscription,
        })

        // Get subscription ID from session
        const subscriptionId = session.subscription as string
        if (!subscriptionId) {
          console.error('[webhook] Missing subscription ID in checkout session', {
            session_id: session.id,
          })
          break
        }

        // Get subscription details
        // Type assertion to ensure TS treats this as Subscription, not Response<Subscription>
        const subscriptionResponse = await stripe.subscriptions.retrieve(subscriptionId)
        const subscription = subscriptionResponse as Stripe.Subscription

        // Get user ID from metadata
        const userId = session.metadata?.supabase_user_id
        if (!userId) {
          console.warn('[webhook] Missing supabase_user_id in checkout session metadata', {
            session_id: session.id,
            subscription_id: subscriptionId,
          })
          break
        }

        // Guard for missing period end (should exist for normal subs, but safe)
        // Use type assertion to access current_period_end (workaround for TS type issues)
        const periodEnd = (subscription as any).current_period_end as number | null | undefined
        const currentPeriodEnd = periodEnd
          ? new Date(periodEnd * 1000).toISOString()
          : null

        if (!currentPeriodEnd) {
          console.error('[webhook] Missing current_period_end in subscription', {
            subscription_id: subscriptionId,
            user_id: userId,
          })
          break
        }

        // Upsert subscription record using service role (bypasses RLS)
        const { data: upsertData, error: upsertError } = await supabaseAdmin
          .from('subscriptions')
          .upsert(
            {
              user_id: userId,
              stripe_customer_id: subscription.customer as string,
              stripe_subscription_id: subscription.id,
              status: subscription.status,
              current_period_end: currentPeriodEnd,
            },
            {
              onConflict: 'user_id',
            }
          )
          .select()

        if (upsertError) {
          console.error('[webhook] Failed to upsert subscription', {
            error: upsertError.message,
            subscription_id: subscriptionId,
            user_id: userId,
          })
        } else {
          console.log('[webhook] Subscription upserted successfully', {
            subscription_id: subscriptionId,
            user_id: userId,
            status: subscription.status,
            upserted: upsertData ? 'yes' : 'no',
          })
        }

        break
      }

      case 'customer.subscription.updated': {
        // Type assertion to ensure TS treats this as Subscription
        const subscription = event.data.object as Stripe.Subscription

        console.log('[webhook] customer.subscription.updated', {
          subscription_id: subscription.id,
          customer_id: subscription.customer,
          status: subscription.status,
        })

        // Find user by customer ID
        const { data: existingSub, error: findError } = await supabaseAdmin
          .from('subscriptions')
          .select('user_id')
          .eq('stripe_customer_id', subscription.customer as string)
          .single()

        if (findError || !existingSub) {
          console.error('[webhook] Subscription not found for customer', {
            error: findError?.message,
            customer_id: subscription.customer,
            subscription_id: subscription.id,
          })
          break
        }

        // Guard for missing period end (should exist for normal subs, but safe)
        // Use type assertion to access current_period_end (workaround for TS type issues)
        const periodEnd = (subscription as any).current_period_end as number | null | undefined
        const currentPeriodEnd = periodEnd
          ? new Date(periodEnd * 1000).toISOString()
          : null

        if (!currentPeriodEnd) {
          console.error('[webhook] Missing current_period_end in subscription update', {
            subscription_id: subscription.id,
            user_id: existingSub.user_id,
          })
          break
        }

        // Update subscription record using service role (bypasses RLS)
        const { data: updateData, error: updateError } = await supabaseAdmin
          .from('subscriptions')
          .update({
            status: subscription.status,
            current_period_end: currentPeriodEnd,
          })
          .eq('stripe_subscription_id', subscription.id)
          .select()

        if (updateError) {
          console.error('[webhook] Failed to update subscription', {
            error: updateError.message,
            subscription_id: subscription.id,
            user_id: existingSub.user_id,
          })
        } else {
          console.log('[webhook] Subscription updated successfully', {
            subscription_id: subscription.id,
            user_id: existingSub.user_id,
            status: subscription.status,
            updated: updateData ? 'yes' : 'no',
          })
        }

        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription

        console.log('[webhook] customer.subscription.deleted', {
          subscription_id: subscription.id,
          customer_id: subscription.customer,
        })

        // Update subscription status to cancelled using service role (bypasses RLS)
        const { data: updateData, error: updateError } = await supabaseAdmin
          .from('subscriptions')
          .update({
            status: 'canceled',
          })
          .eq('stripe_subscription_id', subscription.id)
          .select()

        if (updateError) {
          console.error('[webhook] Failed to cancel subscription', {
            error: updateError.message,
            subscription_id: subscription.id,
          })
        } else {
          console.log('[webhook] Subscription cancelled successfully', {
            subscription_id: subscription.id,
            cancelled: updateData ? 'yes' : 'no',
          })
        }

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
