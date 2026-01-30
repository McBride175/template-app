/**
 * API Route: Stripe Webhook Handler
 * 
 * TEMPLATE CODE: This endpoint handles Stripe webhook events and syncs
 * subscription data to the Supabase subscriptions table.
 * 
 * Webhook events handled:
 * - checkout.session.completed: Creates pending subscription record immediately
 * - customer.subscription.created: Updates subscription with full details
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

        // Get user ID from metadata (required for checkout.session.completed)
        const userId = session.metadata?.supabase_user_id
        if (!userId) {
          console.warn('[webhook] checkout.session.completed: Missing supabase_user_id in metadata', {
            session_id: session.id,
            subscription_id: session.subscription,
            customer_id: session.customer,
          })
          return NextResponse.json({ received: true })
        }

        // Get subscription ID from session
        const subscriptionId = session.subscription as string
        if (!subscriptionId) {
          console.error('[webhook] checkout.session.completed: Missing subscription ID', {
            session_id: session.id,
            user_id: userId,
            customer_id: session.customer,
          })
          return NextResponse.json({ received: true })
        }

        // Get customer ID from session
        const customerId = session.customer as string
        if (!customerId) {
          console.error('[webhook] checkout.session.completed: Missing customer ID', {
            session_id: session.id,
            user_id: userId,
            subscription_id: subscriptionId,
          })
          return NextResponse.json({ received: true })
        }

        // TEMPLATE CODE: Query existing subscription row to avoid downgrading active subscriptions
        // If row exists, only update safe fields (stripe_customer_id, stripe_subscription_id if missing)
        // If no row exists, create new row with status: 'pending'
        const { data: existingSub } = await supabaseAdmin
          .from('subscriptions')
          .select('status, current_period_end, stripe_subscription_id')
          .eq('user_id', userId)
          .single()

        const rowExists = !!existingSub
        const fieldsToUpdate: Record<string, any> = {
          user_id: userId,
          stripe_customer_id: customerId,
        }

        // If row exists, only update safe fields (don't overwrite status or current_period_end)
        if (rowExists) {
          // Only set stripe_subscription_id if it's missing
          if (!existingSub.stripe_subscription_id) {
            fieldsToUpdate.stripe_subscription_id = subscriptionId
          }
        } else {
          // If no row exists, create new row with pending status
          fieldsToUpdate.stripe_subscription_id = subscriptionId
          fieldsToUpdate.status = 'pending'
          fieldsToUpdate.current_period_end = null
        }

        // Upsert keyed by user_id (primary key)
        const { error: upsertError } = await supabaseAdmin
          .from('subscriptions')
          .upsert(fieldsToUpdate, {
            onConflict: 'user_id',
          })

        if (upsertError) {
          console.error('[webhook] checkout.session.completed: upsert failed', {
            handler: 'checkout.session.completed',
            error: upsertError.message,
            user_id: userId,
            subscription_id: subscriptionId,
            customer_id: customerId,
          })
          return NextResponse.json(
            { error: 'Failed to create subscription record' },
            { status: 500 }
          )
        }

        // Single structured log line showing whether existing row was found and what fields were updated
        const updatedFields = Object.keys(fieldsToUpdate).filter(
          (key) => key !== 'user_id'
        )
        console.log('[webhook] checkout.session.completed', {
          handler: 'checkout.session.completed',
          user_id: userId,
          subscription_id: subscriptionId,
          customer_id: customerId,
          existing_row_found: rowExists,
          fields_updated: updatedFields,
        })

        // TEMPLATE CODE: Also upsert customer mapping as backup for future webhook events
        const { error: mappingError } = await supabaseAdmin
          .from('stripe_customers')
          .upsert(
            {
              stripe_customer_id: customerId,
              user_id: userId,
            },
            {
              onConflict: 'stripe_customer_id',
            }
          )

        if (mappingError) {
          console.warn('[webhook] checkout.session.completed: Failed to upsert customer mapping', {
            error: mappingError.message,
            customer_id: customerId,
            user_id: userId,
          })
        } else {
          console.log('[webhook] checkout.session.completed: Customer mapping created/updated', {
            customer_id: customerId,
            user_id: userId,
          })
        }

        break
      }

      case 'customer.subscription.created': {
        const subscription = event.data.object as Stripe.Subscription
        const subscriptionId = subscription.id

        // TEMPLATE CODE: Always retrieve full subscription from Stripe API
        // This ensures we have current_period_end, status, and customer reliably
        let fullSubscription: Stripe.Subscription
        try {
          fullSubscription = await stripe.subscriptions.retrieve(subscriptionId)
        } catch (retrieveError) {
          console.error('[webhook] customer.subscription.created: Failed to retrieve subscription', {
            handler: 'customer.subscription.created',
            error: retrieveError instanceof Error ? retrieveError.message : 'Unknown error',
            subscription_id: subscriptionId,
          })
          return NextResponse.json(
            { error: 'Failed to retrieve subscription from Stripe' },
            { status: 500 }
          )
        }

        // Get customer ID from retrieved subscription
        const customerId = fullSubscription.customer as string

        // TEMPLATE CODE: Resolve user_id using multiple fallback strategies
        // (a) subscription.metadata.supabase_user_id if present
        // (b) stripe_customers mapping by stripe_customer_id
        // (c) existing subscriptions row by stripe_customer_id or by stripe_subscription_id
        let userId: string | null = null

        // Strategy (a): Check metadata (if present)
        if (fullSubscription.metadata?.supabase_user_id) {
          userId = fullSubscription.metadata.supabase_user_id
        }

        // Strategy (b): Query stripe_customers table
        if (!userId && customerId) {
          const { data: customerMapping } = await supabaseAdmin
            .from('stripe_customers')
            .select('user_id')
            .eq('stripe_customer_id', customerId)
            .single()

          if (customerMapping?.user_id) {
            userId = customerMapping.user_id
          }
        }

        // Strategy (c): Fallback to existing subscription record
        if (!userId) {
          // Try by stripe_customer_id first
          const { data: existingByCustomer } = await supabaseAdmin
            .from('subscriptions')
            .select('user_id')
            .eq('stripe_customer_id', customerId)
            .single()

          if (existingByCustomer?.user_id) {
            userId = existingByCustomer.user_id
          } else {
            // Try by stripe_subscription_id as fallback
            const { data: existingBySub } = await supabaseAdmin
              .from('subscriptions')
              .select('user_id')
              .eq('stripe_subscription_id', subscriptionId)
              .single()

            if (existingBySub?.user_id) {
              userId = existingBySub.user_id
            }
          }
        }

        // If user_id still not found, return 200 and log warning (don't attempt DB write)
        if (!userId) {
          console.warn('[webhook] customer.subscription.created: user_id not resolved', {
            handler: 'customer.subscription.created',
            customer_id: customerId,
            subscription_id: subscriptionId,
          })
          return NextResponse.json({ received: true })
        }

        // Get period end from retrieved subscription (unix seconds)
        // Type assertion needed because Stripe SDK types may not expose this field directly
        const periodEnd = (fullSubscription as any).current_period_end as number | null | undefined

        // Convert unix seconds to ISO string (or null if undefined/null)
        const currentPeriodEnd = periodEnd
          ? new Date(periodEnd * 1000).toISOString()
          : null

        const periodEndSet = currentPeriodEnd !== null

        // Upsert subscription record using service role (bypasses RLS)
        // Keyed by user_id (primary key) to update the same row created by checkout.session.completed
        const { error: upsertError } = await supabaseAdmin
          .from('subscriptions')
          .upsert(
            {
              user_id: userId,
              stripe_subscription_id: subscriptionId,
              stripe_customer_id: customerId,
              status: fullSubscription.status,
              current_period_end: currentPeriodEnd,
            },
            {
              onConflict: 'user_id',
            }
          )

        if (upsertError) {
          console.error('[webhook] customer.subscription.created: upsert failed', {
            handler: 'customer.subscription.created',
            error: upsertError.message,
            user_id: userId,
            subscription_id: subscriptionId,
            customer_id: customerId,
          })
          return NextResponse.json(
            { error: 'Failed to update subscription record' },
            { status: 500 }
          )
        }

        // Also upsert stripe_customers mapping if customer ID is present
        if (customerId) {
          const { error: mappingError } = await supabaseAdmin
            .from('stripe_customers')
            .upsert(
              {
                stripe_customer_id: customerId,
                user_id: userId,
              },
              {
                onConflict: 'stripe_customer_id',
              }
            )

          if (mappingError) {
            console.warn('[webhook] customer.subscription.created: Failed to upsert customer mapping', {
              error: mappingError.message,
              customer_id: customerId,
              user_id: userId,
            })
          }
        }

        // Single structured log line per handler
        console.log('[webhook] customer.subscription.created', {
          handler: 'customer.subscription.created',
          user_id: userId,
          subscription_id: subscriptionId,
          customer_id: customerId,
          period_end_set: periodEndSet,
        })

        break
      }

      case 'customer.subscription.updated': {
        // Type assertion to ensure TS treats this as Subscription
        const subscription = event.data.object as Stripe.Subscription
        const subscriptionId = subscription.id

        // TEMPLATE CODE: Always retrieve full subscription from Stripe API
        // This ensures we have current_period_end, status, and customer reliably
        let fullSubscription: Stripe.Subscription
        try {
          fullSubscription = await stripe.subscriptions.retrieve(subscriptionId)
        } catch (retrieveError) {
          console.error('[webhook] customer.subscription.updated: Failed to retrieve subscription', {
            handler: 'customer.subscription.updated',
            error: retrieveError instanceof Error ? retrieveError.message : 'Unknown error',
            subscription_id: subscriptionId,
          })
          return NextResponse.json(
            { error: 'Failed to retrieve subscription from Stripe' },
            { status: 500 }
          )
        }

        // Get customer ID from retrieved subscription
        const customerId = fullSubscription.customer as string

        // TEMPLATE CODE: Resolve user_id using multiple fallback strategies
        // (a) subscription.metadata.supabase_user_id if present
        // (b) stripe_customers mapping by stripe_customer_id
        // (c) existing subscriptions row by stripe_customer_id or by stripe_subscription_id
        let userId: string | null = null

        // Strategy (a): Check metadata (if present)
        if (fullSubscription.metadata?.supabase_user_id) {
          userId = fullSubscription.metadata.supabase_user_id
        }

        // Strategy (b): Query stripe_customers table
        if (!userId && customerId) {
          const { data: customerMapping } = await supabaseAdmin
            .from('stripe_customers')
            .select('user_id')
            .eq('stripe_customer_id', customerId)
            .single()

          if (customerMapping?.user_id) {
            userId = customerMapping.user_id
          }
        }

        // Strategy (c): Fallback to existing subscription record
        if (!userId) {
          // Try by stripe_subscription_id first (most specific)
          const { data: existingBySub } = await supabaseAdmin
            .from('subscriptions')
            .select('user_id')
            .eq('stripe_subscription_id', subscriptionId)
            .single()

          if (existingBySub?.user_id) {
            userId = existingBySub.user_id
          } else {
            // Try by stripe_customer_id as fallback
            const { data: existingByCustomer } = await supabaseAdmin
              .from('subscriptions')
              .select('user_id')
              .eq('stripe_customer_id', customerId)
              .single()

            if (existingByCustomer?.user_id) {
              userId = existingByCustomer.user_id
            }
          }
        }

        // If user_id still not found, return 200 and log warning (don't attempt DB write)
        if (!userId) {
          console.warn('[webhook] customer.subscription.updated: user_id not resolved', {
            handler: 'customer.subscription.updated',
            customer_id: customerId,
            subscription_id: subscriptionId,
          })
          return NextResponse.json({ received: true })
        }

        // Get period end from retrieved subscription (unix seconds)
        // Type assertion needed because Stripe SDK types may not expose this field directly
        const periodEnd = (fullSubscription as any).current_period_end as number | null | undefined

        // Convert unix seconds to ISO string (or null if undefined/null)
        const currentPeriodEnd = periodEnd
          ? new Date(periodEnd * 1000).toISOString()
          : null

        const periodEndSet = currentPeriodEnd !== null

        // Upsert subscription record using service role (bypasses RLS)
        // Keyed by user_id (primary key) to update the same row created by checkout.session.completed
        const { error: upsertError } = await supabaseAdmin
          .from('subscriptions')
          .upsert(
            {
              user_id: userId,
              stripe_subscription_id: subscriptionId,
              stripe_customer_id: customerId,
              status: fullSubscription.status,
              current_period_end: currentPeriodEnd,
            },
            {
              onConflict: 'user_id',
            }
          )

        if (upsertError) {
          console.error('[webhook] customer.subscription.updated: upsert failed', {
            handler: 'customer.subscription.updated',
            error: upsertError.message,
            user_id: userId,
            subscription_id: subscriptionId,
            customer_id: customerId,
          })
          return NextResponse.json(
            { error: 'Failed to update subscription record' },
            { status: 500 }
          )
        }

        // Also upsert stripe_customers mapping if customer ID is present
        if (customerId) {
          const { error: mappingError } = await supabaseAdmin
            .from('stripe_customers')
            .upsert(
              {
                stripe_customer_id: customerId,
                user_id: userId,
              },
              {
                onConflict: 'stripe_customer_id',
              }
            )

          if (mappingError) {
            console.warn('[webhook] customer.subscription.updated: Failed to upsert customer mapping', {
              error: mappingError.message,
              customer_id: customerId,
              user_id: userId,
            })
          }
        }

        // Single structured log line per handler
        console.log('[webhook] customer.subscription.updated', {
          handler: 'customer.subscription.updated',
          user_id: userId,
          subscription_id: subscriptionId,
          customer_id: customerId,
          period_end_set: periodEndSet,
        })

        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription

        console.log('[webhook] customer.subscription.deleted', {
          subscription_id: subscription.id,
          customer_id: subscription.customer,
        })

        // Update subscription status to cancelled using service role (bypasses RLS)
        // Note: This only updates existing records, so user_id resolution not needed
        const { data: updateData, error: updateError } = await supabaseAdmin
          .from('subscriptions')
          .update({
            status: 'canceled',
          })
          .eq('stripe_subscription_id', subscription.id)
          .select()

        if (updateError) {
          console.error('[webhook] update failed', {
            table: 'subscriptions',
            error: updateError.message,
            subscription_id: subscription.id,
          })
          return NextResponse.json(
            { error: 'Failed to cancel subscription' },
            { status: 500 }
          )
        }

        console.log('[webhook] update ok', {
          table: 'subscriptions',
          subscription_id: subscription.id,
          updated: updateData ? 'yes' : 'no',
        })

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

// Route segment config: ensure we get raw body for webhook  verification
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
