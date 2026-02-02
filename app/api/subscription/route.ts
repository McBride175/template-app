/**
 * API Route: Get Current User's Subscription Status
 * 
 * TEMPLATE CODE: This endpoint returns the current user's subscription status.
 * Uses Supabase session cookies for authentication in Next.js App Router.
 * 
 * Usage:
 * GET /api/subscription
 * 
 * Returns: { hasActive: boolean, status: string | null, current_period_end: string | null }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function GET(request: NextRequest) {
  try {
    // TEMPLATE CODE: Create Supabase client in route handler with request/response cookies
    // Collect cookies that need to be set during auth refresh
    const cookiesToSet: Array<{ name: string; value: string; options?: any }> = []

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSetArray) {
            // Collect cookies that need to be set on the response
            cookiesToSetArray.forEach(({ name, value, options }) => {
              request.cookies.set(name, value)
              cookiesToSet.push({ name, value, options })
            })
          },
        },
      }
    )

    // Authenticate user via session cookies
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      const res = NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
      res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
      res.headers.set('Pragma', 'no-cache')
      res.headers.set('Expires', '0')
      // Set any cookies that were collected during auth attempt
      cookiesToSet.forEach(({ name, value, options }) => {
        res.cookies.set(name, value, options)
      })
      return res
    }

    // Query subscriptions table for current user
    // TEMPLATE CODE: Use ANON key with RLS - reads should work for logged-in user
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('status, current_period_end, stripe_customer_id, stripe_subscription_id, stripe_price_id')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()

    if (subError && subError.code !== 'PGRST116') {
      // PGRST116 is "not found" - that's fine, user just doesn't have a subscription
      // Return 500 with error details for debugging
      console.error('Error querying subscriptions:', subError)
      const res = NextResponse.json(
        {
          error: 'Failed to query subscription status',
          supabase_error: {
            message: subError.message,
            code: subError.code,
            details: subError.details,
            hint: subError.hint,
          },
        },
        { status: 500 }
      )
      // Set cache headers
      res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
      res.headers.set('Pragma', 'no-cache')
      res.headers.set('Expires', '0')
      // Set any cookies that were collected during auth refresh
      cookiesToSet.forEach(({ name, value, options }) => {
        res.cookies.set(name, value, options)
      })
      return res
    }

    // Determine if subscription is active
    // hasActive = status in ['active','trialing'] AND (current_period_end is null OR current_period_end > now)
    const activeStatuses = ['active', 'trialing']
    const now = new Date()
    const isActive = subscription
      ? activeStatuses.includes(subscription.status) &&
        (subscription.current_period_end === null ||
          new Date(subscription.current_period_end) > now)
      : false

    // DB field: stripe_price_id; env vars: STRIPE_PRICE_ID_BASIC/PRO (comma-separated)
    const priceId = subscription?.stripe_price_id ?? null
    const basicList = (process.env.STRIPE_PRICE_ID_BASIC ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
    const proList = (process.env.STRIPE_PRICE_ID_PRO ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)

    // Backward compatible: if a single value was set, it still works via the list
    const plan =
      priceId && proList.includes(priceId)
        ? 'pro'
        : priceId && basicList.includes(priceId)
          ? 'basic'
          : null

    // Create JSON response with subscription data
    const res = NextResponse.json(
      {
        hasActive: isActive,
        status: subscription?.status ?? null,
        current_period_end: subscription?.current_period_end ?? null,
        plan,
      },
      { status: 200 }
    )

    // Set any cookies that were collected during auth refresh
    cookiesToSet.forEach(({ name, value, options }) => {
      res.cookies.set(name, value, options)
    })

    // Prevent caching of subscription status
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.headers.set('Pragma', 'no-cache')
    res.headers.set('Expires', '0')

    return res
  } catch (error: any) {
    console.error('Error getting subscription status:', error)
    const res = NextResponse.json(
      { error: 'Failed to get subscription status' },
      { status: 500 }
    )
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.headers.set('Pragma', 'no-cache')
    res.headers.set('Expires', '0')
    return res
  }
}
