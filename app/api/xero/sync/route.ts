import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { acquireXeroTenantSyncLock, releaseXeroTenantSyncLock } from '@/lib/xero/tenant-sync-lock'
import { parseTenantId, syncXeroTenantForUser } from '@/lib/xero/sync'
import { claimActionsEntitlementStatus } from '@/lib/billing/entitlements'

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

    const payload = (await request.json().catch(() => null)) as { tenantId?: unknown } | null
    const tenantId = parseTenantId(payload?.tenantId)
    if (!tenantId) {
      return NextResponse.json(
        {
          error: 'Missing tenantId',
          code: 'XERO_TENANT_ID_REQUIRED',
        },
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

    const supabaseAdmin = createSupabaseAdminClient()
    const lockId = randomUUID()
    const { acquired, error: lockError } = await acquireXeroTenantSyncLock({
      userId: user.id,
      tenantId,
      lockId,
      supabaseAdmin,
    })

    if (lockError) {
      console.error('[xero.sync] Failed to acquire tenant sync lock', {
        user_id: user.id,
        tenant_id: tenantId,
        message: lockError.message,
      })
      return NextResponse.json(
        {
          error: 'Failed to coordinate Xero sync',
          code: 'XERO_TENANT_AUTO_SYNC_LOCK_FAILED',
        },
        { status: 500 }
      )
    }

    if (!acquired) {
      return NextResponse.json(
        {
          error: 'Xero sync is already in progress for this tenant',
          code: 'XERO_TENANT_AUTO_SYNC_LOCKED',
          tenantId,
        },
        { status: 409 }
      )
    }

    try {
      return await syncXeroTenantForUser({
        userId: user.id,
        tenantId,
      })
    } finally {
      const releaseError = await releaseXeroTenantSyncLock({
        userId: user.id,
        tenantId,
        lockId,
        supabaseAdmin,
      })

      if (releaseError) {
        console.error('[xero.sync] Failed to release tenant sync lock', {
          user_id: user.id,
          tenant_id: tenantId,
          message: releaseError.message,
        })
      }
    }
  } catch (error) {
    console.error('[xero.sync] Unexpected sync error', {
      message: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ error: 'Failed to sync Xero data' }, { status: 500 })
  }
}
