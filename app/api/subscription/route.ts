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
import { getServerUser, createServerSupabaseClient } from '@/lib/supabase-server'

export async function GET(request: NextRequest) {
  try {
    // TEMPLATE CODE: Authenticate via Supabase session cookies
    // Uses @supabase/ssr (createServerClient) to read cookies from Next.js headers
    const user = await getServerUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get Supabase client for database operations (uses same cookie-based session)
    const supabase = await createServerSupabaseClient()

    // Query subscriptions table for current user
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('status, current_period_end, stripe_subscription_id, stripe_customer_id')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()

    if (subError && subError.code !== 'PGRST116') {
      // PGRST116 is "not found" - that's fine, user just doesn't have a subscription
      // TEMPLATE CODE: Return Supabase error in JSON response for debugging (RLS/auth issues)
      console.error('Error querying subscriptions:', subError)
      return NextResponse.json(
        {
          error: 'Failed to query subscription status',
          supabase_error: {
            message: subError.message,
            code: subError.code,
            details: subError.details,
            hint: subError.hint,
          },
          // TODO: Remove debug object before launch - gated to non-production only
          ...(process.env.VERCEL_ENV !== 'production' && {
            debug: {
              resolved_user_id: user.id,
              row_found: false,
              error: subError.message,
            },
          }),
        },
        { status: 500 }
      )
    }

    // Determine if subscription is active
    // Active subscription statuses in Stripe
    // TEMPLATE CODE: Return hasActive=true for active/trialing even if current_period_end is null (robustness)
    const activeStatuses = ['active', 'trialing']
    const isActive = subscription
      ? activeStatuses.includes(subscription.status) &&
        (subscription.current_period_end === null ||
          new Date(subscription.current_period_end) > new Date())
      : false

    // TEMPLATE CODE: Set cache headers to prevent caching
    // Ensures fresh subscription status on every request
    const response = NextResponse.json({
      hasActive: isActive,
      status: subscription?.status ?? null,
      current_period_end: subscription?.current_period_end ?? null,
      // TODO: Remove debug object before launch - gated to non-production only
      ...(process.env.VERCEL_ENV !== 'production' && {
        debug: {
          resolved_user_id: user.id,
          row_found: !!subscription,
          stripe_subscription_id: subscription?.stripe_subscription_id ?? null,
          stripe_customer_id: subscription?.stripe_customer_id ?? null,
          ...(subError && {
            supabase_error: {
              message: subError.message,
              code: subError.code,
              details: subError.details,
              hint: subError.hint,
            },
          }),
        },
      }),
    })

    // Prevent caching of subscription status
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    response.headers.set('Pragma', 'no-cache')
    response.headers.set('Expires', '0')

    return response
  } catch (error: any) {
    console.error('Error getting subscription status:', error)
    return NextResponse.json(
      { error: 'Failed to get subscription status' },
      { status: 500 }
    )
  }
}
