import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { mapXeroRawToCanonical } from '@/lib/xero/canonical-mapper'
import { canAccessInternalXeroTools } from '@/lib/xero/internal-access'

function parseTenantId(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!canAccessInternalXeroTools(user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const payload = (await request.json().catch(() => null)) as { tenantId?: unknown } | null
    const tenantId = parseTenantId(payload?.tenantId)
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Missing tenantId', code: 'XERO_TENANT_ID_REQUIRED' },
        { status: 400 }
      )
    }

    const mapped = await mapXeroRawToCanonical({
      userId: user.id,
      tenantId,
    })

    return NextResponse.json({
      ok: true,
      tenantId,
      mapped,
    })
  } catch (error) {
    console.error('[xero.map-canonical] Mapping failed', {
      message: error instanceof Error ? error.message : 'Unknown error',
    })

    return NextResponse.json({ error: 'Failed to map canonical data' }, { status: 500 })
  }
}
