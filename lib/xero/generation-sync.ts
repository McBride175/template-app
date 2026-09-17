import 'server-only'

import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import {
  importXeroGeneration,
  XERO_GENERATION_IMPORT_DEFAULT_LEASE_TTL_SECONDS,
  XeroGenerationImportError,
  type XeroGenerationImportResult,
} from '@/lib/xero/generation-importer'
import {
  inspectXeroGenerationReadiness,
  XERO_GENERATION_READINESS_CONTRACT_VERSION,
} from '@/lib/xero/generation-readiness'
import {
  failXeroGenerationRun,
  heartbeatXeroGenerationRun,
  promoteXeroGenerationRun,
} from '@/lib/xero/generation-run'
import { classifyXeroGrant, type XeroGrantClassification } from '@/lib/xero/scopes'

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>

interface XeroConnectionRow {
  user_id: string
  tenant_id: string
  grant_id: string | null
  auth_state: 'active' | 'reauth_required' | 'disconnected' | 'error'
}

interface XeroGrantRow {
  id: string
  user_id: string
  scopes: string[] | null
}

interface XeroGenerationSyncDependencies {
  createSupabaseAdminClient: typeof createSupabaseAdminClient
  importGeneration: typeof importXeroGeneration
  heartbeatRun: typeof heartbeatXeroGenerationRun
  inspectReadiness: typeof inspectXeroGenerationReadiness
  promoteRun: typeof promoteXeroGenerationRun
  failRun: typeof failXeroGenerationRun
  randomUUID: typeof randomUUID
}

interface XeroGenerationSyncPreflight {
  grantId: string
  grantClassification: Extract<
    XeroGrantClassification,
    'granular_ready' | 'legacy_broad_compatible'
  >
}

const DEFAULT_DEPENDENCIES: XeroGenerationSyncDependencies = {
  createSupabaseAdminClient,
  importGeneration: importXeroGeneration,
  heartbeatRun: heartbeatXeroGenerationRun,
  inspectReadiness: inspectXeroGenerationReadiness,
  promoteRun: promoteXeroGenerationRun,
  failRun: failXeroGenerationRun,
  randomUUID,
}

function requireNonEmpty(value: string, label: string) {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${label} is required`)
  return normalized
}

async function loadPreflight(params: {
  supabaseAdmin: SupabaseAdminClient
  userId: string
  tenantId: string
}): Promise<
  | { ok: true; preflight: XeroGenerationSyncPreflight }
  | { ok: false; response: NextResponse }
> {
  const { data: connectionData, error: connectionError } = await params.supabaseAdmin
    .from('xero_connections_public')
    .select('user_id, tenant_id, grant_id, auth_state')
    .eq('user_id', params.userId)
    .eq('tenant_id', params.tenantId)
    .maybeSingle<XeroConnectionRow>()

  if (connectionError) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Failed to load Xero connection', code: 'XERO_CONNECTION_LOOKUP_FAILED' },
        { status: 500 }
      ),
    }
  }
  if (!connectionData || connectionData.auth_state === 'disconnected' || !connectionData.grant_id) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'No active Xero connection found', code: 'XERO_NOT_CONNECTED' },
        { status: 400 }
      ),
    }
  }
  if (connectionData.auth_state === 'reauth_required') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Reconnect Xero to continue syncing', code: 'XERO_REAUTH_REQUIRED' },
        { status: 401 }
      ),
    }
  }
  if (connectionData.auth_state !== 'active') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Xero is temporarily unavailable', code: 'XERO_CONNECTION_UNAVAILABLE' },
        { status: 503 }
      ),
    }
  }

  const { data: grantData, error: grantError } = await params.supabaseAdmin
    .from('xero_oauth_grants')
    .select('id, user_id, scopes')
    .eq('id', connectionData.grant_id)
    .eq('user_id', params.userId)
    .maybeSingle<XeroGrantRow>()

  if (grantError) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Failed to load Xero permissions', code: 'XERO_GRANT_LOOKUP_FAILED' },
        { status: 500 }
      ),
    }
  }
  if (!grantData || grantData.id !== connectionData.grant_id) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Reconnect Xero to continue syncing', code: 'XERO_REAUTH_REQUIRED' },
        { status: 401 }
      ),
    }
  }

  const grantClassification = classifyXeroGrant({
    scopes: grantData.scopes,
    authState: connectionData.auth_state,
    scopeMetadataKnown: Array.isArray(grantData.scopes) && grantData.scopes.length > 0,
  })
  if (
    grantClassification !== 'granular_ready' &&
    grantClassification !== 'legacy_broad_compatible'
  ) {
    const reauthRequired = grantClassification === 'reauth_required'
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: reauthRequired
            ? 'Reconnect Xero to continue syncing'
            : 'Reconnect Xero to grant the required permissions',
          code: reauthRequired ? 'XERO_REAUTH_REQUIRED' : 'XERO_PERMISSION_UPGRADE_REQUIRED',
        },
        { status: reauthRequired ? 401 : 403 }
      ),
    }
  }

  return {
    ok: true,
    preflight: {
      grantId: grantData.id,
      grantClassification,
    },
  }
}

function importFailureResponse(error: XeroGenerationImportError) {
  const responseByCode: Record<XeroGenerationImportError['code'], {
    status: number
    code: string
    error: string
  }> = {
    xero_reauth_required: {
      status: 401,
      code: 'XERO_REAUTH_REQUIRED',
      error: 'Reconnect Xero to continue syncing',
    },
    xero_permission_required: {
      status: 403,
      code: 'XERO_PERMISSION_UPGRADE_REQUIRED',
      error: 'Reconnect Xero to grant the required permissions',
    },
    xero_rate_limited: {
      status: 429,
      code: 'XERO_RATE_LIMITED',
      error: 'Xero is temporarily rate limited. Please retry later.',
    },
    xero_daily_limit: {
      status: 429,
      code: 'XERO_DAILY_LIMIT_REACHED',
      error: 'The Xero daily request limit has been reached. Please retry later.',
    },
    provider_unavailable: {
      status: 503,
      code: 'XERO_PROVIDER_UNAVAILABLE',
      error: 'Xero is temporarily unavailable',
    },
    provider_timeout: {
      status: 504,
      code: 'XERO_PROVIDER_TIMEOUT',
      error: 'Xero did not respond in time',
    },
    run_deadline: {
      status: 504,
      code: 'XERO_SYNC_DEADLINE',
      error: 'The Xero sync did not finish in time',
    },
    run_cancelled: {
      status: 503,
      code: 'XERO_SYNC_CANCELLED',
      error: 'The Xero sync was cancelled',
    },
    lease_lost: {
      status: 409,
      code: 'XERO_GENERATION_LEASE_LOST',
      error: 'A newer Xero sync owns this tenant',
    },
    provider_data_invalid: {
      status: 502,
      code: 'XERO_PROVIDER_DATA_INVALID',
      error: 'Xero returned data that could not be validated',
    },
    generation_validation_failed: {
      status: 422,
      code: 'XERO_GENERATION_VALIDATION_FAILED',
      error: 'The new Xero snapshot failed validation',
    },
    persistence_failed: {
      status: 500,
      code: 'XERO_GENERATION_PERSISTENCE_FAILED',
      error: 'The new Xero snapshot could not be stored',
    },
  }
  const response = responseByCode[error.code]
  return NextResponse.json(
    { error: response.error, code: response.code, runId: error.runId },
    { status: response.status }
  )
}

function nonReadyResponse(result: Exclude<XeroGenerationImportResult, { status: 'ready_for_promotion' }>) {
  if (result.status === 'connection_not_available') {
    return NextResponse.json(
      { error: 'No active Xero connection found', code: 'XERO_NOT_CONNECTED' },
      { status: 400 }
    )
  }
  return NextResponse.json(
    {
      error: 'Xero sync is already in progress for this tenant',
      code: 'XERO_GENERATION_SYNC_IN_PROGRESS',
      runId: result.runId,
      leaseExpiresAt: result.leaseExpiresAt,
    },
    { status: 409 }
  )
}

async function failPreparedRun(params: {
  dependencies: XeroGenerationSyncDependencies
  supabaseAdmin: SupabaseAdminClient
  result: Extract<XeroGenerationImportResult, { status: 'ready_for_promotion' }>
  leaseOwner: string
  errorCode: string
  errorResource: string
}) {
  try {
    await params.dependencies.failRun({
      syncRunId: params.result.runId,
      leaseOwner: params.leaseOwner,
      fencingToken: params.result.fencingToken,
      errorCode: params.errorCode,
      errorResource: params.errorResource,
      supabaseAdmin: params.supabaseAdmin,
    })
  } catch {
    // Stale/superseded workers cannot alter the replacement run. The protected
    // active pointer remains authoritative whether or not failure recording wins.
  }
}

export async function syncXeroAuthoritatively(params: {
  userId: string
  tenantId: string
  supabaseAdmin?: SupabaseAdminClient
  dependencies?: Partial<XeroGenerationSyncDependencies>
}) {
  const userId = requireNonEmpty(params.userId, 'userId')
  const tenantId = requireNonEmpty(params.tenantId, 'tenantId')
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...params.dependencies }
  const supabaseAdmin = params.supabaseAdmin ?? dependencies.createSupabaseAdminClient()
  const preflight = await loadPreflight({ supabaseAdmin, userId, tenantId })
  if (!preflight.ok) return preflight.response

  const leaseOwner = dependencies.randomUUID()
  let result: XeroGenerationImportResult
  try {
    result = await dependencies.importGeneration({
      userId,
      tenantId,
      grantId: preflight.preflight.grantId,
      leaseOwner,
      supabaseAdmin,
    })
  } catch (error) {
    if (error instanceof XeroGenerationImportError) return importFailureResponse(error)
    console.error('[xero.generation-sync] Generation import failed unexpectedly', {
      user_id: userId,
      tenant_id: tenantId,
    })
    return NextResponse.json(
      { error: 'Failed to build the new Xero snapshot', code: 'XERO_GENERATION_IMPORT_FAILED' },
      { status: 500 }
    )
  }
  if (result.status !== 'ready_for_promotion') return nonReadyResponse(result)

  const evidence = result.readiness
  const evidenceIsCurrent =
    evidence.validated &&
    evidence.resultCode === 'validated' &&
    evidence.validationId !== null &&
    evidence.validatedAt !== null &&
    evidence.contractVersion === XERO_GENERATION_READINESS_CONTRACT_VERSION &&
    evidence.fencingToken === result.fencingToken &&
    evidence.incompleteFxInvoiceCount === 0 &&
    evidence.fxViolationCount === 0

  if (!evidenceIsCurrent) {
    await failPreparedRun({
      dependencies,
      supabaseAdmin,
      result,
      leaseOwner,
      errorCode: 'generation_validation_failed',
      errorResource: 'readiness_evidence',
    })
    return NextResponse.json(
      { error: 'The new Xero snapshot failed validation', code: 'XERO_GENERATION_VALIDATION_FAILED', runId: result.runId },
      { status: 422 }
    )
  }

  try {
    const heartbeat = await dependencies.heartbeatRun({
      syncRunId: result.runId,
      leaseOwner,
      fencingToken: result.fencingToken,
      leaseTtlSeconds: XERO_GENERATION_IMPORT_DEFAULT_LEASE_TTL_SECONDS,
      supabaseAdmin,
    })
    if (!heartbeat.renewed) {
      return NextResponse.json(
        { error: 'A newer Xero sync owns this tenant', code: 'XERO_GENERATION_LEASE_LOST', runId: result.runId },
        { status: 409 }
      )
    }

    const readiness = await dependencies.inspectReadiness({
      syncRunId: result.runId,
      userId,
      tenantId,
      contractVersion: XERO_GENERATION_READINESS_CONTRACT_VERSION,
      supabaseAdmin,
    })
    if (
      !readiness.ready ||
      readiness.resultCode !== 'ready' ||
      readiness.contractVersion !== XERO_GENERATION_READINESS_CONTRACT_VERSION ||
      Object.values(readiness.violations).some((count) => count !== 0)
    ) {
      await failPreparedRun({
        dependencies,
        supabaseAdmin,
        result,
        leaseOwner,
        errorCode: 'generation_validation_failed',
        errorResource: readiness.resultCode,
      })
      return NextResponse.json(
        { error: 'The new Xero snapshot failed validation', code: 'XERO_GENERATION_VALIDATION_FAILED', runId: result.runId },
        { status: 422 }
      )
    }

    const promotion = await dependencies.promoteRun({
      syncRunId: result.runId,
      leaseOwner,
      fencingToken: result.fencingToken,
      snapshotAsOf: result.diagnostics.runStartedAt,
      supabaseAdmin,
    })
    if (!promotion.promoted || !promotion.promotedAt) {
      await failPreparedRun({
        dependencies,
        supabaseAdmin,
        result,
        leaseOwner,
        errorCode: 'promotion_failed',
        errorResource: promotion.resultCode,
      })
      return NextResponse.json(
        {
          error: 'The new Xero snapshot could not become active',
          code: 'XERO_GENERATION_PROMOTION_REJECTED',
          runId: result.runId,
        },
        { status: 409 }
      )
    }

    return NextResponse.json({
      ok: true,
      code: 'XERO_GENERATION_PROMOTED',
      tenantId,
      runId: result.runId,
      promotedAt: promotion.promotedAt,
      syncedAt: promotion.promotedAt,
      lastSyncedAt: promotion.promotedAt,
      snapshot: { mode: 'generation', syncRunId: result.runId },
      counts: {
        organisations: result.counts.organisation,
        contacts: result.counts.contacts,
        invoices: result.counts.authorisedInvoices + result.counts.paidInvoices,
        payments: result.counts.payments,
      },
      canonicalCounts: result.counts.canonical,
    })
  } catch {
    await failPreparedRun({
      dependencies,
      supabaseAdmin,
      result,
      leaseOwner,
      errorCode: 'promotion_failed',
      errorResource: 'promotion',
    })
    return NextResponse.json(
      {
        error: 'The new Xero snapshot could not become active',
        code: 'XERO_GENERATION_PROMOTION_FAILED',
        runId: result.runId,
      },
      { status: 500 }
    )
  }
}
