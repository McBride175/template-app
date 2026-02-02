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
            handler: 'checkout.session.completed',
            session_id: session.id,
            subscription_id: session.subscription,
            customer_id: session.customer,
          })
          return NextResponse.json({ received: true })
        }

        // Get subscription ID from session
        const subscriptionId = session.subscription as string
        if (!subscriptionId) {
          console.warn('[webhook] checkout.session.completed: Missing subscription ID', {
            handler: 'checkout.session.completed',
            session_id: session.id,
            user_id: userId,
            customer_id: session.customer,
          })
          return NextResponse.json({ received: true })
        }

        // Get customer ID from session
        const customerId = session.customer as string
        if (!customerId) {
          console.warn('[webhook] checkout.session.completed: Missing customer ID', {
            handler: 'checkout.session.completed',
            session_id: session.id,
            user_id: userId,
            subscription_id: subscriptionId,
          })
          return NextResponse.json({ received: true })
        }

        // TEMPLATE CODE: First attempt UPDATE by user_id (primary key)
        // This avoids NOT NULL violations and preserves existing status/current_period_end
        const { data: updateData, error: updateError } = await supabaseAdmin
          .from('subscriptions')
          .update({
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
          })
          .eq('user_id', userId)
          .select()

        let operation = 'update'
        let dbError: any = null

        // If UPDATE affected 0 rows, try INSERT
        if (!updateError && (!updateData || updateData.length === 0)) {
          operation = 'insert'
          const { data: insertData, error: insertError } = await supabaseAdmin
            .from('subscriptions')
            .insert({
              user_id: userId,
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              status: 'pending',
              current_period_end: null,
            })
            .select()

          dbError = insertError

          // If INSERT fails due to unique constraint (e.g. stripe_subscription_id already exists)
          if (insertError && insertError.code === '23505') {
            // Try to find existing row by stripe_subscription_id or stripe_customer_id
            const { data: existingBySub } = await supabaseAdmin
              .from('subscriptions')
              .select('user_id')
              .eq('stripe_subscription_id', subscriptionId)
              .single()

            if (existingBySub?.user_id) {
              // If found by subscription_id, update it to attach correct user_id (only if safe)
              // Safety check: ensure the existing row's user_id matches or is null/empty
              if (existingBySub.user_id === userId) {
                // Same user, safe to update
                operation = 'fallback_update_by_subscription_id'
                const { error: fallbackError } = await supabaseAdmin
                  .from('subscriptions')
                  .update({
                    stripe_customer_id: customerId,
                    user_id: userId,
                  })
                  .eq('stripe_subscription_id', subscriptionId)

                dbError = fallbackError
              } else {
                // Different user_id - conflict, return 500
                console.error('[webhook] checkout.session.completed: user_id conflict', {
                  handler: 'checkout.session.completed',
                  user_id: userId,
                  subscription_id: subscriptionId,
                  customer_id: customerId,
                  existing_user_id: existingBySub.user_id,
                  operation: 'insert_fallback_failed',
                })
                return NextResponse.json(
                  { error: 'Subscription already exists for different user' },
                  { status: 500 }
                )
              }
            } else {
              // Try by customer_id
              const { data: existingByCustomer } = await supabaseAdmin
                .from('subscriptions')
                .select('user_id')
                .eq('stripe_customer_id', customerId)
                .single()

              if (existingByCustomer?.user_id) {
                if (existingByCustomer.user_id === userId) {
                  // Same user, safe to update
                  operation = 'fallback_update_by_customer_id'
                  const { error: fallbackError } = await supabaseAdmin
                    .from('subscriptions')
                    .update({
                      stripe_subscription_id: subscriptionId,
                      user_id: userId,
                    })
                    .eq('stripe_customer_id', customerId)

                  dbError = fallbackError
                } else {
                  // Different user_id - conflict, return 500
                  console.error('[webhook] checkout.session.completed: user_id conflict', {
                    handler: 'checkout.session.completed',
                    user_id: userId,
                    subscription_id: subscriptionId,
                    customer_id: customerId,
                    existing_user_id: existingByCustomer.user_id,
                    operation: 'insert_fallback_failed',
                  })
                  return NextResponse.json(
                    { error: 'Customer already exists for different user' },
                    { status: 500 }
                  )
                }
              } else {
                // No existing row found, but INSERT failed - return 500
                dbError = insertError
              }
            }
          }
        } else {
          dbError = updateError
        }

        // If any DB operation failed, return 500 so Stripe retries
        if (dbError) {
          console.error('[webhook] checkout.session.completed: DB operation failed', {
            handler: 'checkout.session.completed',
            operation,
            error: dbError.message,
            error_code: dbError.code,
            user_id: userId,
            subscription_id: subscriptionId,
            customer_id: customerId,
          })
          return NextResponse.json(
            { error: 'Failed to sync subscription record' },
            { status: 500 }
          )
        }

        // Upsert customer mapping (non-critical, log warning on failure but don't fail webhook)
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
            handler: 'checkout.session.completed',
            error: mappingError.message,
            customer_id: customerId,
            user_id: userId,
          })
        }

        // Single structured log line
        console.log('[webhook] checkout.session.completed', {
          handler: 'checkout.session.completed',
          user_id: userId,
          subscription_id: subscriptionId,
          customer_id: customerId,
          operation,
        })

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

        // TEMPLATE CODE: Resolve user_id reliably
        // 1) Try stripe_customers table mapping by stripe_customer_id
        // 2) Fallback: look up subscriptions row by stripe_subscription_id, then read its user_id
        // 3) If still missing, return 200 with warning (no DB write)
        let userId: string | null = null

        // Strategy 1: Query stripe_customers table (most reliable)
        if (customerId) {
          const { data: customerMapping } = await supabaseAdmin
            .from('stripe_customers')
            .select('user_id')
            .eq('stripe_customer_id', customerId)
            .single()

          if (customerMapping?.user_id) {
            userId = customerMapping.user_id
          }
        }

        // Strategy 2: Fallback to existing subscription record by stripe_subscription_id
        if (!userId) {
          const { data: existingBySub } = await supabaseAdmin
            .from('subscriptions')
            .select('user_id')
            .eq('stripe_subscription_id', subscriptionId)
            .single()

          if (existingBySub?.user_id) {
            userId = existingBySub.user_id
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
        const priceId = fullSubscription.items?.data?.[0]?.price?.id ?? null

        // Convert unix seconds to ISO string (or null if undefined/null)
        const currentPeriodEnd = periodEnd
          ? new Date(periodEnd * 1000).toISOString()
          : null

        const periodEndSet = currentPeriodEnd !== null

        // Update subscription record by user_id (primary key)
        // Use UPDATE preferred; if row doesn't exist, upsert will insert with all required fields
        const { data: updateData, error: updateError } = await supabaseAdmin
          .from('subscriptions')
          .update({
            stripe_subscription_id: subscriptionId,
            stripe_customer_id: customerId,
            stripe_price_id: priceId,
            status: fullSubscription.status,
            current_period_end: currentPeriodEnd,
          })
          .eq('user_id', userId)
          .select()

        // If UPDATE affected 0 rows, use upsert to insert (with all required fields)
        if (!updateError && (!updateData || updateData.length === 0)) {
          const { error: upsertError } = await supabaseAdmin
            .from('subscriptions')
            .upsert(
              {
                user_id: userId,
                stripe_subscription_id: subscriptionId,
                stripe_customer_id: customerId,
                stripe_price_id: priceId,
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
        } else if (updateError) {
          console.error('[webhook] customer.subscription.created: update failed', {
            handler: 'customer.subscription.created',
            error: updateError.message,
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

        // TEMPLATE CODE: Resolve user_id reliably
        // 1) Try stripe_customers table mapping by stripe_customer_id
        // 2) Fallback: look up subscriptions row by stripe_subscription_id, then read its user_id
        // 3) If still missing, return 200 with warning (no DB write)
        let userId: string | null = null

        // Strategy 1: Query stripe_customers table (most reliable)
        if (customerId) {
          const { data: customerMapping } = await supabaseAdmin
            .from('stripe_customers')
            .select('user_id')
            .eq('stripe_customer_id', customerId)
            .single()

          if (customerMapping?.user_id) {
            userId = customerMapping.user_id
          }
        }

        // Strategy 2: Fallback to existing subscription record by stripe_subscription_id
        if (!userId) {
          const { data: existingBySub } = await supabaseAdmin
            .from('subscriptions')
            .select('user_id')
            .eq('stripe_subscription_id', subscriptionId)
            .single()

          if (existingBySub?.user_id) {
            userId = existingBySub.user_id
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
        const priceId = fullSubscription.items?.data?.[0]?.price?.id ?? null

        // Convert unix seconds to ISO string (or null if undefined/null)
        const currentPeriodEnd = periodEnd
          ? new Date(periodEnd * 1000).toISOString()
          : null

        const periodEndSet = currentPeriodEnd !== null

        // Update subscription record by user_id (primary key)
        // Use UPDATE preferred; if row doesn't exist, upsert will insert with all required fields
        const { data: updateData, error: updateError } = await supabaseAdmin
          .from('subscriptions')
          .update({
            stripe_subscription_id: subscriptionId,
            stripe_customer_id: customerId,
            stripe_price_id: priceId,
            status: fullSubscription.status,
            current_period_end: currentPeriodEnd,
          })
          .eq('user_id', userId)
          .select()

        // If UPDATE affected 0 rows, use upsert to insert (with all required fields)
        if (!updateError && (!updateData || updateData.length === 0)) {
          const { error: upsertError } = await supabaseAdmin
            .from('subscriptions')
            .upsert(
              {
                user_id: userId,
                stripe_subscription_id: subscriptionId,
                stripe_customer_id: customerId,
                stripe_price_id: priceId,
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
        } else if (updateError) {
          console.error('[webhook] customer.subscription.updated: update failed', {
            handler: 'customer.subscription.updated',
            error: updateError.message,
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
