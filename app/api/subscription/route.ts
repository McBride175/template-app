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
    // This allows reading cookies from the request and setting them on the response
    let response = NextResponse.next()

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            // Set cookies on the response
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set(name, value)
              response.cookies.set(name, value, options)
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
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Query subscriptions table for current user
    // TEMPLATE CODE: Use ANON key with RLS - reads should work for logged-in user
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('status, current_period_end, stripe_customer_id, stripe_subscription_id')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()

    if (subError && subError.code !== 'PGRST116') {
      // PGRST116 is "not found" - that's fine, user just doesn't have a subscription
      // Return 500 with error details for debugging
      console.error('Error querying subscriptions:', subError)
      const errorResponse = NextResponse.json(
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
      errorResponse.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
      errorResponse.headers.set('Pragma', 'no-cache')
      errorResponse.headers.set('Expires', '0')
      return errorResponse
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

    // Create JSON response with subscription data
    // Cookies are already set on response via setAll callback during auth.getUser()
    const jsonResponse = NextResponse.json(
      {
        hasActive: isActive,
        status: subscription?.status ?? null,
        current_period_end: subscription?.current_period_end ?? null,
      },
      {
        headers: response.headers,
      }
    )

    // Copy cookies from response (set during auth refresh)
    response.cookies.getAll().forEach((cookie) => {
      jsonResponse.cookies.set(cookie.name, cookie.value)
    })

    // Prevent caching of subscription status
    jsonResponse.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    jsonResponse.headers.set('Pragma', 'no-cache')
    jsonResponse.headers.set('Expires', '0')

    return jsonResponse
  } catch (error: any) {
    console.error('Error getting subscription status:', error)
    return NextResponse.json(
      { error: 'Failed to get subscription status' },
      { status: 500 }
    )
  }
}
