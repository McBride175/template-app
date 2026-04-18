import { NextRequest, NextResponse } from 'next/server'
import {
  appendPrivacyEvent,
  createPrivacyAdminClient,
  getAuthenticatedContext,
  isAdminUser,
  withOverdue,
} from '@/lib/privacy-service'
import { isPrivacyRequestStatus } from '@/lib/privacy-utils.js'

type Params = {
  params: Promise<{ id: string }>
}

type PatchPayload = {
  status?: string
  note?: string
  denialReason?: string | null
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await getAuthenticatedContext()
  if (!auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isAdminUser(auth.user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const payload = (await request.json().catch(() => null)) as PatchPayload | null
  if (!payload?.status || !isPrivacyRequestStatus(payload.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const { id } = await params
  const admin = createPrivacyAdminClient()

  const updateValues: Record<string, unknown> = {
    status: payload.status,
    denial_reason: payload.status === 'DENIED' ? payload.denialReason ?? null : null,
  }

  if (payload.status === 'FULFILLED') {
    updateValues.fulfilled_at = new Date().toISOString()
  }

  const { data: updated, error } = await admin
    .from('privacy_requests')
    .update(updateValues)
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Failed to update request' }, { status: 500 })
  }

  if (!updated) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await appendPrivacyEvent({
    requestId: id,
    actorUserId: auth.user.id,
    actorRole: 'admin',
    action: `ADMIN_SET_STATUS_${payload.status}`,
    note: payload.note,
  })

  return NextResponse.json({ request: withOverdue(updated) })
}
