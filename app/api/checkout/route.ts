/**
 * API Route: Create Stripe Checkout Session
 * 
 * TEMPLATE CODE: This endpoint creates a Stripe Checkout session for subscription.
 * 
 * Usage:
 * POST /api/checkout
 * 
 * Returns: { url: string } - The Stripe Checkout URL to redirect to
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerUser, createServerSupabaseClient } from '@/lib/supabase-server'
import { stripe } from '@/lib/stripe'
import { createClient } from '@supabase/supabase-js'

// Use service role key for stripe_customers table writes (bypasses RLS)
// TEMPLATE CODE: Checkout needs elevated permissions to write customer mapping
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
  try {
    // Get authenticated user
    // TEMPLATE CODE: Support both Bearer token (from client) and cookies (fallback)
    // Check for Authorization header first (explicit Bearer token auth)
    const authHeader = request.headers.get('authorization')
    let user

    if (authHeader?.startsWith('Bearer ')) {
      // Extract token from Authorization header
      const token = authHeader.substring(7)
      
      // Verify token and get user
      // TEMPLATE CODE: Create a Supabase client to verify the Bearer token
      // This is separate from cookie-based auth to support explicit token auth
      const supabaseForToken = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          global: {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        }
      )

      const { data: { user: tokenUser }, error } = await supabaseForToken.auth.getUser()
      
      if (error || !tokenUser) {
        return NextResponse.json(
          { error: 'Invalid or expired token' },
          { status: 401 }
        )
      }
      
      user = tokenUser
    } else {
      // Fallback to cookie-based auth (for backward compatibility)
      user = await getServerUser()
    }

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get Supabase client for database operations
    const supabase = await createServerSupabaseClient()

    // Check if user already has a subscription
    const { data: existingSubscription } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id, status')
      .eq('user_id', user.id)
      .single()

    let customerId = existingSubscription?.stripe_customer_id
    let customerResolution = 'subscription_row'

    const isActiveOrTrialing =
      existingSubscription?.status === 'active' ||
      existingSubscription?.status === 'trialing'

    if (isActiveOrTrialing) {
      if (!customerId) {
        return NextResponse.json(
          { error: 'stripe_customer_id missing for active subscription' },
          { status: 500 }
        )
      }

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${request.nextUrl.origin}/dashboard`,
      })

      console.log('[checkout] sent_to_billing_portal', {
        user_id: user.id,
        customer_id: customerId,
      })

      return NextResponse.json({ url: portalSession.url })
    }

    // If no customer from subscriptions, try stripe_customers mapping
    if (!customerId) {
      const { data: customerMappings, error: mappingError } = await supabaseAdmin
        .from('stripe_customers')
        .select('stripe_customer_id, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (mappingError) {
        console.warn('[checkout] stripe_customers lookup failed', {
          user_id: user.id,
          error: mappingError.message,
        })
      } else if (customerMappings && customerMappings.length > 0) {
        customerId = customerMappings[0].stripe_customer_id
        customerResolution = 'stripe_customers'

        if (customerMappings.length > 1) {
          console.warn('[checkout] multiple stripe_customers rows', {
            user_id: user.id,
            count: customerMappings.length,
          })
        }
      } else {
        customerResolution = 'none'
      }
    }

    console.log('[checkout] customer_resolution', {
      user_id: user.id,
      customer_id: customerId ?? null,
      source: customerResolution,
    })

    // Create Stripe customer if doesn't exist
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          supabase_user_id: user.id,
        },
      })
      customerId = customer.id
      customerResolution = 'stripe_create'
    }

    // TEMPLATE CODE: Upsert customer mapping to enable webhook user_id resolution
    // This ensures customer.subscription.* events can find user_id even without metadata
    const { error: mappingError } = await supabaseAdmin
      .from('stripe_customers')
      .upsert(
        {
          stripe_customer_id: customerId,
          user_id: user.id,
        },
        {
          onConflict: 'stripe_customer_id',
        }
      )

    if (mappingError) {
      console.error('[checkout] Failed to upsert customer mapping', {
        error: mappingError.message,
        customer_id: customerId,
        user_id: user.id,
      })
      // Don't fail checkout if mapping fails - webhook can still use metadata
    } else {
      console.log('[checkout] Customer mapping created/updated', {
        customer_id: customerId,
        user_id: user.id,
      })
    }

    const body = await request.json().catch(() => ({}))
    const plan = body?.plan

    const priceId =
      plan === 'basic'
        ? process.env.STRIPE_PRICE_ID_BASIC
        : plan === 'pro'
          ? process.env.STRIPE_PRICE_ID_PRO
          : null

    if (!plan || !priceId) {
      return NextResponse.json(
        { error: 'Invalid or missing plan. Use plan=basic or plan=pro.' },
        { status: 400 }
      )
    }

    // OPTIONAL EXTRA — environment consistency check
const secret = process.env.STRIPE_SECRET_KEY

if (secret?.startsWith('sk_live_') && priceId.includes('test')) {
  return NextResponse.json(
    { error: 'Live Stripe key is being used with a test-mode price.' },
    { status: 500 }
  )
}
    // Create Checkout Session
    // Use resolved Stripe price ID so idempotency keys stay unique per actual checkout params.
    const idempotencyKey = `checkout:${user.id}:${priceId}`

    const session = await stripe.checkout.sessions.create(
      {
        customer: customerId,
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: `${request.nextUrl.origin}/dashboard?checkout=success`,
        cancel_url: `${request.nextUrl.origin}/dashboard?checkout=cancelled`,
        metadata: {
          supabase_user_id: user.id,
          plan,
        },
      },
      { idempotencyKey }
    )

    console.log('[checkout] idempotency', {
      user_id: user.id,
      idempotency_key: idempotencyKey,
    })

    console.log('[checkout] created_checkout_session', {
      user_id: user.id,
      customer_id: customerId,
      plan,
    })

    return NextResponse.json({ url: session.url })
  } catch (error: unknown) {
    console.error('Error creating checkout session:', error)

    // Debug output only in non-production environments
    const debug =
      process.env.VERCEL_ENV !== 'production'
        ? {
            VERCEL_ENV: process.env.VERCEL_ENV,
            STRIPE_SECRET_KEY_prefix: (process.env.STRIPE_SECRET_KEY ?? '').slice(0, 8),
            STRIPE_PRICE_ID_PRO: process.env.STRIPE_PRICE_ID_PRO,
            VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
          }
        : undefined

    return NextResponse.json(
      {
        error: 'Failed to create checkout session',
        ...(debug && { debug }),
      },
      { status: 500 }
    )
  }
}
