import { NextRequest, NextResponse } from 'next/server'
import {
  canAccessRequest,
  createPrivacyAdminClient,
  getAuthenticatedContext,
  isAdminUser,
  withOverdue,
} from '@/lib/privacy-service'

type Params = {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await getAuthenticatedContext()
  if (!auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const admin = createPrivacyAdminClient()
  const isAdmin = isAdminUser(auth.user.email)

  const { data: requestRow, error: requestError } = await admin
    .from('privacy_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (requestError) {
    return NextResponse.json({ error: 'Failed to load request' }, { status: 500 })
  }

  if (!requestRow || !canAccessRequest(auth.user.id, requestRow.user_id, isAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: events, error: eventsError } = await admin
    .from('privacy_request_events')
    .select('id, actor_user_id, actor_role, action, note, created_at')
    .eq('request_id', id)
    .order('created_at', { ascending: true })

  if (eventsError) {
    return NextResponse.json({ error: 'Failed to load request events' }, { status: 500 })
  }

  return NextResponse.json({
    request: withOverdue(requestRow),
    events: events ?? [],
  })
}
