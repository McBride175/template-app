import { NextRequest, NextResponse } from 'next/server'
import {
  canAccessRequest,
  createPrivacyAdminClient,
  getAuthenticatedContext,
  hasRecentSession,
  isAdminUser,
} from '@/lib/privacy-service'
import { signExportToken } from '@/lib/privacy-utils.mjs'

type Params = {
  params: Promise<{ exportId: string }>
}

const DOWNLOAD_URL_TTL_SECONDS = 10 * 60

function getExportSigningSecret() {
  return process.env.PRIVACY_EXPORT_SIGNING_SECRET ?? process.env.RETENTION_CRON_SECRET ?? ''
}

export async function GET(request: NextRequest, { params }: Params) {
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

  const secret = getExportSigningSecret()
  if (!secret) {
    return NextResponse.json(
      { error: 'Export signing secret is not configured' },
      { status: 500 }
    )
  }

  const { exportId } = await params
  const admin = createPrivacyAdminClient()
  const isAdmin = isAdminUser(auth.user.email)

  const { data: exportRow, error } = await admin
    .from('privacy_exports')
    .select('id, user_id, expires_at')
    .eq('id', exportId)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Failed to load export' }, { status: 500 })
  }

  if (!exportRow || !canAccessRequest(auth.user.id, exportRow.user_id, isAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (new Date(exportRow.expires_at).getTime() <= Date.now()) {
    await admin.from('privacy_exports').delete().eq('id', exportId)
    return NextResponse.json({ error: 'Export has expired' }, { status: 410 })
  }

  const signedUntilMs = Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000
  const token = signExportToken({
    userId: auth.user.id,
    exportId,
    expiresAt: signedUntilMs,
    secret,
  })

  const downloadUrl = new URL(`/api/privacy/export/${exportId}/download`, request.nextUrl.origin)
  downloadUrl.searchParams.set('token', token)

  return NextResponse.json({
    exportId,
    status: 'ready',
    expiresAt: exportRow.expires_at,
    downloadUrl: downloadUrl.toString(),
    downloadUrlExpiresAt: new Date(signedUntilMs).toISOString(),
  })
}
