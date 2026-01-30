/**
 * API Route: Get Current User's Subscription Status
 * 
 * TEMPLATE CODE: This endpoint returns the current user's subscription status.
 * 
 * Usage:
 * GET /api/subscription
 * 
 * Returns: { hasActive: boolean, status: string | null, current_period_end: string | null }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerUser, createServerSupabaseClient } from '@/lib/supabase-server'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: NextRequest) {
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

    return NextResponse.json({
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
  } catch (error: any) {
    console.error('Error getting subscription status:', error)
    return NextResponse.json(
      { error: 'Failed to get subscription status' },
      { status: 500 }
    )
  }
}
