import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { stripe } from '@/lib/stripe'
import {
  appendPrivacyEvent,
  createPrivacyRequest,
  getAuthenticatedContext,
  hasRecentSession,
} from '@/lib/privacy-service'
import { getErasureAuditActions } from '@/lib/privacy-utils.js'

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
  let erasureRequestId: string | null = null

  try {
    const requestedWith = request.headers.get('x-requested-with')
    if (!isSameOrigin(request) || requestedWith !== 'XMLHttpRequest') {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }

    const auth = await getAuthenticatedContext()
    if (!auth.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!hasRecentSession(auth.session?.access_token)) {
      return NextResponse.json(
        { error: 'Recent sign-in required. Please sign in again and retry.' },
        { status: 403 }
      )
    }

    const supabase = await createServerSupabaseClient()
    const user = auth.user

    console.log(`${handler} start`, { user_id: user.id })
    const erasureActions = getErasureAuditActions()

    const erasureRequest = await createPrivacyRequest({
      userId: user.id,
      type: 'ERASURE',
      status: 'VERIFYING',
      details: {
        source: 'account_delete_endpoint',
      },
    })
    erasureRequestId = erasureRequest.id

    await appendPrivacyEvent({
      requestId: erasureRequest.id,
      actorUserId: user.id,
      actorRole: 'user',
      action: erasureActions[0],
    })

    await supabaseAdmin
      .from('privacy_requests')
      .update({ status: 'IN_PROGRESS' })
      .eq('id', erasureRequest.id)

    await appendPrivacyEvent({
      requestId: erasureRequest.id,
      actorUserId: user.id,
      actorRole: 'system',
      action: erasureActions[1],
    })

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
      } catch (error: unknown) {
        const message =
          typeof error === 'object' && error !== null && 'message' in error
            ? String((error as { message?: unknown }).message ?? '').toLowerCase()
            : ''
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

    const { error: supportTicketsDeleteError } = await supabaseAdmin
      .from('support_tickets')
      .delete()
      .eq('user_id', user.id)
    if (supportTicketsDeleteError) {
      console.error(`${handler} support_tickets_delete_failed`, { user_id: user.id })
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

    if (erasureRequestId) {
      await supabaseAdmin
        .from('privacy_requests')
        .update({
          status: 'FULFILLED',
          fulfilled_at: new Date().toISOString(),
        })
        .eq('id', erasureRequestId)

      await appendPrivacyEvent({
        requestId: erasureRequestId,
        actorUserId: user.id,
        actorRole: 'system',
        action: erasureActions[2],
      })
    }

    await supabase.auth.signOut()

    console.log(`${handler} success`, { user_id: user.id })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch {
    if (erasureRequestId) {
      await supabaseAdmin
        .from('privacy_requests')
        .update({
          status: 'DENIED',
          denial_reason: 'Automated erasure flow failed before completion',
        })
        .eq('id', erasureRequestId)
    }

    console.error(`${handler} unexpected_error`, { user_id: 'unknown' })
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
  }
}
