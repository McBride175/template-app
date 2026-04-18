import { NextRequest, NextResponse } from 'next/server'
import { consumeRateLimit } from '@/lib/rate-limit'
import {
  appendPrivacyEvent,
  createPrivacyAdminClient,
  createPrivacyRequest,
  getAuthenticatedContext,
  withOverdue,
  type PrivacyRequestType,
} from '@/lib/privacy-service'
import { isPrivacyRequestType } from '@/lib/privacy-utils.js'

type RequestBody = {
  type?: string
  message?: string
  rectify?: Record<string, unknown>
  restriction?: Record<string, unknown>
  objection?: Record<string, unknown>
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedContext()
  if (!auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rate = consumeRateLimit(`privacy:requests:create:${auth.user.id}`, 10, 60_000)
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const payload = (await request.json().catch(() => null)) as RequestBody | null
  if (!payload?.type || !isPrivacyRequestType(payload.type)) {
    return NextResponse.json({ error: 'Invalid request type' }, { status: 400 })
  }
  const requestType = payload.type as PrivacyRequestType

  const details = {
    message: typeof payload.message === 'string' ? payload.message : null,
    rectify: payload.rectify ?? null,
    restriction: payload.restriction ?? null,
    objection: payload.objection ?? null,
  }

  try {
    const created = await createPrivacyRequest({
      userId: auth.user.id,
      type: requestType,
      status: 'RECEIVED',
      details,
    })

    await appendPrivacyEvent({
      requestId: created.id,
      actorUserId: auth.user.id,
      actorRole: 'user',
      action: 'REQUEST_CREATED',
      note: details.message ?? undefined,
    })

    return NextResponse.json({ request: withOverdue(created) }, { status: 201 })
  } catch (error) {
    console.error('[privacy.requests.create] failed', {
      user_id: auth.user.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ error: 'Failed to create privacy request' }, { status: 500 })
  }
}

export async function GET() {
  const auth = await getAuthenticatedContext()
  if (!auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createPrivacyAdminClient()
  try {
    const { data, error } = await admin
      .from('privacy_requests')
      .select('*')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw error

    return NextResponse.json({
      requests: (data ?? []).map((row) => withOverdue(row)),
    })
  } catch (error) {
    console.error('[privacy.requests.list] failed', {
      user_id: auth.user.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ error: 'Failed to list privacy requests' }, { status: 500 })
  }
}
