import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { syncXeroTenantForUser } from '@/lib/xero/sync'
import { acquireXeroTenantSyncLock, releaseXeroTenantSyncLock } from '@/lib/xero/tenant-sync-lock'

function parseNonEmptyString(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isAuthorized(request: NextRequest) {
  const configuredSecret = process.env.XERO_SYNC_INTERNAL_SECRET ?? process.env.CRON_SECRET ?? ''

  if (!configuredSecret) {
    return { ok: false as const, reason: 'missing_secret' as const }
  }

  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : ''

  if (token !== configuredSecret) {
    return { ok: false as const, reason: 'invalid_secret' as const }
  }

  return { ok: true as const }
}

export async function POST(request: NextRequest) {
  const auth = isAuthorized(request)

  if (!auth.ok) {
    if (auth.reason === 'missing_secret') {
      return NextResponse.json({ error: 'Xero internal sync secret is not configured' }, { status: 500 })
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = (await request.json().catch(() => null)) as
    | { userId?: unknown; tenantId?: unknown }
    | null

  const userId = parseNonEmptyString(payload?.userId)
  const tenantId = parseNonEmptyString(payload?.tenantId)

  if (!userId || !tenantId) {
    return NextResponse.json(
      {
        error: 'Missing userId or tenantId',
        code: 'XERO_INTERNAL_SYNC_INPUT_REQUIRED',
      },
      { status: 400 }
    )
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const lockId = randomUUID()
  const { acquired, error: lockError } = await acquireXeroTenantSyncLock({
    userId,
    tenantId,
    lockId,
    supabaseAdmin,
  })

  if (lockError) {
    console.error('[xero.internal-sync] Failed to acquire tenant sync lock', {
      user_id: userId,
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
      userId,
      tenantId,
    })
  } finally {
    const releaseError = await releaseXeroTenantSyncLock({
      userId,
      tenantId,
      lockId,
      supabaseAdmin,
    })

    if (releaseError) {
      console.error('[xero.internal-sync] Failed to release tenant sync lock', {
        user_id: userId,
        tenant_id: tenantId,
        message: releaseError.message,
      })
    }
  }
}
