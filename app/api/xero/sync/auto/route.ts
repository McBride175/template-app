import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import {
  isWithinXeroAutoSyncCooldown,
  isXeroDataStale,
  XERO_AUTO_SYNC_LOCK_TTL_SECONDS,
  XERO_AUTO_SYNC_STALE_MINUTES,
} from '@/lib/xero/auto-sync'
import { parseTenantId, syncXeroTenantForUser } from '@/lib/xero/sync'

interface XeroConnectionRow {
  tenant_id: string
  auth_state: 'active' | 'reauth_required' | 'disconnected' | 'error'
  updated_at: string
  last_auto_sync_triggered_at: string | null
}

interface XeroRawLatestRow {
  fetched_at: string
}

function selectTenantConnection(
  connections: XeroConnectionRow[],
  requestedTenantId: string | null
) {
  if (connections.length === 0) return null

  if (requestedTenantId) {
    const requested = connections.find((connection) => connection.tenant_id === requestedTenantId)
    if (requested) return requested
  }

  return (
    connections.find((connection) => connection.auth_state === 'active') ??
    connections.find((connection) => connection.auth_state === 'reauth_required') ??
    connections[0]
  )
}

async function releaseAutoSyncLock(params: {
  userId: string
  tenantId: string
  lockId: string
}) {
  const supabaseAdmin = createSupabaseAdminClient()
  const { error } = await supabaseAdmin.rpc('release_xero_tenant_auto_sync_lock', {
    p_user_id: params.userId,
    p_tenant_id: params.tenantId,
    p_lock_id: params.lockId,
  })

  if (error) {
    console.error('[xero.auto-sync] Failed to release auto-sync lock', {
      user_id: params.userId,
      tenant_id: params.tenantId,
      message: error.message,
    })
  }
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

    const payload = (await request.json().catch(() => null)) as
      | { tenantId?: unknown; surface?: unknown }
      | null

    const requestedTenantId = parseTenantId(payload?.tenantId)
    const surface = typeof payload?.surface === 'string' ? payload.surface : null
    const supabaseAdmin = createSupabaseAdminClient()

    const { data: connectionData, error: connectionError } = await supabaseAdmin
      .from('xero_connections_public')
      .select('tenant_id, auth_state, updated_at, last_auto_sync_triggered_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })

    if (connectionError) {
      return NextResponse.json({ error: 'Failed to load Xero connection' }, { status: 500 })
    }

    const selectedConnection = selectTenantConnection(
      (connectionData ?? []) as XeroConnectionRow[],
      requestedTenantId
    )

    if (!selectedConnection) {
      return NextResponse.json({
        ok: true,
        triggered: false,
        reason: 'xero_not_connected',
        surface,
      })
    }

    if (selectedConnection.auth_state === 'reauth_required') {
      return NextResponse.json({
        ok: true,
        triggered: false,
        reason: 'xero_reauth_required',
        authState: selectedConnection.auth_state,
        tenantId: selectedConnection.tenant_id,
        surface,
      })
    }

    if (selectedConnection.auth_state === 'disconnected') {
      return NextResponse.json({
        ok: true,
        triggered: false,
        reason: 'xero_not_connected',
        authState: selectedConnection.auth_state,
        tenantId: selectedConnection.tenant_id,
        surface,
      })
    }

    const { data: latestRaw, error: latestRawError } = await supabaseAdmin
      .from('xero_raw')
      .select('fetched_at')
      .eq('user_id', user.id)
      .eq('tenant_id', selectedConnection.tenant_id)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle<XeroRawLatestRow>()

    if (latestRawError) {
      return NextResponse.json({ error: 'Failed to load Xero sync status' }, { status: 500 })
    }

    const lastSyncedAt = latestRaw?.fetched_at ?? null

    if (!isXeroDataStale(lastSyncedAt)) {
      return NextResponse.json({
        ok: true,
        triggered: false,
        reason: 'xero_data_fresh',
        tenantId: selectedConnection.tenant_id,
        lastSyncedAt,
        staleThresholdMinutes: XERO_AUTO_SYNC_STALE_MINUTES,
        surface,
      })
    }

    if (isWithinXeroAutoSyncCooldown(selectedConnection.last_auto_sync_triggered_at)) {
      return NextResponse.json({
        ok: true,
        triggered: false,
        reason: 'auto_sync_cooldown_active',
        tenantId: selectedConnection.tenant_id,
        lastSyncedAt,
        surface,
      })
    }

    const lockId = randomUUID()
    const { data: lockAcquired, error: lockError } = await supabaseAdmin.rpc(
      'acquire_xero_tenant_auto_sync_lock',
      {
        p_user_id: user.id,
        p_tenant_id: selectedConnection.tenant_id,
        p_lock_id: lockId,
        p_ttl_seconds: XERO_AUTO_SYNC_LOCK_TTL_SECONDS,
      }
    )

    if (lockError) {
      console.error('[xero.auto-sync] Failed to acquire auto-sync lock', {
        user_id: user.id,
        tenant_id: selectedConnection.tenant_id,
        message: lockError.message,
      })
      return NextResponse.json({ error: 'Failed to coordinate Xero auto-sync' }, { status: 500 })
    }

    if (!lockAcquired) {
      return NextResponse.json({
        ok: true,
        triggered: false,
        reason: 'auto_sync_in_progress',
        tenantId: selectedConnection.tenant_id,
        lastSyncedAt,
        surface,
      })
    }

    let syncSucceeded = false
    let syncStatus = 500

    try {
      const syncResponse = await syncXeroTenantForUser({
        userId: user.id,
        tenantId: selectedConnection.tenant_id,
      })
      syncSucceeded = syncResponse.ok
      syncStatus = syncResponse.status
    } finally {
      await releaseAutoSyncLock({
        userId: user.id,
        tenantId: selectedConnection.tenant_id,
        lockId,
      })
    }

    return NextResponse.json({
      ok: true,
      triggered: true,
      syncSucceeded,
      syncStatus,
      tenantId: selectedConnection.tenant_id,
      lastSyncedAt,
      staleThresholdMinutes: XERO_AUTO_SYNC_STALE_MINUTES,
      surface,
    })
  } catch (error) {
    console.error('[xero.auto-sync] Unexpected auto-sync error', {
      message: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ error: 'Failed to auto-sync Xero data' }, { status: 500 })
  }
}
