import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
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

type XeroStatusFailureStage =
  | 'authentication'
  | 'connection_query'
  | 'sync_status_query'
  | 'unexpected'

interface XeroStatusDiagnosticContext {
  authSucceeded: boolean
  userId: string | null
  connectionQuerySucceeded: boolean | null
  connectionRowCount: number | null
  selectedTenantId: string | null
}

function getRuntimeEnvironment() {
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV
  if (process.env.NODE_ENV === 'development') return 'local'
  return process.env.NODE_ENV ?? 'unknown'
}

function getSupabaseProjectRef() {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!configuredUrl) return null

  try {
    const hostname = new URL(configuredUrl).hostname
    return hostname.endsWith('.supabase.co') ? hostname.split('.')[0] ?? null : null
  } catch {
    return null
  }
}

function getSafeErrorDetails(error: unknown) {
  if (error instanceof Error) {
    return { errorCode: null, errorMessage: error.message }
  }

  if (typeof error === 'object' && error !== null) {
    const errorLike = error as { code?: unknown; message?: unknown }
    return {
      errorCode: typeof errorLike.code === 'string' ? errorLike.code : null,
      errorMessage: typeof errorLike.message === 'string' ? errorLike.message : null,
    }
  }

  return { errorCode: null, errorMessage: null }
}

function logXeroStatusFailure(params: {
  stage: XeroStatusFailureStage
  status: 401 | 500
  context: XeroStatusDiagnosticContext
  error?: unknown
}) {
  const details = {
    environment: getRuntimeEnvironment(),
    deployment: process.env.VERCEL_URL ?? null,
    supabaseProjectRef: getSupabaseProjectRef(),
    authSucceeded: params.context.authSucceeded,
    userId: params.context.userId,
    stage: params.stage,
    connectionQuerySucceeded: params.context.connectionQuerySucceeded,
    connectionRowCount: params.context.connectionRowCount,
    selectedTenantId: params.context.selectedTenantId,
    status: params.status,
    ...getSafeErrorDetails(params.error),
  }

  if (params.status === 401) {
    console.warn('[xero.status] Request failed', details)
    return
  }

  console.error('[xero.status] Request failed', details)
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
  const diagnosticContext: XeroStatusDiagnosticContext = {
    authSucceeded: false,
    userId: null,
    connectionQuerySucceeded: null,
    connectionRowCount: null,
    selectedTenantId: null,
  }

  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      logXeroStatusFailure({
        stage: 'authentication',
        status: 401,
        context: diagnosticContext,
        error: userError,
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    diagnosticContext.authSucceeded = true
    diagnosticContext.userId = user.id

    const requestedTenantId = parseTenantId(request.nextUrl.searchParams.get('tenantId'))
    const { data, error: connectionError } = await supabase
      .from('xero_connections_public')
      .select(
        'tenant_id, tenant_name, auth_state, last_refresh_error, reauth_required_at, updated_at'
      )
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })

    if (connectionError) {
      diagnosticContext.connectionQuerySucceeded = false
      logXeroStatusFailure({
        stage: 'connection_query',
        status: 500,
        context: diagnosticContext,
        error: connectionError,
      })
      return NextResponse.json({ error: 'Failed to load Xero connection' }, { status: 500 })
    }

    const connectionRows = (data ?? []) as XeroConnectionRow[]
    diagnosticContext.connectionQuerySucceeded = true
    diagnosticContext.connectionRowCount = connectionRows.length
    const connections = connectionRows.map(toConnectionSummary)

    const selectedConnection = selectTenantConnection(connectionRows, requestedTenantId) ?? null
    diagnosticContext.selectedTenantId = selectedConnection?.tenant_id ?? null
    let lastSyncedAt: string | null = null

    if (selectedConnection) {
      const supabaseAdmin = createSupabaseAdminClient()
      const { data: latestRaw, error: latestRawError } = await supabaseAdmin
        .from('xero_raw')
        .select('fetched_at')
        .eq('user_id', user.id)
        .eq('tenant_id', selectedConnection.tenant_id)
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle<XeroRawLatestRow>()

      if (latestRawError) {
        logXeroStatusFailure({
          stage: 'sync_status_query',
          status: 500,
          context: diagnosticContext,
          error: latestRawError,
        })
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
  } catch (error) {
    logXeroStatusFailure({
      stage: 'unexpected',
      status: 500,
      context: diagnosticContext,
      error,
    })
    return NextResponse.json({ error: 'Failed to load Xero connection' }, { status: 500 })
  }
}
