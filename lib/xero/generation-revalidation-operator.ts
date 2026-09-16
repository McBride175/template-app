import 'server-only'

import { randomUUID } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import {
  ensureXeroGenerationOperatorCredentialTarget,
  requireXeroGenerationOperatorProjectRef,
  requireXeroGenerationOperatorUuid,
  XeroGenerationOperatorError,
  type XeroGenerationOperatorPreflightState,
  loadXeroGenerationOperatorPreflightState,
} from '@/lib/xero/generation-operator'
import {
  inspectXeroGenerationReadiness,
  reacquireXeroGenerationRunForPromotion,
  recordXeroGenerationReadiness,
  XERO_GENERATION_READINESS_CONTRACT_VERSION,
} from '@/lib/xero/generation-readiness'
import { classifyXeroGrant } from '@/lib/xero/scopes'

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>

export interface XeroGenerationRevalidationOperatorInput {
  projectRef: string
  userId: string
  tenantId: string
  grantId: string
  syncRunId: string
  dryRun: boolean
}

interface PreparedRun {
  id: string
  user_id: string
  tenant_id: string
  status: string
  fencing_token: number
  lease_owner: string | null
  lease_expires_at: string | null
  previous_active_sync_run_id: string | null
}

interface TenantState {
  active_sync_run_id: string | null
  latest_sync_run_id: string | null
  current_fencing_token: number
  last_successful_sync_at: string | null
}

export interface XeroGenerationRevalidationPreflightState
  extends XeroGenerationOperatorPreflightState {
  run: PreparedRun | null
  tenantState: TenantState | null
}

interface Dependencies {
  createSupabaseAdminClient: typeof createSupabaseAdminClient
  loadPreflightState: typeof loadXeroGenerationRevalidationPreflightState
  inspectReadiness: typeof inspectXeroGenerationReadiness
  reacquire: typeof reacquireXeroGenerationRunForPromotion
  recordReadiness: typeof recordXeroGenerationReadiness
  now: () => number
  randomUUID: () => string
}

const DEFAULT_DEPENDENCIES: Dependencies = {
  createSupabaseAdminClient,
  loadPreflightState: loadXeroGenerationRevalidationPreflightState,
  inspectReadiness: inspectXeroGenerationReadiness,
  reacquire: reacquireXeroGenerationRunForPromotion,
  recordReadiness: recordXeroGenerationReadiness,
  now: Date.now,
  randomUUID,
}

function databaseFailure(resource: string) {
  return new XeroGenerationOperatorError({
    code: 'operator_internal_error',
    detail: `Test revalidation preflight could not verify ${resource}`,
    exitCode: 70,
  })
}

export async function loadXeroGenerationRevalidationPreflightState(params: {
  supabaseAdmin: SupabaseAdminClient
  userId: string
  tenantId: string
  grantId: string
  syncRunId: string
  nowIso: string
}): Promise<XeroGenerationRevalidationPreflightState> {
  const base = await loadXeroGenerationOperatorPreflightState(params)
  const runResult = await params.supabaseAdmin
    .from('xero_sync_runs')
    .select(
      'id, user_id, tenant_id, status, fencing_token, lease_owner, lease_expires_at, previous_active_sync_run_id'
    )
    .eq('id', params.syncRunId)
    .eq('user_id', params.userId)
    .eq('tenant_id', params.tenantId)
    .maybeSingle()
  if (runResult.error) throw databaseFailure('prepared run')

  const stateResult = await params.supabaseAdmin
    .from('xero_sync_tenant_state')
    .select(
      'active_sync_run_id, latest_sync_run_id, current_fencing_token, last_successful_sync_at'
    )
    .eq('user_id', params.userId)
    .eq('tenant_id', params.tenantId)
    .maybeSingle()
  if (stateResult.error) throw databaseFailure('tenant generation state')

  return {
    ...base,
    run: runResult.data as PreparedRun | null,
    tenantState: stateResult.data as TenantState | null,
  }
}

function validateInput(input: XeroGenerationRevalidationOperatorInput) {
  return {
    projectRef: requireXeroGenerationOperatorProjectRef(input.projectRef),
    userId: requireXeroGenerationOperatorUuid(input.userId, 'user-id'),
    tenantId: requireXeroGenerationOperatorUuid(input.tenantId, 'tenant-id'),
    grantId: requireXeroGenerationOperatorUuid(input.grantId, 'grant-id'),
    syncRunId: requireXeroGenerationOperatorUuid(input.syncRunId, 'run-id'),
    dryRun: input.dryRun,
  }
}

function validatePreflight(params: {
  input: ReturnType<typeof validateInput>
  state: XeroGenerationRevalidationPreflightState
  nowMs: number
}) {
  const { input, state } = params
  if (!state.userExists) {
    throw new XeroGenerationOperatorError({
      code: 'identity_mismatch',
      detail: 'the supplied user does not exist in the configured Test project',
    })
  }
  if (
    !state.connection ||
    state.connection.user_id !== input.userId ||
    state.connection.tenant_id !== input.tenantId ||
    state.connection.grant_id !== input.grantId ||
    !state.grant ||
    state.grant.id !== input.grantId ||
    state.grant.user_id !== input.userId
  ) {
    throw new XeroGenerationOperatorError({
      code: 'identity_mismatch',
      detail: 'the supplied user, tenant, grant, and connection do not match',
    })
  }
  if (state.connection.auth_state !== 'active') {
    throw new XeroGenerationOperatorError({
      code: 'connection_inactive',
      detail: 'the selected Test tenant connection is not active',
    })
  }
  const grantClassification = classifyXeroGrant({
    scopes: state.grant.scopes,
    authState: 'active',
    scopeMetadataKnown: Array.isArray(state.grant.scopes) && state.grant.scopes.length > 0,
  })
  if (grantClassification !== 'granular_ready') {
    throw new XeroGenerationOperatorError({
      code: 'permission_upgrade_required',
      detail: 'the selected grant is not granular_ready',
      safeContext: { grantClassification },
    })
  }
  if (!state.run || !state.tenantState) {
    throw new XeroGenerationOperatorError({
      code: 'identity_mismatch',
      detail: 'the supplied prepared run does not belong to this Test connection',
    })
  }
  if (
    state.run.id !== input.syncRunId ||
    state.run.user_id !== input.userId ||
    state.run.tenant_id !== input.tenantId ||
    state.tenantState.latest_sync_run_id !== input.syncRunId ||
    state.tenantState.current_fencing_token !== state.run.fencing_token
  ) {
    throw new XeroGenerationOperatorError({
      code: 'identity_mismatch',
      detail: 'the supplied run is not the current prepared run for this tenant',
    })
  }
  if (state.run.status !== 'running') {
    throw new XeroGenerationOperatorError({
      code: 'importer_not_ready',
      detail: 'the supplied run is not an eligible prepared running generation',
    })
  }
  if (state.tenantState.active_sync_run_id !== state.run.previous_active_sync_run_id) {
    throw new XeroGenerationOperatorError({
      code: 'importer_not_ready',
      detail: 'the active generation changed after this run was prepared',
    })
  }
  const leaseExpiry = state.run.lease_expires_at
    ? Date.parse(state.run.lease_expires_at)
    : Number.NaN
  if (Number.isFinite(leaseExpiry) && leaseExpiry > params.nowMs) {
    throw new XeroGenerationOperatorError({
      code: 'active_run_exists',
      detail: 'the prepared run still has a live lease; reacquisition is not permitted',
      safeContext: { runId: state.run.id, leaseExpiresAt: state.run.lease_expires_at },
    })
  }
  return grantClassification
}

export async function runXeroGenerationRevalidationOperator(params: {
  input: XeroGenerationRevalidationOperatorInput
  environment?: Pick<NodeJS.ProcessEnv, 'NEXT_PUBLIC_SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>
  dependencies?: Partial<Dependencies>
}) {
  const input = validateInput(params.input)
  const environment = params.environment ?? process.env
  const configuredProjectRef = ensureXeroGenerationOperatorCredentialTarget({
    projectRef: input.projectRef,
    supabaseUrl: environment.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
  })
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...params.dependencies }
  const nowMs = dependencies.now()
  const supabaseAdmin = dependencies.createSupabaseAdminClient()
  const state = await dependencies.loadPreflightState({
    supabaseAdmin,
    userId: input.userId,
    tenantId: input.tenantId,
    grantId: input.grantId,
    syncRunId: input.syncRunId,
    nowIso: new Date(nowMs).toISOString(),
  })
  const grantClassification = validatePreflight({ input, state, nowMs })
  const readiness = await dependencies.inspectReadiness({
    syncRunId: input.syncRunId,
    userId: input.userId,
    tenantId: input.tenantId,
    supabaseAdmin,
  })
  if (!readiness.ready) {
    throw new XeroGenerationOperatorError({
      code: 'importer_not_ready',
      detail: 'the prepared generation failed the current readiness contract',
      safeContext: { runId: input.syncRunId, resultCode: readiness.resultCode },
    })
  }

  const preflight = {
    targetProject: input.projectRef,
    configuredProject: configuredProjectRef,
    userId: input.userId,
    tenantId: input.tenantId,
    grantId: input.grantId,
    runId: input.syncRunId,
    grantClassification,
    runStatus: state.run!.status,
    currentFencingToken: state.run!.fencing_token,
    leaseState: 'expired' as const,
    activeSyncRunId: state.tenantState!.active_sync_run_id,
    readiness,
    promotionCapability: 'unavailable' as const,
  }

  if (input.dryRun) {
    return {
      schemaVersion: 1,
      mode: 'dry-run' as const,
      result: 'ready_to_reacquire' as const,
      preflight,
      reacquisitionCalls: 0,
      validationWrites: 0,
      promotionCapability: 'unavailable' as const,
    }
  }

  const leaseOwner = dependencies.randomUUID()
  const reacquisition = await dependencies.reacquire({
    syncRunId: input.syncRunId,
    userId: input.userId,
    tenantId: input.tenantId,
    leaseOwner,
    leaseTtlSeconds: 300,
    supabaseAdmin,
  })
  if (!reacquisition.acquired || !reacquisition.fencingToken || !reacquisition.leaseExpiresAt) {
    throw new XeroGenerationOperatorError({
      code: reacquisition.resultCode === 'lease_held' ? 'active_run_exists' : 'importer_not_ready',
      detail: 'the prepared generation could not be reacquired safely',
      safeContext: { runId: input.syncRunId, resultCode: reacquisition.resultCode },
    })
  }

  const evidence = await dependencies.recordReadiness({
    syncRunId: input.syncRunId,
    userId: input.userId,
    tenantId: input.tenantId,
    leaseOwner,
    fencingToken: reacquisition.fencingToken,
    supabaseAdmin,
  })
  if (!evidence.validated) {
    throw new XeroGenerationOperatorError({
      code: 'importer_not_ready',
      detail: 'the reacquired generation failed authoritative revalidation',
      safeContext: { runId: input.syncRunId, resultCode: evidence.resultCode },
    })
  }

  return {
    schemaVersion: 1,
    mode: 'execute' as const,
    result: 'reacquired_and_revalidated' as const,
    preflight,
    reacquisitionCalls: 1,
    validationWrites: 1,
    run: {
      runId: input.syncRunId,
      previousFencingToken: state.run!.fencing_token,
      fencingToken: reacquisition.fencingToken,
      leaseOwner,
      leaseExpiresAt: reacquisition.leaseExpiresAt,
    },
    evidence,
    contractVersion: XERO_GENERATION_READINESS_CONTRACT_VERSION,
    promotionCapability: 'unavailable' as const,
  }
}
