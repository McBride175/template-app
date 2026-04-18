import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { canAccessInternalXeroTools } from '@/lib/xero/internal-access'
import {
  getXeroSyncStateMessage,
  resolveXeroSyncState,
  type XeroSyncState,
} from '@/lib/xero/sync-status'

interface XeroConnectionRow {
  tenant_id: string
  tenant_name: string | null
  auth_state: 'active' | 'reauth_required' | 'disconnected' | 'error'
  last_refresh_error: string | null
  reauth_required_at: string | null
  updated_at: string
}

interface XeroRawLatestRow {
  fetched_at: string
}

interface XeroConnectionStatusSummary {
  tenantId: string
  tenantName: string | null
  authState: XeroConnectionRow['auth_state']
  syncState: XeroSyncState
  syncMessage: string
  canSync: boolean
  needsReauth: boolean
  hasError: boolean
  hasTemporaryIssue: boolean
  reauthRequiredAt: string | null
  updatedAt: string
}

function parseTenantId(value: string | null) {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function hasTemporaryRefreshIssue(connection: { syncState: XeroSyncState }) {
  return connection.syncState === 'temporary_sync_issue' || connection.syncState === 'sync_in_progress'
}

function toConnectionSummary(connection: XeroConnectionRow): XeroConnectionStatusSummary {
  const syncState = resolveXeroSyncState({
    authState: connection.auth_state,
    lastRefreshErrorCode: connection.last_refresh_error,
  })

  return {
    tenantId: connection.tenant_id,
    tenantName: connection.tenant_name,
    authState: connection.auth_state,
    syncState,
    syncMessage: getXeroSyncStateMessage(syncState),
    canSync: connection.auth_state === 'active',
    needsReauth: connection.auth_state === 'reauth_required',
    hasError: connection.auth_state === 'error',
    hasTemporaryIssue: hasTemporaryRefreshIssue({ syncState }),
    reauthRequiredAt: connection.reauth_required_at,
    updatedAt: connection.updated_at,
  }
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

    const requestedTenantId = parseTenantId(request.nextUrl.searchParams.get('tenantId'))
    const { data, error: connectionError } = await supabase
      .from('xero_connections_public')
      .select(
        'tenant_id, tenant_name, auth_state, last_refresh_error, reauth_required_at, updated_at'
      )
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })

    if (connectionError) {
      return NextResponse.json({ error: 'Failed to load Xero connection' }, { status: 500 })
    }

    const connectionRows = (data ?? []) as XeroConnectionRow[]
    const connections = connectionRows.map(toConnectionSummary)

    const selectedConnection = selectTenantConnection(connectionRows, requestedTenantId) ?? null
    let lastSyncedAt: string | null = null

    if (selectedConnection) {
      const { data: latestRaw, error: latestRawError } = await supabase
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

      lastSyncedAt = latestRaw?.fetched_at ?? null
    }

    const canAccessInternalTools = canAccessInternalXeroTools(user.email)
    const selectedConnectionSummary = selectedConnection ? toConnectionSummary(selectedConnection) : null
    const syncState = selectedConnectionSummary?.syncState ?? 'disconnected'

    return NextResponse.json({
      connected: syncState === 'active' || syncState === 'temporary_sync_issue' || syncState === 'sync_in_progress',
      needsReauth: syncState === 'reconnect_required',
      hasError: selectedConnectionSummary?.hasError ?? false,
      hasTemporaryIssue: syncState === 'temporary_sync_issue' || syncState === 'sync_in_progress',
      authState: selectedConnectionSummary?.authState ?? 'disconnected',
      syncState,
      syncMessage: getXeroSyncStateMessage(syncState),
      canSync: selectedConnectionSummary?.canSync ?? false,
      tenantId: selectedConnection?.tenant_id ?? null,
      tenantName: selectedConnection?.tenant_name ?? null,
      reauthRequiredAt: selectedConnectionSummary?.reauthRequiredAt ?? null,
      lastSyncedAt,
      connections,
      canAccessInternalTools,
      diagnostics:
        canAccessInternalTools && selectedConnection
          ? { refreshIssueCode: selectedConnection.last_refresh_error ?? null }
          : null,
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load Xero connection' }, { status: 500 })
  }
}
