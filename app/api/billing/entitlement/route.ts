import { NextRequest, NextResponse } from 'next/server'
import { getActionsEntitlementStatus } from '@/lib/billing/entitlements'
import { createServerSupabaseClient } from '@/lib/supabase-server'

function parseTenantId(value: string | null) {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const entitlement = await getActionsEntitlementStatus({
      userId: user.id,
      preferredTenantId: parseTenantId(request.nextUrl.searchParams.get('tenantId')),
      supabase,
    })

    const response = NextResponse.json({ ok: true, entitlement })
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    response.headers.set('Pragma', 'no-cache')
    response.headers.set('Expires', '0')
    return response
  } catch (error) {
    console.error('[billing.entitlement.get] Failed to load entitlement', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return NextResponse.json({ error: 'Failed to load billing entitlement' }, { status: 500 })
  }
}
