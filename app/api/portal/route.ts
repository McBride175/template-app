/**
 * API Route: Create Stripe Customer Portal Session
 *
 * TEMPLATE CODE: Authenticated users can open their Stripe Customer Portal.
 * Uses stripe_customer_id from subscriptions table.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { stripe } from '@/lib/stripe'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single()

    if (subError && subError.code !== 'PGRST116') {
      console.error('[portal] Failed to read subscription', {
        error: subError.message,
        code: subError.code,
        user_id: user.id,
      })
      return NextResponse.json(
        { error: 'Failed to load subscription' },
        { status: 500 }
      )
    }

    const customerId = subscription?.stripe_customer_id
    if (!customerId) {
      return NextResponse.json(
        { error: 'No Stripe customer on file' },
        { status: 404 }
      )
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${request.nextUrl.origin}/account`,
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('[portal] Failed to create portal session', error)
    return NextResponse.json(
      { error: 'Failed to create portal session' },
      { status: 500 }
    )
  }
}
