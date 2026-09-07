import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { claimActionsEntitlementStatus } from '@/lib/billing/entitlements'

const ALLOWED_RESOURCE_TYPES = new Set(['accounts', 'contacts', 'invoices'])

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

    const { searchParams } = new URL(request.url)
    const resourceTypeParam = searchParams.get('resourceType')?.toLowerCase() ?? null
    const limitParam = searchParams.get('limit')
    const tenantId = searchParams.get('tenantId')?.trim() ?? ''

    if (resourceTypeParam && !ALLOWED_RESOURCE_TYPES.has(resourceTypeParam)) {
      return NextResponse.json({ error: 'Invalid resourceType' }, { status: 400 })
    }

    if (!tenantId) {
      return NextResponse.json(
        { error: 'Missing tenantId', code: 'XERO_TENANT_ID_REQUIRED' },
        { status: 400 }
      )
    }

    const entitlement = await claimActionsEntitlementStatus({
      userId: user.id,
      preferredTenantId: tenantId,
      supabase,
    })
    if (!entitlement.tenantId) {
      return NextResponse.json({ error: 'No connected Xero tenant found' }, { status: 400 })
    }
    if (!entitlement.hasActionsAccess) {
      return NextResponse.json(
        { error: 'Free usage allowance exhausted', code: 'ACTION_USAGE_LIMIT_REACHED', entitlement },
        { status: 402 }
      )
    }

    const parsedLimit = Number.parseInt(limitParam ?? '', 10)
    const limit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(100, parsedLimit))
      : 20

    const supabaseAdmin = createSupabaseAdminClient()
    let query = supabaseAdmin
      .from('xero_raw')
      .select('id, tenant_id, resource_type, source_id, raw_json, fetched_at, updated_at')
      .eq('user_id', user.id)
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(limit)

    if (resourceTypeParam) {
      query = query.eq('resource_type', resourceTypeParam)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: 'Failed to load Xero raw data' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, tenantId, rows: data ?? [] })
  } catch {
    return NextResponse.json({ error: 'Failed to load Xero raw data' }, { status: 500 })
  }
}
