import { NextRequest, NextResponse } from 'next/server'
import { consumeRateLimit } from '@/lib/rate-limit'
import {
  appendPrivacyEvent,
  createPrivacyAdminClient,
  createPrivacyRequest,
  getAuthenticatedContext,
  getPrivacyPreferences,
  upsertPrivacyPreferences,
  withOverdue,
} from '@/lib/privacy-service'

type RectifyPayload = {
  field?: string
  value?: unknown
  message?: string
}

const SELF_SERVE_FIELDS = new Set(['marketing_opt_out', 'analytics_opt_out', 'ai_processing_opt_out'])

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedContext()
  if (!auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rate = consumeRateLimit(`privacy:rectify:${auth.user.id}`, 8, 60_000)
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const payload = (await request.json().catch(() => null)) as RectifyPayload | null
  const field = payload?.field

  if (!field || typeof field !== 'string') {
    return NextResponse.json({ error: 'field is required' }, { status: 400 })
  }

  const value = payload?.value
  const isSelfServeField = SELF_SERVE_FIELDS.has(field) && typeof value === 'boolean'

  try {
    const requestRow = await createPrivacyRequest({
      userId: auth.user.id,
      type: 'RECTIFICATION',
      status: isSelfServeField ? 'FULFILLED' : 'IN_PROGRESS',
      details: {
        field,
        value,
        message: payload?.message ?? null,
      },
      fulfilledAt: isSelfServeField ? new Date().toISOString() : null,
    })

    await appendPrivacyEvent({
      requestId: requestRow.id,
      actorUserId: auth.user.id,
      actorRole: 'user',
      action: 'RECTIFICATION_REQUEST_CREATED',
      note: `field=${field}`,
    })

    if (isSelfServeField) {
      const current = await getPrivacyPreferences(auth.user.id)
      await upsertPrivacyPreferences({
        userId: auth.user.id,
        processing_restricted: Boolean(current.processing_restricted),
        marketing_opt_out:
          field === 'marketing_opt_out' ? (value as boolean) : Boolean(current.marketing_opt_out),
        analytics_opt_out:
          field === 'analytics_opt_out' ? (value as boolean) : Boolean(current.analytics_opt_out),
        ai_processing_opt_out:
          field === 'ai_processing_opt_out' ? (value as boolean) : Boolean(current.ai_processing_opt_out),
      })

      await appendPrivacyEvent({
        requestId: requestRow.id,
        actorUserId: auth.user.id,
        actorRole: 'system',
        action: 'RECTIFICATION_AUTO_FULFILLED',
        note: `field=${field}`,
      })
    }

    const admin = createPrivacyAdminClient()
    const { data: latest } = await admin
      .from('privacy_requests')
      .select('*')
      .eq('id', requestRow.id)
      .single()

    return NextResponse.json({ request: withOverdue(latest ?? requestRow) }, { status: 201 })
  } catch (error) {
    console.error('[privacy.rectify] failed', {
      user_id: auth.user.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ error: 'Failed to create rectification request' }, { status: 500 })
  }
}
