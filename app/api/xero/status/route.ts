import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { canAccessInternalXeroTools } from '@/lib/xero/internal-access'
import {
  getXeroSyncStateMessage,
  resolveXeroSyncState,
  type XeroSyncState,
} from '@/lib/xero/sync-status'
import {
  loadXeroAuthoritativeFreshness,
  resolveXeroAuthoritativeSnapshot,
  toXeroSnapshotReference,
  type XeroSnapshotReference,
} from '@/lib/xero/authoritative-snapshot'
import { classifyXeroGrant, type XeroGrantClassification } from '@/lib/xero/scopes'
import {
  resolveXeroPreparationStatus,
  type XeroPreparationStatus,
  type XeroPreparationStep,
} from '@/lib/xero/preparation-status'
import { XERO_SYNC_RUN_REQUIRED_STEPS } from '@/lib/xero/generation-run'

interface XeroConnectionRow {
  tenant_id: string
  tenant_name: string | null
  auth_state: 'active' | 'reauth_required' | 'disconnected' | 'error'
  last_refresh_error: string | null
  reauth_required_at: string | null
  updated_at: string
  grant_id: string | null
}

type XeroGenerationAttemptState = 'none' | 'running' | 'failed' | 'interrupted' | 'promoted'

interface XeroTenantStateStatusRow {
  active_sync_run_id: string | null
  latest_sync_run_id: string | null
}

interface XeroSyncRunStatusRow {
  id: string
  user_id: string
  tenant_id: string
  status: 'running' | 'succeeded' | 'failed' | 'abandoned'
  lease_expires_at: string | null
  started_at: string
  error_code: string | null
}

interface XeroSyncRunStepStatusRow {
  step_key: string
  status: 'pending' | 'succeeded'
  record_count: number | string | null
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

function parsePreparationStep(row: XeroSyncRunStepStatusRow): XeroPreparationStep {
  const recordCount =
    row.record_count === null
      ? null
      : typeof row.record_count === 'number'
        ? row.record_count
        : /^\d+$/.test(row.record_count)
          ? Number(row.record_count)
          : Number.NaN

  if (
    !XERO_SYNC_RUN_REQUIRED_STEPS.includes(
      row.step_key as (typeof XERO_SYNC_RUN_REQUIRED_STEPS)[number]
    ) ||
    (row.status !== 'pending' && row.status !== 'succeeded') ||
    !(recordCount === null || (Number.isSafeInteger(recordCount) && recordCount >= 0))
  ) {
    throw new Error('malformed preparation step')
  }

  return {
    stepKey: row.step_key as (typeof XERO_SYNC_RUN_REQUIRED_STEPS)[number],
    status: row.status,
    recordCount,
  }
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
        'tenant_id, tenant_name, auth_state, last_refresh_error, reauth_required_at, updated_at, grant_id'
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
    let snapshot: XeroSnapshotReference | null = null
    let grantClassification: XeroGrantClassification | null = null
    let latestAttempt: {
      runId: string
      state: Exclude<XeroGenerationAttemptState, 'none'>
      startedAt: string | null
    } | null = null
    let preparation: XeroPreparationStatus | null = null

    if (selectedConnection) {
      const supabaseAdmin = createSupabaseAdminClient()
      try {
        if (selectedConnection.grant_id) {
          const { data: grantData, error: grantError } = await supabaseAdmin
            .from('xero_oauth_grants')
            .select('scopes')
            .eq('id', selectedConnection.grant_id)
            .eq('user_id', user.id)
            .maybeSingle<{ scopes: string[] | null }>()
          if (grantError) throw grantError
          grantClassification = classifyXeroGrant({
            scopes: grantData?.scopes ?? null,
            authState: selectedConnection.auth_state,
            scopeMetadataKnown: Array.isArray(grantData?.scopes) && grantData.scopes.length > 0,
          })
        } else {
          grantClassification = 'reauth_required'
        }

        const resolvedSnapshot = await resolveXeroAuthoritativeSnapshot({
          supabaseAdmin,
          userId: user.id,
          tenantId: selectedConnection.tenant_id,
        })
        snapshot = toXeroSnapshotReference(resolvedSnapshot)
        lastSyncedAt = await loadXeroAuthoritativeFreshness({
          supabaseAdmin,
          snapshot: resolvedSnapshot,
        })

        const { data: tenantStateData, error: tenantStateError } = await supabaseAdmin
          .from('xero_sync_tenant_state')
          .select('active_sync_run_id, latest_sync_run_id')
          .eq('user_id', user.id)
          .eq('tenant_id', selectedConnection.tenant_id)
          .maybeSingle<XeroTenantStateStatusRow>()
        if (tenantStateError) throw tenantStateError
        if (tenantStateData?.latest_sync_run_id) {
          const { data: latestRunData, error: latestRunError } = await supabaseAdmin
            .from('xero_sync_runs')
            .select('id, user_id, tenant_id, status, lease_expires_at, started_at, error_code')
            .eq('id', tenantStateData.latest_sync_run_id)
            .eq('user_id', user.id)
            .eq('tenant_id', selectedConnection.tenant_id)
            .maybeSingle<XeroSyncRunStatusRow>()
          if (latestRunError || !latestRunData) throw latestRunError ?? new Error('latest run missing')

          let attemptState: Exclude<XeroGenerationAttemptState, 'none'>
          if (latestRunData.status === 'running') {
            attemptState = latestRunData.lease_expires_at &&
              Date.parse(latestRunData.lease_expires_at) > Date.now()
              ? 'running'
              : 'interrupted'
          } else if (latestRunData.status === 'succeeded') {
            if (tenantStateData.active_sync_run_id !== latestRunData.id) {
              throw new Error('latest successful run is not active')
            }
            attemptState = 'promoted'
          } else {
            attemptState = 'failed'
          }
          const runStartedAt =
            typeof latestRunData.started_at === 'string' ? latestRunData.started_at : null
          const runErrorCode =
            typeof latestRunData.error_code === 'string' ? latestRunData.error_code : null
          latestAttempt = {
            runId: latestRunData.id,
            state: attemptState,
            startedAt: runStartedAt,
          }

          let steps: XeroPreparationStep[] = []
          if (attemptState === 'running') {
            const { data: stepData, error: stepError } = await supabaseAdmin
              .from('xero_sync_run_steps')
              .select('step_key, status, record_count')
              .eq('sync_run_id', latestRunData.id)
              .order('step_key', { ascending: true })
            if (stepError) throw stepError
            steps = ((stepData ?? []) as XeroSyncRunStepStatusRow[]).map(parsePreparationStep)
          }

          preparation = resolveXeroPreparationStatus({
            snapshot,
            lastSyncedAt,
            attempt: {
              state: attemptState,
              startedAt: runStartedAt,
              errorCode: runErrorCode,
            },
            steps,
          })
        }

        preparation ??= resolveXeroPreparationStatus({
          snapshot,
          lastSyncedAt,
          attempt: null,
          steps: [],
        })
      } catch (error) {
        logXeroStatusFailure({
          stage: 'sync_status_query',
          status: 500,
          context: diagnosticContext,
          error,
        })
        return NextResponse.json({ error: 'Failed to load Xero sync status' }, { status: 500 })
      }
    }

    const canAccessInternalTools = canAccessInternalXeroTools(user.email)
    const selectedConnectionSummary = selectedConnection ? toConnectionSummary(selectedConnection) : null
    const syncState = selectedConnectionSummary
      ? resolveXeroSyncState({
          authState: selectedConnectionSummary.authState,
          lastRefreshErrorCode: selectedConnection?.last_refresh_error ?? null,
          grantClassification,
          latestAttemptState: latestAttempt?.state ?? 'none',
        })
      : 'disconnected'

    return NextResponse.json({
      connected: syncState === 'active' || syncState === 'temporary_sync_issue' || syncState === 'sync_in_progress',
      needsReauth:
        syncState === 'reconnect_required' || syncState === 'permission_upgrade_required',
      hasError: selectedConnectionSummary?.hasError ?? false,
      hasTemporaryIssue: syncState === 'temporary_sync_issue' || syncState === 'sync_in_progress',
      authState: selectedConnectionSummary?.authState ?? 'disconnected',
      syncState,
      syncMessage: getXeroSyncStateMessage(syncState),
      canSync:
        (selectedConnectionSummary?.canSync ?? false) &&
        syncState !== 'permission_upgrade_required',
      tenantId: selectedConnection?.tenant_id ?? null,
      tenantName: selectedConnection?.tenant_name ?? null,
      reauthRequiredAt: selectedConnectionSummary?.reauthRequiredAt ?? null,
      lastSyncedAt,
      snapshot,
      grantClassification,
      latestSyncAttempt: latestAttempt,
      preparation,
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
