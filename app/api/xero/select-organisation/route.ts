import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { recordFirstValueLatency } from '@/lib/observability/first-value-latency'

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (!origin || !host) return false

  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  if (
    !isSameOrigin(request) ||
    request.headers.get('x-requested-with') !== 'XMLHttpRequest'
  ) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = (await request.json().catch(() => null)) as { tenantId?: unknown } | null
  const tenantId = typeof payload?.tenantId === 'string' ? payload.tenantId.trim() : ''
  if (!tenantId || tenantId.length > 255) {
    return NextResponse.json({ error: 'Invalid organisation selection' }, { status: 400 })
  }

  const { data: connection, error: connectionError } = await supabase
    .from('xero_connections_public')
    .select('tenant_id')
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId)
    .eq('auth_state', 'active')
    .maybeSingle<{ tenant_id: string }>()

  if (connectionError) {
    console.error('[xero.select-organisation] Failed to validate tenant ownership', {
      code: connectionError.code,
      user_id: user.id,
    })
    return NextResponse.json({ error: 'Failed to validate organisation' }, { status: 500 })
  }

  if (!connection) {
    return NextResponse.json({ error: 'Organisation is not connected' }, { status: 404 })
  }

  recordFirstValueLatency({
    stage: 'T0',
    outcome: 'succeeded',
    userId: user.id,
    tenantId: connection.tenant_id,
    detail: 'organisation_selection_resolved',
  })

  return NextResponse.json({
    next: `/start?tenantId=${encodeURIComponent(connection.tenant_id)}`,
  })
}
