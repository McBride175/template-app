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

    // Create Stripe customer if doesn't exist
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          supabase_user_id: user.id,
        },
      })
      customerId = customer.id
    }

    // Get the price ID from environment variable
    // APP-SPECIFIC: Replace with your actual Stripe Price ID
    const priceId = process.env.STRIPE_PRICE_ID
    if (!priceId) {
      return NextResponse.json(
        { error: 'STRIPE_PRICE_ID not configured' },
        { status: 500 }
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

if (secret?.startsWith('sk_test_') && !priceId.includes('test')) {
  return NextResponse.json(
    { error: 'Test Stripe key is being used with a live-mode price.' },
    { status: 500 }
  )
}
    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
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
      },
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('Error creating checkout session:', error)
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    )
  }
}
