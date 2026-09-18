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
import { syncXeroAuthoritatively } from '@/lib/xero/generation-sync'
import { parseTenantId } from '@/lib/xero/sync'
import { claimActionsEntitlementStatus } from '@/lib/billing/entitlements'
import {
  loadXeroAuthoritativeFreshness,
  resolveXeroAuthoritativeSnapshot,
  toXeroSnapshotReference,
  type XeroAuthoritativeSnapshot,
} from '@/lib/xero/authoritative-snapshot'
import { recordFirstValueLatency } from '@/lib/observability/first-value-latency'

interface XeroConnectionRow {
  tenant_id: string
  auth_state: 'active' | 'reauth_required' | 'disconnected' | 'error'
  updated_at: string
  last_auto_sync_triggered_at: string | null
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

async function canRetryInterruptedFirstPreparation(params: {
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>
  userId: string
  tenantId: string
}) {
  const { data: tenantState, error: tenantStateError } = await params.supabaseAdmin
    .from('xero_sync_tenant_state')
    .select('latest_sync_run_id')
    .eq('user_id', params.userId)
    .eq('tenant_id', params.tenantId)
    .maybeSingle<{ latest_sync_run_id: string | null }>()
  if (tenantStateError || !tenantState?.latest_sync_run_id) return false

  const { data: run, error: runError } = await params.supabaseAdmin
    .from('xero_sync_runs')
    .select('status, lease_expires_at')
    .eq('id', tenantState.latest_sync_run_id)
    .eq('user_id', params.userId)
    .eq('tenant_id', params.tenantId)
    .maybeSingle<{ status: string; lease_expires_at: string | null }>()
  if (runError || !run) return false
  if (run.status === 'failed' || run.status === 'abandoned') return true
  return (
    run.status === 'running' &&
    typeof run.lease_expires_at === 'string' &&
    Date.parse(run.lease_expires_at) <= Date.now()
  )
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
      | { tenantId?: unknown; surface?: unknown; retry?: unknown }
      | null

    const requestedTenantId = parseTenantId(payload?.tenantId)
    const surface = typeof payload?.surface === 'string' ? payload.surface : null
    const retryFirstPreparation = payload?.retry === true
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

    let resolvedSnapshot: XeroAuthoritativeSnapshot
    let lastSyncedAt: string | null
    try {
      resolvedSnapshot = await resolveXeroAuthoritativeSnapshot({
        supabaseAdmin,
        userId: user.id,
        tenantId: selectedConnection.tenant_id,
      })
      lastSyncedAt = await loadXeroAuthoritativeFreshness({
        supabaseAdmin,
        snapshot: resolvedSnapshot,
      })
    } catch {
      return NextResponse.json({ error: 'Failed to load Xero sync status' }, { status: 500 })
    }
    const snapshot = toXeroSnapshotReference(resolvedSnapshot)

    if (!isXeroDataStale(lastSyncedAt)) {
      return NextResponse.json({
        ok: true,
        triggered: false,
        reason: 'xero_data_fresh',
        tenantId: selectedConnection.tenant_id,
        lastSyncedAt,
        snapshot,
        staleThresholdMinutes: XERO_AUTO_SYNC_STALE_MINUTES,
        surface,
      })
    }

    const retryAllowed =
      retryFirstPreparation &&
      lastSyncedAt === null &&
      await canRetryInterruptedFirstPreparation({
        supabaseAdmin,
        userId: user.id,
        tenantId: selectedConnection.tenant_id,
      })

    if (
      isWithinXeroAutoSyncCooldown(selectedConnection.last_auto_sync_triggered_at) &&
      !retryAllowed
    ) {
      return NextResponse.json({
        ok: true,
        triggered: false,
        reason: 'auto_sync_cooldown_active',
        tenantId: selectedConnection.tenant_id,
        lastSyncedAt,
        snapshot,
        surface,
      })
    }

    const entitlement = await claimActionsEntitlementStatus({
      userId: user.id,
      preferredTenantId: selectedConnection.tenant_id,
      supabase,
      supabaseAdmin,
    })
    if (!entitlement.hasActionsAccess) {
      return NextResponse.json(
        {
          error: 'Free usage allowance exhausted',
          code: 'ACTION_USAGE_LIMIT_REACHED',
          entitlement,
        },
        { status: 402 }
      )
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
      recordFirstValueLatency({
        stage: 'T1',
        outcome: 'deduplicated',
        userId: user.id,
        tenantId: selectedConnection.tenant_id,
        detail: 'auto_sync_in_progress',
      })
      return NextResponse.json({
        ok: true,
        triggered: false,
        reason: 'auto_sync_in_progress',
        tenantId: selectedConnection.tenant_id,
        lastSyncedAt,
        snapshot,
        surface,
      })
    }

    let syncSucceeded = false
    let syncStatus = 500
    let resultingLastSyncedAt = lastSyncedAt
    let resultingSnapshot = snapshot

    try {
      recordFirstValueLatency({
        stage: 'T1',
        outcome: 'started',
        userId: user.id,
        tenantId: selectedConnection.tenant_id,
      })
      const syncResponse = await syncXeroAuthoritatively({
        userId: user.id,
        tenantId: selectedConnection.tenant_id,
        supabaseAdmin,
      })
      syncSucceeded = syncResponse.ok
      syncStatus = syncResponse.status
      const syncPayload = (await syncResponse.json().catch(() => null)) as {
        lastSyncedAt?: unknown
        snapshot?: { mode?: unknown; syncRunId?: unknown }
      } | null
      if (syncSucceeded && typeof syncPayload?.lastSyncedAt === 'string') {
        resultingLastSyncedAt = syncPayload.lastSyncedAt
      }
      if (
        syncSucceeded &&
        syncPayload?.snapshot?.mode === 'generation' &&
        typeof syncPayload.snapshot.syncRunId === 'string'
      ) {
        resultingSnapshot = {
          mode: 'generation',
          syncRunId: syncPayload.snapshot.syncRunId,
        }
      }
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
      lastSyncedAt: resultingLastSyncedAt,
      snapshot: resultingSnapshot,
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
