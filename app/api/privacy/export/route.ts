import { NextResponse } from 'next/server'
import { buildUserExportBundle } from '@/lib/privacy-export'
import { consumeRateLimit } from '@/lib/rate-limit'
import {
  appendPrivacyEvent,
  createPrivacyAdminClient,
  createPrivacyRequest,
  getAuthenticatedContext,
  hasRecentSession,
} from '@/lib/privacy-service'

const EXPORT_TTL_DAYS = 7

export async function POST() {
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

  const rate = consumeRateLimit(`privacy:export:create:${auth.user.id}`, 3, 60_000)
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const admin = createPrivacyAdminClient()

  try {
    const { error: cleanupError } = await admin
      .from('privacy_exports')
      .delete()
      .eq('user_id', auth.user.id)
      .lt('expires_at', new Date().toISOString())

    if (cleanupError) {
      console.warn('[privacy.export.cleanup] failed', {
        user_id: auth.user.id,
        error: cleanupError.message,
      })
    }

    const { data: existingRequest } = await admin
      .from('privacy_requests')
      .select('*')
      .eq('user_id', auth.user.id)
      .eq('type', 'ACCESS_EXPORT')
      .in('status', ['RECEIVED', 'VERIFYING', 'IN_PROGRESS'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const request =
      existingRequest ??
      (await createPrivacyRequest({
        userId: auth.user.id,
        type: 'ACCESS_EXPORT',
        status: 'IN_PROGRESS',
        details: {
          source: 'privacy_export_endpoint',
        },
      }))

    if (!existingRequest) {
      await appendPrivacyEvent({
        requestId: request.id,
        actorUserId: auth.user.id,
        actorRole: 'user',
        action: 'ACCESS_EXPORT_REQUEST_CREATED',
      })
    }

    const exportBundle = await buildUserExportBundle(auth.user.id)
    const now = new Date()
    const expiresAt = new Date(now.getTime() + EXPORT_TTL_DAYS * 24 * 60 * 60 * 1000)

    const { data: exportRow, error: exportError } = await admin
      .from('privacy_exports')
      .insert({
        user_id: auth.user.id,
        request_id: request.id,
        path: `exports/${auth.user.id}/${crypto.randomUUID()}.json`,
        export_json: exportBundle,
        expires_at: expiresAt.toISOString(),
      })
      .select('id, expires_at')
      .single()

    if (exportError) {
      throw exportError
    }

    const fulfilledAt = new Date().toISOString()

    const { error: requestUpdateError } = await admin
      .from('privacy_requests')
      .update({
        status: 'FULFILLED',
        fulfilled_at: fulfilledAt,
        details: {
          ...(request.details ?? {}),
          export_id: exportRow.id,
          export_expires_at: exportRow.expires_at,
        },
      })
      .eq('id', request.id)

    if (requestUpdateError) {
      throw requestUpdateError
    }

    await appendPrivacyEvent({
      requestId: request.id,
      actorUserId: auth.user.id,
      actorRole: 'system',
      action: 'ACCESS_EXPORT_GENERATED',
      note: `export_id=${exportRow.id}`,
    })

    return NextResponse.json({
      requestId: request.id,
      exportId: exportRow.id,
      status: 'FULFILLED',
    })
  } catch (error) {
    console.error('[privacy.export.create] failed', {
      user_id: auth.user.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ error: 'Failed to generate export' }, { status: 500 })
  }
}
