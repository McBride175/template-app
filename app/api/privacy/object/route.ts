import { NextRequest, NextResponse } from 'next/server'
import { applyObjectionFlags } from '@/lib/privacy-utils.js'
import { consumeRateLimit } from '@/lib/rate-limit'
import {
  appendPrivacyEvent,
  createPrivacyRequest,
  getAuthenticatedContext,
  getPrivacyPreferences,
  upsertPrivacyPreferences,
  withOverdue,
} from '@/lib/privacy-service'

type ObjectionPayload = {
  message?: string
  marketing?: boolean
  analytics?: boolean
  ai?: boolean
  restrictProcessing?: boolean
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedContext()
  if (!auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rate = consumeRateLimit(`privacy:object:${auth.user.id}`, 8, 60_000)
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const payload = (await request.json().catch(() => ({}))) as ObjectionPayload

  try {
    const current = await getPrivacyPreferences(auth.user.id)
    const flags = applyObjectionFlags(current, payload)

    await upsertPrivacyPreferences({
      userId: auth.user.id,
      processing_restricted: flags.processing_restricted,
      marketing_opt_out: flags.marketing_opt_out,
      analytics_opt_out: flags.analytics_opt_out,
      ai_processing_opt_out: flags.ai_processing_opt_out,
    })

    const requestRow = await createPrivacyRequest({
      userId: auth.user.id,
      type: 'OBJECTION',
      status: 'FULFILLED',
      fulfilledAt: new Date().toISOString(),
      details: {
        message: payload.message ?? null,
        flags,
      },
    })

    await appendPrivacyEvent({
      requestId: requestRow.id,
      actorUserId: auth.user.id,
      actorRole: 'user',
      action: 'OBJECTION_REQUEST_CREATED',
      note: payload.message,
    })

    await appendPrivacyEvent({
      requestId: requestRow.id,
      actorUserId: auth.user.id,
      actorRole: 'system',
      action: 'OBJECTION_APPLIED',
    })

    return NextResponse.json({ request: withOverdue(requestRow), flags })
  } catch (error) {
    console.error('[privacy.object] failed', {
      user_id: auth.user.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ error: 'Failed to process objection' }, { status: 500 })
  }
}
