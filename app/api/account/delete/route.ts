import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { stripe } from '@/lib/stripe'

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

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')

  if (!origin || !host) return false

  try {
    const originHost = new URL(origin).host
    return originHost === host
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  const handler = '[account_delete]'

  try {
    const requestedWith = request.headers.get('x-requested-with')
    if (!isSameOrigin(request) || requestedWith !== 'XMLHttpRequest') {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }

    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log(`${handler} start`, { user_id: user.id })

    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_customer_id, stripe_subscription_id')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const subscriptionId = subscription?.stripe_subscription_id

    if (subscriptionId) {
      try {
        await stripe.subscriptions.update(subscriptionId, {
          cancel_at_period_end: false,
        })
        await stripe.subscriptions.cancel(subscriptionId)
      } catch (error: any) {
        const message = String(error?.message ?? '').toLowerCase()
        const alreadyCanceled =
          message.includes('no such subscription') ||
          message.includes('already canceled') ||
          message.includes('already cancelled')

        if (!alreadyCanceled) {
          console.error(`${handler} stripe_cancel_failed`, { user_id: user.id })
        }
      }
    }

    const { error: notesDeleteError } = await supabaseAdmin
      .from('notes')
      .delete()
      .eq('user_id', user.id)
    if (notesDeleteError) {
      console.error(`${handler} notes_delete_failed`, { user_id: user.id })
      return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
    }

    const { error: subscriptionsDeleteError } = await supabaseAdmin
      .from('subscriptions')
      .delete()
      .eq('user_id', user.id)
    if (subscriptionsDeleteError) {
      console.error(`${handler} subscriptions_delete_failed`, { user_id: user.id })
      return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
    }

    const { error: customersDeleteError } = await supabaseAdmin
      .from('stripe_customers')
      .delete()
      .eq('user_id', user.id)
    if (customersDeleteError) {
      console.error(`${handler} stripe_customers_delete_failed`, { user_id: user.id })
      return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
    }

    const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(user.id)
    if (deleteAuthError) {
      const userMissing = deleteAuthError.message.toLowerCase().includes('not found')
      if (!userMissing) {
        console.error(`${handler} auth_delete_failed`, { user_id: user.id })
        return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
      }
    }

    await supabase.auth.signOut()

    console.log(`${handler} success`, { user_id: user.id })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch {
    console.error(`${handler} unexpected_error`, { user_id: 'unknown' })
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
  }
}
