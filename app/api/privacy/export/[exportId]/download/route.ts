import { NextRequest, NextResponse } from 'next/server'
import {
  canAccessRequest,
  createPrivacyAdminClient,
  getAuthenticatedContext,
  hasRecentSession,
  isAdminUser,
} from '@/lib/privacy-service'
import { verifyExportToken } from '@/lib/privacy-utils.mjs'

type Params = {
  params: Promise<{ exportId: string }>
}

function getExportSigningSecret() {
  return process.env.PRIVACY_EXPORT_SIGNING_SECRET ?? process.env.RETENTION_CRON_SECRET ?? ''
}

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await getAuthenticatedContext()
  if (!auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const isAdmin = isAdminUser(auth.user.email)

  if (!hasRecentSession(auth.session?.access_token)) {
    return NextResponse.json(
      { error: 'Recent sign-in required. Please sign in again and retry.' },
      { status: 403 }
    )
  }

  const token = request.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }

  const secret = getExportSigningSecret()
  if (!secret) {
    return NextResponse.json(
      { error: 'Export signing secret is not configured' },
      { status: 500 }
    )
  }

  const payload = verifyExportToken({ token, secret })
  if (!payload || payload.exp < Date.now()) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }

  const { exportId } = await params
  if (payload.exportId !== exportId) {
    return NextResponse.json({ error: 'Invalid token payload' }, { status: 401 })
  }

  if (!isAdmin && payload.userId !== auth.user.id) {
    return NextResponse.json({ error: 'Invalid token payload' }, { status: 401 })
  }

  const admin = createPrivacyAdminClient()

  const { data: exportRow, error } = await admin
    .from('privacy_exports')
    .select('id, user_id, export_json, expires_at')
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

  await admin
    .from('privacy_exports')
    .update({ downloaded_at: new Date().toISOString() })
    .eq('id', exportId)

  return new NextResponse(JSON.stringify(exportRow.export_json, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="privacy-export-${exportId}.json"`,
      'Cache-Control': 'no-store',
    },
  })
}
