import 'server-only'

import { randomUUID } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import {
  importXeroGeneration,
  XeroGenerationImportError,
  type XeroGenerationImportResult,
} from '@/lib/xero/generation-importer'
import { loadXeroGenerationRunManifest } from '@/lib/xero/generation-run'
import { classifyXeroGrant, type XeroGrantClassification } from '@/lib/xero/scopes'

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>

export const XERO_GENERATION_OPERATOR_TEST_PROJECT_REF = 'rbmxegyiwntomhpbepnu'
export const XERO_GENERATION_OPERATOR_PRODUCTION_PROJECT_REF = 'sswyxbugbdoadktyaows'

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type XeroGenerationOperatorFailureCode =
  | 'invalid_arguments'
  | 'production_target_rejected'
  | 'unknown_target_rejected'
  | 'configured_target_mismatch'
  | 'credentials_unavailable'
  | 'identity_mismatch'
  | 'connection_inactive'
  | 'permission_upgrade_required'
  | 'active_run_exists'
  | 'importer_not_ready'
  | 'importer_failed'
  | 'operator_internal_error'

export class XeroGenerationOperatorError extends Error {
  readonly code: XeroGenerationOperatorFailureCode
  readonly detail: string
  readonly exitCode: number
  readonly safeContext: Record<string, string | number | null>

  constructor(params: {
    code: XeroGenerationOperatorFailureCode
    detail: string
    exitCode?: number
    safeContext?: Record<string, string | number | null>
  }) {
    super(`Xero generation operator failed (${params.code})`)
    this.name = 'XeroGenerationOperatorError'
    this.code = params.code
    this.detail = params.detail
    this.exitCode = params.exitCode ?? 1
    this.safeContext = params.safeContext ?? {}
  }
}

export interface XeroGenerationOperatorInput {
  projectRef: string
  userId: string
  tenantId: string
  grantId: string
  dryRun: boolean
}

interface OperatorConnection {
  user_id: string
  tenant_id: string
  grant_id: string | null
  auth_state: string
}

interface OperatorGrant {
  id: string
  user_id: string
  scopes: string[] | null
}

interface OperatorActiveRun {
  id: string
  lease_expires_at: string | null
}

export interface XeroGenerationOperatorPreflightState {
  userExists: boolean
  connection: OperatorConnection | null
  grant: OperatorGrant | null
  activeRun: OperatorActiveRun | null
}

interface XeroGenerationOperatorDependencies {
  createSupabaseAdminClient: typeof createSupabaseAdminClient
  loadPreflightState: typeof loadXeroGenerationOperatorPreflightState
  importGeneration: typeof importXeroGeneration
  loadManifest: typeof loadXeroGenerationRunManifest
  now: () => number
  randomUUID: () => string
}

const DEFAULT_DEPENDENCIES: XeroGenerationOperatorDependencies = {
  createSupabaseAdminClient,
  loadPreflightState: loadXeroGenerationOperatorPreflightState,
  importGeneration: importXeroGeneration,
  loadManifest: loadXeroGenerationRunManifest,
  now: Date.now,
  randomUUID,
}

export function requireXeroGenerationOperatorProjectRef(value: string) {
  const projectRef = value?.trim().toLowerCase()
  if (!projectRef || !PROJECT_REF_PATTERN.test(projectRef)) {
    throw new XeroGenerationOperatorError({
      code: 'invalid_arguments',
      detail: 'project-ref must be a 20-character lowercase Supabase project ref',
      exitCode: 64,
    })
  }
  if (projectRef === XERO_GENERATION_OPERATOR_PRODUCTION_PROJECT_REF) {
    throw new XeroGenerationOperatorError({
      code: 'production_target_rejected',
      detail: 'Production is structurally unavailable to this operator',
      exitCode: 64,
    })
  }
  if (projectRef !== XERO_GENERATION_OPERATOR_TEST_PROJECT_REF) {
    throw new XeroGenerationOperatorError({
      code: 'unknown_target_rejected',
      detail: 'project-ref is not in the operator Test allowlist',
      exitCode: 64,
    })
  }
  return projectRef
}

export function requireXeroGenerationOperatorUuid(value: string, label: string) {
  const uuid = value?.trim().toLowerCase()
  if (!uuid || !UUID_PATTERN.test(uuid)) {
    throw new XeroGenerationOperatorError({
      code: 'invalid_arguments',
      detail: `${label} must be a canonical UUID`,
      exitCode: 64,
    })
  }
  return uuid
}

export function readSupabaseProjectRef(rawUrl: string | undefined) {
  let url: URL
  try {
    url = new URL(rawUrl ?? '')
  } catch {
    throw new XeroGenerationOperatorError({
      code: 'credentials_unavailable',
      detail: 'NEXT_PUBLIC_SUPABASE_URL must be a valid HTTPS Supabase project URL',
      exitCode: 65,
    })
  }
  const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname)
  if (url.protocol !== 'https:' || !match) {
    throw new XeroGenerationOperatorError({
      code: 'credentials_unavailable',
      detail: 'NEXT_PUBLIC_SUPABASE_URL must identify a hosted Supabase project',
      exitCode: 65,
    })
  }
  return match[1]
}

function validateInput(input: XeroGenerationOperatorInput) {
  return {
    projectRef: requireXeroGenerationOperatorProjectRef(input.projectRef),
    userId: requireXeroGenerationOperatorUuid(input.userId, 'user-id'),
    tenantId: requireXeroGenerationOperatorUuid(input.tenantId, 'tenant-id'),
    grantId: requireXeroGenerationOperatorUuid(input.grantId, 'grant-id'),
    dryRun: input.dryRun,
  }
}

export function ensureXeroGenerationOperatorCredentialTarget(params: {
  projectRef: string
  supabaseUrl?: string
  serviceRoleKey?: string
}) {
  const configuredProjectRef = readSupabaseProjectRef(params.supabaseUrl)
  if (configuredProjectRef !== params.projectRef) {
    throw new XeroGenerationOperatorError({
      code: 'configured_target_mismatch',
      detail: 'CLI project-ref does not match the configured Supabase project',
      exitCode: 65,
      safeContext: { requestedProjectRef: params.projectRef, configuredProjectRef },
    })
  }
  if (!params.serviceRoleKey?.trim()) {
    throw new XeroGenerationOperatorError({
      code: 'credentials_unavailable',
      detail: 'SUPABASE_SERVICE_ROLE_KEY is required',
      exitCode: 65,
    })
  }
  return configuredProjectRef
}

function databaseFailure(resource: string) {
  return new XeroGenerationOperatorError({
    code: 'operator_internal_error',
    detail: `Test preflight could not verify ${resource}`,
    exitCode: 70,
  })
}

export async function loadXeroGenerationOperatorPreflightState(params: {
  supabaseAdmin: SupabaseAdminClient
  userId: string
  tenantId: string
  grantId: string
  nowIso: string
}): Promise<XeroGenerationOperatorPreflightState> {
  const userResult = await params.supabaseAdmin.auth.admin.getUserById(params.userId)
  if (userResult.error) throw databaseFailure('user identity')

  const connectionResult = await params.supabaseAdmin
    .from('xero_connections_public')
    .select('user_id, tenant_id, grant_id, auth_state')
    .eq('user_id', params.userId)
    .eq('tenant_id', params.tenantId)
    .maybeSingle()
  if (connectionResult.error) throw databaseFailure('tenant connection')

  const grantResult = await params.supabaseAdmin
    .from('xero_oauth_grants')
    .select('id, user_id, scopes')
    .eq('id', params.grantId)
    .eq('user_id', params.userId)
    .maybeSingle()
  if (grantResult.error) throw databaseFailure('grant ownership')

  const activeRunResult = await params.supabaseAdmin
    .from('xero_sync_runs')
    .select('id, lease_expires_at')
    .eq('user_id', params.userId)
    .eq('tenant_id', params.tenantId)
    .eq('status', 'running')
    .gt('lease_expires_at', params.nowIso)
    .limit(1)
    .maybeSingle()
  if (activeRunResult.error) throw databaseFailure('active tenant lease')

  return {
    userExists: Boolean(userResult.data?.user),
    connection: connectionResult.data as OperatorConnection | null,
    grant: grantResult.data as OperatorGrant | null,
    activeRun: activeRunResult.data as OperatorActiveRun | null,
  }
}

function validatePreflight(params: {
  input: ReturnType<typeof validateInput>
  state: XeroGenerationOperatorPreflightState
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
    state.connection.grant_id !== input.grantId
  ) {
    throw new XeroGenerationOperatorError({
      code: 'identity_mismatch',
      detail: 'the supplied user, tenant, and grant do not identify one connection',
    })
  }
  if (state.connection.auth_state !== 'active') {
    throw new XeroGenerationOperatorError({
      code: 'connection_inactive',
      detail: 'the selected Test tenant connection is not active',
    })
  }
  if (
    !state.grant ||
    state.grant.id !== input.grantId ||
    state.grant.user_id !== input.userId
  ) {
    throw new XeroGenerationOperatorError({
      code: 'identity_mismatch',
      detail: 'the supplied grant is not owned by the selected Test user',
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
  if (state.activeRun) {
    throw new XeroGenerationOperatorError({
      code: 'active_run_exists',
      detail: 'a non-expired generation run already owns this tenant',
      safeContext: {
        runId: state.activeRun.id,
        leaseExpiresAt: state.activeRun.lease_expires_at,
      },
    })
  }
  return grantClassification
}

function safePreflightOutput(params: {
  input: ReturnType<typeof validateInput>
  configuredProjectRef: string
  grantClassification: XeroGrantClassification
}) {
  return {
    targetProject: params.input.projectRef,
    configuredProject: params.configuredProjectRef,
    userId: params.input.userId,
    tenantId: params.input.tenantId,
    grantId: params.input.grantId,
    user: 'verified' as const,
    tenantConnection: 'verified_active' as const,
    grant: 'verified' as const,
    grantClassification: params.grantClassification,
    activeRunningGeneration: 'none' as const,
    promotionCapability: 'unavailable' as const,
  }
}

function safeDiagnostics(result: Extract<XeroGenerationImportResult, { status: 'ready_for_promotion' }>) {
  const resources = result.diagnostics.resources
  const resourceEntries = Object.entries(resources)
  const providerRequestCount = 1 + resourceEntries.reduce(
    (sum, [, resource]) => sum + resource.pageRequests,
    0
  )
  const httpAttemptCount = result.diagnostics.organisation.httpAttempts + resourceEntries.reduce(
    (sum, [, resource]) => sum + resource.httpAttempts,
    0
  )
  return {
    runStartedAt: result.diagnostics.runStartedAt,
    catchUpSince: result.diagnostics.catchUpSince,
    providerRequestCount,
    httpAttemptCount,
    retryAttemptCount: Math.max(0, httpAttemptCount - providerRequestCount),
    organisation: result.diagnostics.organisation,
    resources: result.diagnostics.resources,
  }
}

export async function runXeroGenerationOperator(params: {
  input: XeroGenerationOperatorInput
  environment?: Pick<NodeJS.ProcessEnv, 'NEXT_PUBLIC_SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>
  dependencies?: Partial<XeroGenerationOperatorDependencies>
}) {
  const input = validateInput(params.input)
  const environment = params.environment ?? process.env
  const configuredProjectRef = ensureXeroGenerationOperatorCredentialTarget({
    projectRef: input.projectRef,
    supabaseUrl: environment.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
  })
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...params.dependencies }
  const supabaseAdmin = dependencies.createSupabaseAdminClient()
  const preflightState = await dependencies.loadPreflightState({
    supabaseAdmin,
    userId: input.userId,
    tenantId: input.tenantId,
    grantId: input.grantId,
    nowIso: new Date(dependencies.now()).toISOString(),
  })
  const grantClassification = validatePreflight({ input, state: preflightState })
  const preflight = safePreflightOutput({ input, configuredProjectRef, grantClassification })

  if (input.dryRun) {
    return {
      schemaVersion: 1,
      mode: 'dry-run' as const,
      preflight,
      result: 'safe_to_invoke' as const,
      importerCalls: 0,
    }
  }

  const startedAtMs = dependencies.now()
  let result: XeroGenerationImportResult
  try {
    result = await dependencies.importGeneration({
      userId: input.userId,
      tenantId: input.tenantId,
      grantId: input.grantId,
      leaseOwner: dependencies.randomUUID(),
      supabaseAdmin,
    })
  } catch (error) {
    if (error instanceof XeroGenerationImportError) {
      throw new XeroGenerationOperatorError({
        code: 'importer_failed',
        detail: 'the importer failed and its inactive evidence was preserved',
        safeContext: {
          importerCode: error.code,
          resource: error.resource,
          runId: error.runId,
        },
      })
    }
    throw new XeroGenerationOperatorError({
      code: 'importer_failed',
      detail: 'the importer failed and its inactive evidence was preserved',
    })
  }

  if (result.status !== 'ready_for_promotion') {
    throw new XeroGenerationOperatorError({
      code: result.status === 'lease_held' || result.status === 'already_running'
        ? 'active_run_exists'
        : 'importer_not_ready',
      detail: 'the importer did not prepare a promotable inactive generation',
      safeContext: {
        importerStatus: result.status,
        runId: result.runId,
        leaseExpiresAt: result.leaseExpiresAt,
      },
    })
  }

  const manifest = await dependencies.loadManifest({
    syncRunId: result.runId,
    supabaseAdmin,
  })
  const finishedAtMs = dependencies.now()
  return {
    schemaVersion: 1,
    mode: 'execute' as const,
    preflight,
    result: 'ready_for_promotion' as const,
    importerCalls: 1,
    run: {
      runId: result.runId,
      fencingToken: result.fencingToken,
      leaseExpiresAt: result.leaseExpiresAt,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: Math.max(0, finishedAtMs - startedAtMs),
    },
    counts: result.counts,
    validation: result.validation,
    readiness: result.readiness,
    manifest,
    diagnostics: safeDiagnostics(result),
    promotionCapability: 'unavailable' as const,
  }
}

export function formatXeroGenerationOperatorFailure(error: unknown) {
  if (error instanceof XeroGenerationOperatorError) {
    return {
      exitCode: error.exitCode,
      output: {
        schemaVersion: 1,
        result: 'failed' as const,
        code: error.code,
        detail: error.detail,
        context: error.safeContext,
        promotionCapability: 'unavailable' as const,
      },
    }
  }
  return {
    exitCode: 70,
    output: {
      schemaVersion: 1,
      result: 'failed' as const,
      code: 'operator_internal_error' as const,
      detail: 'the operator failed without exposing internal error details',
      context: {},
      promotionCapability: 'unavailable' as const,
    },
  }
}
