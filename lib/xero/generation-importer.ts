import 'server-only'

import { isDeepStrictEqual } from 'node:util'
import { normalizeCurrencyCode } from '@/lib/money/currency'
import {
  elapsedMilliseconds,
  monotonicNow,
  recordFirstValueLatency,
  type FirstValueLatencyEvent,
} from '@/lib/observability/first-value-latency'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import {
  createXeroAuthorisedAccrecInvoicesConfig,
  createXeroAuthorisedAccrecPaymentsConfig,
  createXeroContactsCollectionConfig,
  createXeroInvoicesCollectionConfig,
  createXeroPaidAccrecInvoicesConfig,
  createXeroPaymentsCollectionConfig,
  fetchXeroOrganisation,
  fetchXeroPaginatedCollection,
  XeroAccountingRequestError,
  XeroPaginationError,
  type XeroAccountingRequestDependencies,
  type XeroAccountingRequestResult,
  type XeroAggregateRequestMetadata,
  type XeroPaginatedCollectionConfig,
  type XeroPaginatedCollectionResult,
} from '@/lib/xero/accounting-api-client'
import {
  XeroGenerationLeaseController,
  XeroGenerationLeaseLostError,
  type XeroGenerationLeaseTimerDependencies,
} from '@/lib/xero/generation-lease'
import { mapXeroGenerationToCanonical, type XeroGenerationMappingResult } from '@/lib/xero/generation-mapper'
import {
  recordXeroGenerationReadiness,
  XeroGenerationReadinessContractError,
  type XeroGenerationReadinessEvidence,
} from '@/lib/xero/generation-readiness'
import {
  acquireXeroGenerationRun,
  completeXeroGenerationRunStep,
  failXeroGenerationRun,
  heartbeatXeroGenerationRun,
  loadXeroGenerationRunManifest,
  XeroSyncRunContractError,
  type XeroSyncRunStepKey,
} from '@/lib/xero/generation-run'
import {
  persistXeroGenerationRawBatch,
  XeroPersistenceError,
  type XeroGenerationRawResourceType,
  type XeroPersistenceCounts,
} from '@/lib/xero/persistence'
import { assessXeroGenerationImportCapabilities } from '@/lib/xero/scopes'
import {
  getValidXeroAccessTokenForTenant,
  type TokenAcquisitionResult,
} from '@/lib/xero/sync'

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>
type ProviderRecord = Record<string, unknown>

export const XERO_GENERATION_IMPORT_SCOPE_VERSION = 'collections_v1'
export const XERO_GENERATION_IMPORT_DEFAULT_LEASE_TTL_SECONDS = 300
export const XERO_GENERATION_IMPORT_DEFAULT_DEADLINE_MS = 240_000
// Xero permits five concurrent calls per tenant. Keep one slot in reserve for
// recovery/other tenant-scoped work while allowing all four independent first
// value streams to progress together.
export const XERO_GENERATION_IMPORT_MAX_PROVIDER_CONCURRENCY = 4
export const XERO_GENERATION_IMPORT_CATCH_UP_OVERLAP_MS = 5_000

export type XeroGenerationImportFailureCode =
  | 'xero_reauth_required'
  | 'xero_permission_required'
  | 'xero_rate_limited'
  | 'xero_daily_limit'
  | 'provider_unavailable'
  | 'provider_timeout'
  | 'run_deadline'
  | 'run_cancelled'
  | 'lease_lost'
  | 'provider_data_invalid'
  | 'generation_validation_failed'
  | 'persistence_failed'

export class XeroGenerationImportError extends Error {
  readonly code: XeroGenerationImportFailureCode
  readonly resource: string | null
  readonly runId: string | null

  constructor(params: {
    code: XeroGenerationImportFailureCode
    resource?: string | null
    runId?: string | null
    detail?: string
  }) {
    const detail = params.detail ? `: ${params.detail}` : ''
    super(`Xero generation import failed (${params.code})${detail}`)
    this.name = 'XeroGenerationImportError'
    this.code = params.code
    this.resource = params.resource ?? null
    this.runId = params.runId ?? null
  }
}

interface GenerationAccessTokenSuccess {
  ok: true
  accessToken: string
  tenantId: string
  grantId: string
  scopes: string[]
}

interface GenerationAccessTokenFailure {
  ok: false
  code: XeroGenerationImportFailureCode
}

type GenerationAccessTokenResult =
  | GenerationAccessTokenSuccess
  | GenerationAccessTokenFailure

interface GenerationRunAuthority {
  syncRunId: string
  userId: string
  tenantId: string
  leaseOwner: string
  fencingToken: number
}

interface XeroGenerationImportDependencies {
  createSupabaseAdminClient: typeof createSupabaseAdminClient
  acquireRun: typeof acquireXeroGenerationRun
  heartbeatRun: typeof heartbeatXeroGenerationRun
  completeStep: typeof completeXeroGenerationRunStep
  failRun: typeof failXeroGenerationRun
  loadManifest: typeof loadXeroGenerationRunManifest
  loadAccessToken: (params: {
    supabaseAdmin: SupabaseAdminClient
    userId: string
    tenantId: string
    forceRefresh?: boolean
  }) => Promise<GenerationAccessTokenResult>
  fetchOrganisation: typeof fetchXeroOrganisation
  fetchCollection: typeof fetchXeroPaginatedCollection
  persistRaw: typeof persistXeroGenerationRawBatch
  mapCanonical: typeof mapXeroGenerationToCanonical
  recordReadiness: typeof recordXeroGenerationReadiness
  now: () => number
  monotonicNow: () => number
  recordLatency: (event: FirstValueLatencyEvent) => void
  scheduleDeadline: XeroGenerationLeaseTimerDependencies['schedule']
  cancelDeadline: XeroGenerationLeaseTimerDependencies['cancel']
  leaseTimers?: Partial<XeroGenerationLeaseTimerDependencies>
  requestDependencies?: Partial<XeroAccountingRequestDependencies>
}

export interface XeroGenerationImportDiagnostics {
  runStartedAt: string
  catchUpSince: string
  organisation: {
    records: number
    httpAttempts: number
    metadata: XeroAggregateRequestMetadata
  }
  resources: Record<
    'contacts' | 'authorisedInvoices' | 'paidInvoices' | 'payments' | 'catchUpContacts' | 'catchUpInvoices' | 'catchUpPayments',
    {
      records: number
      populatedPages: number
      pageRequests: number
      httpAttempts: number
      metadata: XeroAggregateRequestMetadata
    }
  >
  timings: {
    totalMs: number
    acquisitionMs: number
    providerWallMs: number
    organisationPersistenceMs: number
    rawPersistenceMs: number
    canonicalMappingMs: number
    validationMs: number
    providerCalls: Record<
      | 'organisation'
      | 'contacts'
      | 'authorisedInvoices'
      | 'paidInvoices'
      | 'payments'
      | 'catchUpContacts'
      | 'catchUpInvoices'
      | 'catchUpPayments',
      number
    >
  }
}

export type XeroGenerationImportResult =
  | {
      status: 'ready_for_promotion'
      runId: string
      fencingToken: number
      leaseExpiresAt: string | null
      counts: {
        organisation: number
        contacts: number
        authorisedInvoices: number
        paidInvoices: number
        payments: number
        canonical: XeroGenerationMappingResult['counts']
      }
      validation: XeroGenerationMappingResult['validation']
      readiness: XeroGenerationReadinessEvidence
      diagnostics: XeroGenerationImportDiagnostics
    }
  | {
      status: 'already_running' | 'lease_held' | 'connection_not_available'
      runId: string | null
      fencingToken: number | null
      leaseExpiresAt: string | null
    }

const DEFAULT_DEPENDENCIES: XeroGenerationImportDependencies = {
  createSupabaseAdminClient,
  acquireRun: acquireXeroGenerationRun,
  heartbeatRun: heartbeatXeroGenerationRun,
  completeStep: completeXeroGenerationRunStep,
  failRun: failXeroGenerationRun,
  loadManifest: loadXeroGenerationRunManifest,
  loadAccessToken: loadGenerationAccessToken,
  fetchOrganisation: fetchXeroOrganisation,
  fetchCollection: fetchXeroPaginatedCollection,
  persistRaw: persistXeroGenerationRawBatch,
  mapCanonical: mapXeroGenerationToCanonical,
  recordReadiness: recordXeroGenerationReadiness,
  now: Date.now,
  monotonicNow,
  recordLatency: recordFirstValueLatency,
  scheduleDeadline: (callback, milliseconds) => setTimeout(callback, milliseconds),
  cancelDeadline: (handle) => clearTimeout(handle),
}

function requireNonEmpty(value: string, label: string) {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${label} is required`)
  return normalized
}

function requirePositiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`)
  }
  return value
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseUpdatedAt(record: ProviderRecord) {
  const raw = readString(record.UpdatedDateUTC)
  if (!raw) return null
  const xeroMatch = /^\/Date\((\d+)(?:[+-]\d{4})?\)\/$/.exec(raw)
  const timestamp = xeroMatch ? Number(xeroMatch[1]) : Date.parse(raw)
  return Number.isFinite(timestamp) ? timestamp : null
}

function mergeProviderRecords(params: {
  resource: 'contacts' | 'invoices' | 'payments'
  sourceIdKey: 'ContactID' | 'InvoiceID' | 'PaymentID'
  collections: readonly (readonly ProviderRecord[])[]
}) {
  const merged = new Map<string, ProviderRecord>()
  for (const collection of params.collections) {
    for (const record of collection) {
      const sourceId = readString(record[params.sourceIdKey])
      if (!sourceId) {
        throw new XeroGenerationImportError({
          code: 'provider_data_invalid',
          resource: params.resource,
          detail: `record was missing ${params.sourceIdKey}`,
        })
      }
      const previous = merged.get(sourceId)
      if (!previous) {
        merged.set(sourceId, record)
        continue
      }
      if (isDeepStrictEqual(previous, record)) continue

      const previousUpdatedAt = parseUpdatedAt(previous)
      const nextUpdatedAt = parseUpdatedAt(record)
      if (previousUpdatedAt === null || nextUpdatedAt === null || previousUpdatedAt === nextUpdatedAt) {
        throw new XeroGenerationImportError({
          code: 'provider_data_invalid',
          resource: params.resource,
          detail: 'conflicting versions lacked a deterministic UpdatedDateUTC ordering',
        })
      }
      if (nextUpdatedAt > previousUpdatedAt) merged.set(sourceId, record)
    }
  }
  return [...merged.values()].sort((left, right) =>
    String(left[params.sourceIdKey]).localeCompare(String(right[params.sourceIdKey]))
  )
}

function isRequiredInvoice(record: ProviderRecord) {
  return readString(record.Type)?.toUpperCase() === 'ACCREC' &&
    ['AUTHORISED', 'PAID'].includes(readString(record.Status)?.toUpperCase() ?? '')
}

function isAuthorisedInvoice(record: ProviderRecord) {
  return readString(record.Status)?.toUpperCase() === 'AUTHORISED'
}

function isPaidInvoice(record: ProviderRecord) {
  return readString(record.Status)?.toUpperCase() === 'PAID'
}

function isRequiredPayment(record: ProviderRecord) {
  return readString(record.PaymentType)?.toUpperCase() === 'ACCRECPAYMENT' &&
    readString(record.Status)?.toUpperCase() === 'AUTHORISED'
}

function diagnosticsFor(result: XeroPaginatedCollectionResult<ProviderRecord>) {
  return {
    records: result.recordCount,
    populatedPages: result.populatedPageCount,
    pageRequests: result.pageRequestCount,
    httpAttempts: result.httpAttemptCount,
    metadata: result.metadata,
  }
}

async function parseTokenFailure(result: TokenAcquisitionResult): Promise<GenerationAccessTokenFailure> {
  if (result.ok) throw new Error('Token result was successful')
  let responseCode: string | null = null
  try {
    const payload = await result.response.clone().json() as { code?: unknown }
    responseCode = readString(payload.code)
  } catch {
    // The response body is intentionally reduced to a safe classification only.
  }
  const reauthCodes = new Set([
    'XERO_REAUTH_REQUIRED',
    'XERO_AUTH_STATE_BLOCKED',
    'XERO_NOT_CONNECTED',
  ])
  if (responseCode === 'XERO_PERMISSION_UPGRADE_REQUIRED') {
    return { ok: false, code: 'xero_permission_required' }
  }
  return {
    ok: false,
    code: responseCode && reauthCodes.has(responseCode)
      ? 'xero_reauth_required'
      : 'provider_unavailable',
  }
}

async function loadGenerationAccessToken(params: {
  supabaseAdmin: SupabaseAdminClient
  userId: string
  tenantId: string
  forceRefresh?: boolean
}): Promise<GenerationAccessTokenResult> {
  const result = await getValidXeroAccessTokenForTenant(params)
  if (!result.ok) return parseTokenFailure(result)
  return {
    ok: true,
    accessToken: result.accessToken,
    tenantId: result.connection.tenant_id,
    grantId: result.grantId,
    scopes: result.scopes,
  }
}

function classifyError(error: unknown, runId: string | null): XeroGenerationImportError {
  if (error instanceof XeroGenerationImportError) return error
  if (error instanceof XeroGenerationLeaseLostError) {
    return new XeroGenerationImportError({ code: 'lease_lost', runId })
  }
  if (error instanceof XeroAccountingRequestError) {
    const code: XeroGenerationImportFailureCode = (() => {
      if (error.kind === 'authentication') return 'xero_reauth_required'
      if (error.kind === 'permission') return 'xero_permission_required'
      if (error.kind === 'daily_rate_limit') return 'xero_daily_limit'
      if (error.kind === 'rate_limit') return 'xero_rate_limited'
      if (error.kind === 'timeout') return 'provider_timeout'
      if (error.kind === 'deadline') return 'run_deadline'
      if (error.kind === 'malformed_response') return 'provider_data_invalid'
      if (error.kind === 'cancelled') return 'run_cancelled'
      if (error.kind === 'http' && !error.retryable) return 'provider_data_invalid'
      return 'provider_unavailable'
    })()
    return new XeroGenerationImportError({ code, resource: error.resource, runId })
  }
  if (error instanceof XeroPaginationError) {
    return new XeroGenerationImportError({
      code: 'provider_data_invalid',
      resource: error.resource,
      runId,
    })
  }
  if (error instanceof XeroPersistenceError) {
    return new XeroGenerationImportError({
      code: 'persistence_failed',
      resource: error.resourceType,
      runId,
    })
  }
  if (error instanceof XeroSyncRunContractError) {
    return new XeroGenerationImportError({
      code: 'persistence_failed',
      resource: error.operation,
      runId,
    })
  }
  if (error instanceof XeroGenerationReadinessContractError) {
    return new XeroGenerationImportError({
      code: 'persistence_failed',
      resource: error.operation,
      runId,
    })
  }
  if (error instanceof Error && error.name === 'XeroGenerationMappingValidationError') {
    const resource = 'resource' in error && typeof error.resource === 'string'
      ? error.resource
      : 'canonical_mapping'
    return new XeroGenerationImportError({
      code: 'generation_validation_failed',
      resource,
      runId,
    })
  }
  return new XeroGenerationImportError({ code: 'provider_unavailable', runId })
}

async function runWithConcurrency<T>(
  tasks: readonly (() => Promise<T>)[],
  concurrency: number
) {
  const results = new Array<T>(tasks.length)
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < tasks.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await tasks[index]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
  return results
}

function assertOrganisation(records: ProviderRecord[], tenantId: string) {
  if (records.length !== 1) {
    throw new XeroGenerationImportError({
      code: 'provider_data_invalid',
      resource: 'organisation',
      detail: `expected exactly one organisation, received ${records.length}`,
    })
  }
  const organisationId = readString(records[0].OrganisationID)
  const baseCurrency = normalizeCurrencyCode(records[0].BaseCurrency)
  if (!organisationId || !baseCurrency) {
    throw new XeroGenerationImportError({
      code: 'provider_data_invalid',
      resource: 'organisation',
      detail: 'organisation identity or base currency was invalid',
    })
  }
  if (organisationId.toLowerCase() !== tenantId.toLowerCase()) {
    throw new XeroGenerationImportError({
      code: 'provider_data_invalid',
      resource: 'organisation',
      detail: 'organisation identity did not match the selected Xero tenant',
    })
  }
}

function assertFinalManifest(params: {
  manifest: Awaited<ReturnType<typeof loadXeroGenerationRunManifest>>
  expected: Record<Exclude<XeroSyncRunStepKey, 'validation'>, number>
}) {
  const byKey = new Map(params.manifest.map((step) => [step.stepKey, step]))
  for (const [stepKey, expectedCount] of Object.entries(params.expected)) {
    const step = byKey.get(stepKey as XeroSyncRunStepKey)
    if (!step || step.status !== 'succeeded' || step.recordCount !== expectedCount) {
      throw new XeroGenerationImportError({
        code: 'generation_validation_failed',
        resource: stepKey,
        detail: 'required manifest step was incomplete or inconsistent',
      })
    }
  }
  const validation = byKey.get('validation')
  if (!validation || validation.status !== 'pending' || validation.recordCount !== null) {
    throw new XeroGenerationImportError({
      code: 'generation_validation_failed',
      resource: 'validation',
      detail: 'validation step was not in the expected pending state',
    })
  }
}

export async function importXeroGeneration(params: {
  userId: string
  tenantId: string
  grantId: string
  leaseOwner: string
  scopeVersion?: typeof XERO_GENERATION_IMPORT_SCOPE_VERSION
  leaseTtlSeconds?: number
  heartbeatIntervalMs?: number
  deadlineMs?: number
  signal?: AbortSignal
  supabaseAdmin?: SupabaseAdminClient
  dependencies?: Partial<XeroGenerationImportDependencies>
}): Promise<XeroGenerationImportResult> {
  const userId = requireNonEmpty(params.userId, 'userId')
  const tenantId = requireNonEmpty(params.tenantId, 'tenantId')
  const grantId = requireNonEmpty(params.grantId, 'grantId')
  const leaseOwner = requireNonEmpty(params.leaseOwner, 'leaseOwner')
  const scopeVersion = params.scopeVersion ?? XERO_GENERATION_IMPORT_SCOPE_VERSION
  const leaseTtlSeconds = requirePositiveInteger(
    params.leaseTtlSeconds ?? XERO_GENERATION_IMPORT_DEFAULT_LEASE_TTL_SECONDS,
    'leaseTtlSeconds'
  )
  const deadlineMs = requirePositiveInteger(
    params.deadlineMs ?? XERO_GENERATION_IMPORT_DEFAULT_DEADLINE_MS,
    'deadlineMs'
  )
  const heartbeatIntervalMs = requirePositiveInteger(
    params.heartbeatIntervalMs ?? Math.min(60_000, Math.floor(leaseTtlSeconds * 1_000 / 3)),
    'heartbeatIntervalMs'
  )
  if (heartbeatIntervalMs >= leaseTtlSeconds * 1_000 / 2) {
    throw new RangeError('heartbeatIntervalMs must be less than half the lease TTL')
  }

  const dependencies = { ...DEFAULT_DEPENDENCIES, ...params.dependencies }
  const supabaseAdmin = params.supabaseAdmin ?? dependencies.createSupabaseAdminClient()
  const runStartedMs = dependencies.now()
  const importStartedAt = dependencies.monotonicNow()
  const deadlineAtMs = runStartedMs + deadlineMs
  if (params.signal?.aborted) {
    throw new XeroGenerationImportError({ code: 'run_cancelled' })
  }

  let acquisition: Awaited<ReturnType<typeof acquireXeroGenerationRun>>
  try {
    acquisition = await dependencies.acquireRun({
      userId,
      tenantId,
      leaseOwner,
      scopeVersion,
      leaseTtlSeconds,
      supabaseAdmin,
    })
  } catch {
    throw new XeroGenerationImportError({ code: 'provider_unavailable', resource: 'acquire' })
  }
  if (!acquisition.acquired) {
    const status = acquisition.resultCode === 'connection_not_available'
      ? 'connection_not_available'
      : 'lease_held'
    dependencies.recordLatency({
      stage: 'T2',
      outcome: status === 'lease_held' ? 'deduplicated' : 'blocked',
      userId,
      tenantId,
      durationMs: elapsedMilliseconds(importStartedAt, dependencies.monotonicNow()),
      detail: acquisition.resultCode,
    })
    return {
      status,
      runId: null,
      fencingToken: null,
      leaseExpiresAt: acquisition.leaseExpiresAt,
    }
  }
  if (!acquisition.syncRunId || !acquisition.fencingToken) {
    throw new XeroGenerationImportError({ code: 'provider_unavailable' })
  }
  if (acquisition.resultCode === 'already_owned') {
    dependencies.recordLatency({
      stage: 'T2',
      outcome: 'deduplicated',
      userId,
      tenantId,
      syncRunId: acquisition.syncRunId,
      durationMs: elapsedMilliseconds(importStartedAt, dependencies.monotonicNow()),
      detail: 'already_owned',
    })
    return {
      status: 'already_running',
      runId: acquisition.syncRunId,
      fencingToken: acquisition.fencingToken,
      leaseExpiresAt: acquisition.leaseExpiresAt,
    }
  }

  const authority: GenerationRunAuthority = {
    syncRunId: acquisition.syncRunId,
    userId,
    tenantId,
    leaseOwner,
    fencingToken: acquisition.fencingToken,
  }
  const acquisitionMs = elapsedMilliseconds(importStartedAt, dependencies.monotonicNow())
  dependencies.recordLatency({
    stage: 'T2',
    outcome: 'started',
    userId,
    tenantId,
    syncRunId: authority.syncRunId,
    durationMs: acquisitionMs,
  })
  const abortController = new AbortController()
  let latestLeaseExpiresAt = acquisition.leaseExpiresAt
  let deadlineReached = false
  let externallyCancelled = false
  const onExternalAbort = () => {
    externallyCancelled = true
    abortController.abort()
  }
  params.signal?.addEventListener('abort', onExternalAbort, { once: true })
  const deadlineHandle = dependencies.scheduleDeadline(() => {
    deadlineReached = true
    abortController.abort()
  }, Math.max(0, deadlineAtMs - dependencies.now()))
  const lease = new XeroGenerationLeaseController({
    heartbeatIntervalMs,
    abortController,
    timers: dependencies.leaseTimers,
    heartbeat: async () => {
      const result = await dependencies.heartbeatRun({
        syncRunId: authority.syncRunId,
        leaseOwner: authority.leaseOwner,
        fencingToken: authority.fencingToken,
        leaseTtlSeconds,
        supabaseAdmin,
      })
      if (result.renewed) latestLeaseExpiresAt = result.leaseExpiresAt
      return result
    },
  })
  lease.start()

  const assertCanContinue = () => {
    lease.assertOwned()
    if (deadlineReached || dependencies.now() >= deadlineAtMs) {
      throw new XeroGenerationImportError({ code: 'run_deadline', runId: authority.syncRunId })
    }
    if (externallyCancelled) {
      throw new XeroGenerationImportError({ code: 'run_cancelled', runId: authority.syncRunId })
    }
  }

  const completeStep = async (stepKey: XeroSyncRunStepKey, recordCount: number) => {
    assertCanContinue()
    const result = await dependencies.completeStep({
      syncRunId: authority.syncRunId,
      leaseOwner: authority.leaseOwner,
      fencingToken: authority.fencingToken,
      stepKey,
      recordCount,
      supabaseAdmin,
    })
    if (!result.completed) {
      if (result.resultCode === 'record_count_conflict' || result.resultCode === 'unknown_step') {
        throw new XeroGenerationImportError({
          code: 'generation_validation_failed',
          resource: stepKey,
          runId: authority.syncRunId,
        })
      }
      throw new XeroGenerationLeaseLostError(result.resultCode)
    }
  }

  let accessToken = ''
  let forcedRefresh: Promise<void> | null = null
  const loadToken = async (forceRefresh = false) => {
    const token = await dependencies.loadAccessToken({
      supabaseAdmin,
      userId,
      tenantId,
      forceRefresh,
    })
    if (!token.ok) throw new XeroGenerationImportError({ code: token.code, runId: authority.syncRunId })
    if (token.tenantId !== tenantId || token.grantId !== grantId) {
      throw new XeroGenerationImportError({
        code: 'xero_reauth_required',
        resource: 'grant',
        runId: authority.syncRunId,
      })
    }
    const capabilities = assessXeroGenerationImportCapabilities(token.scopes)
    if (!capabilities.sufficient) {
      throw new XeroGenerationImportError({
        code: 'xero_permission_required',
        resource: capabilities.missing[0] ?? 'scope',
        runId: authority.syncRunId,
      })
    }
    accessToken = token.accessToken
  }

  const withAuthenticationRetry = async <T>(operation: (token: string) => Promise<T>) => {
    assertCanContinue()
    try {
      return await operation(accessToken)
    } catch (error) {
      if (!(error instanceof XeroAccountingRequestError) || error.kind !== 'authentication') {
        throw error
      }
      if (!forcedRefresh) {
        forcedRefresh = loadToken(true)
      }
      await forcedRefresh
      assertCanContinue()
      return operation(accessToken)
    }
  }

  const providerCallDurations = {} as XeroGenerationImportDiagnostics['timings']['providerCalls']
  const timeProviderCall = async <T>(
    name: keyof XeroGenerationImportDiagnostics['timings']['providerCalls'],
    operation: () => Promise<T>
  ) => {
    const startedAt = dependencies.monotonicNow()
    try {
      return await operation()
    } finally {
      providerCallDurations[name] = elapsedMilliseconds(
        startedAt,
        dependencies.monotonicNow()
      )
    }
  }

  const fetchCollection = (
    config: XeroPaginatedCollectionConfig<ProviderRecord>,
    ifModifiedSince?: string
  ) => withAuthenticationRetry((token) => dependencies.fetchCollection({
    accessToken: token,
    tenantId,
    config,
    ifModifiedSince,
    signal: lease.signal,
    deadlineAtMs,
    dependencies: dependencies.requestDependencies,
  }))

  const persistRaw = async (
    resourceType: XeroGenerationRawResourceType,
    records: ProviderRecord[],
    fetchedAt: string
  ): Promise<XeroPersistenceCounts> => {
    assertCanContinue()
    const result = await dependencies.persistRaw({
      ...authority,
      resourceType,
      fetchedAt,
      records,
      supabaseAdmin,
    })
    assertCanContinue()
    return result
  }

  try {
    await loadToken()
    assertCanContinue()

    const providerStartedAt = dependencies.monotonicNow()
    dependencies.recordLatency({
      stage: 'T3',
      outcome: 'started',
      userId,
      tenantId,
      syncRunId: authority.syncRunId,
    })
    const organisationResult: XeroAccountingRequestResult<ProviderRecord> =
      await timeProviderCall('organisation', () =>
        withAuthenticationRetry((token) => dependencies.fetchOrganisation({
          accessToken: token,
          tenantId,
          signal: lease.signal,
          deadlineAtMs,
          dependencies: dependencies.requestDependencies,
        }))
      )
    assertOrganisation(organisationResult.records, tenantId)
    const organisationFetchedAt = new Date(dependencies.now()).toISOString()
    const organisationPersistenceStartedAt = dependencies.monotonicNow()
    const organisationPersistence = (async () => {
      await persistRaw('organisations', organisationResult.records, organisationFetchedAt)
      await completeStep('organisation', 1)
      return elapsedMilliseconds(
        organisationPersistenceStartedAt,
        dependencies.monotonicNow()
      )
    })()

    const contactsConfig = createXeroContactsCollectionConfig({ includeArchived: true })
    const authorisedInvoicesConfig = createXeroAuthorisedAccrecInvoicesConfig()
    const paidInvoicesConfig = createXeroPaidAccrecInvoicesConfig()
    const authorisedPaymentsConfig = createXeroAuthorisedAccrecPaymentsConfig()

    const [primaryResults, organisationPersistenceMs] = await Promise.all([
      runWithConcurrency([
        () => timeProviderCall('contacts', () => fetchCollection(contactsConfig)),
        () => timeProviderCall('authorisedInvoices', () => fetchCollection(authorisedInvoicesConfig)),
        () => timeProviderCall('paidInvoices', () => fetchCollection(paidInvoicesConfig)),
        () => timeProviderCall('payments', () => fetchCollection(authorisedPaymentsConfig)),
      ], XERO_GENERATION_IMPORT_MAX_PROVIDER_CONCURRENCY),
      organisationPersistence,
    ])
    const [contactsPrimary, authorisedPrimary, paidPrimary, paymentsPrimary] = primaryResults

    const catchUpSince = new Date(
      runStartedMs - XERO_GENERATION_IMPORT_CATCH_UP_OVERLAP_MS
    ).toISOString()
    const [contactsCatchUp, invoicesCatchUp, paymentsCatchUp] = await runWithConcurrency([
      () => timeProviderCall('catchUpContacts', () => fetchCollection(contactsConfig, catchUpSince)),
      () => timeProviderCall('catchUpInvoices', () => fetchCollection(createXeroInvoicesCollectionConfig({
        where: 'Type=="ACCREC"',
      }), catchUpSince)),
      () => timeProviderCall('catchUpPayments', () => fetchCollection(createXeroPaymentsCollectionConfig({
        where: 'PaymentType=="ACCRECPAYMENT"',
      }), catchUpSince)),
    ], XERO_GENERATION_IMPORT_MAX_PROVIDER_CONCURRENCY)
    const providerWallMs = elapsedMilliseconds(providerStartedAt, dependencies.monotonicNow())
    dependencies.recordLatency({
      stage: 'T4',
      outcome: 'succeeded',
      userId,
      tenantId,
      syncRunId: authority.syncRunId,
      durationMs: providerWallMs,
      metrics: {
        ...providerCallDurations,
        organisation_persistence_ms: organisationPersistenceMs,
      },
    })

    const contacts = mergeProviderRecords({
      resource: 'contacts',
      sourceIdKey: 'ContactID',
      collections: [contactsPrimary.records, contactsCatchUp.records],
    })
    const invoices = mergeProviderRecords({
      resource: 'invoices',
      sourceIdKey: 'InvoiceID',
      collections: [authorisedPrimary.records, paidPrimary.records, invoicesCatchUp.records],
    }).filter(isRequiredInvoice)
    const payments = mergeProviderRecords({
      resource: 'payments',
      sourceIdKey: 'PaymentID',
      collections: [paymentsPrimary.records, paymentsCatchUp.records],
    }).filter(isRequiredPayment)
    const authorisedInvoiceCount = invoices.filter(isAuthorisedInvoice).length
    const paidInvoiceCount = invoices.filter(isPaidInvoice).length
    const resourcesFetchedAt = new Date(dependencies.now()).toISOString()

    const rawPersistenceStartedAt = dependencies.monotonicNow()
    await Promise.all([
      (async () => {
        await persistRaw('contacts', contacts, resourcesFetchedAt)
        await completeStep('contacts', contacts.length)
      })(),
      (async () => {
        await persistRaw('invoices', invoices, resourcesFetchedAt)
        await Promise.all([
          completeStep('authorised_accrec_invoices', authorisedInvoiceCount),
          completeStep('paid_accrec_invoices', paidInvoiceCount),
        ])
      })(),
      (async () => {
        await persistRaw('payments', payments, resourcesFetchedAt)
        await completeStep('authorised_accrec_payments', payments.length)
      })(),
    ])
    const rawPersistenceMs = elapsedMilliseconds(
      rawPersistenceStartedAt,
      dependencies.monotonicNow()
    )

    assertCanContinue()
    let mapping: XeroGenerationMappingResult
    const canonicalMappingStartedAt = dependencies.monotonicNow()
    try {
      mapping = await dependencies.mapCanonical({ ...authority, supabaseAdmin })
    } catch (error) {
      if (
        error instanceof XeroPersistenceError ||
        (error instanceof Error && error.name === 'XeroGenerationMappingValidationError')
      ) {
        throw error
      }
      throw new XeroGenerationImportError({
        code: 'persistence_failed',
        resource: 'canonical_mapping',
        runId: authority.syncRunId,
      })
    }
    assertCanContinue()
    if (
      mapping.counts.organisations !== 1 ||
      mapping.counts.customers !== contacts.length ||
      mapping.counts.invoices !== invoices.length ||
      mapping.counts.payments !== payments.length ||
      !normalizeCurrencyCode(mapping.validation.organisationBaseCurrencyCode) ||
      mapping.validation.incompleteFxInvoiceCount !== 0 ||
      mapping.validation.completeFxInvoiceCount !== mapping.counts.invoices
    ) {
      throw new XeroGenerationImportError({
        code: 'generation_validation_failed',
        resource: 'canonical_mapping',
        runId: authority.syncRunId,
      })
    }
    const canonicalCount = Object.values(mapping.counts).reduce((sum, count) => sum + count, 0)
    await completeStep('canonical_mapping', canonicalCount)
    const canonicalMappingMs = elapsedMilliseconds(
      canonicalMappingStartedAt,
      dependencies.monotonicNow()
    )
    dependencies.recordLatency({
      stage: 'T5',
      outcome: 'succeeded',
      userId,
      tenantId,
      syncRunId: authority.syncRunId,
      durationMs: rawPersistenceMs + canonicalMappingMs,
      metrics: { raw_persistence_ms: rawPersistenceMs, canonical_mapping_ms: canonicalMappingMs },
    })

    const validationStartedAt = dependencies.monotonicNow()
    const manifest = await dependencies.loadManifest({
      syncRunId: authority.syncRunId,
      supabaseAdmin,
    })
    assertFinalManifest({
      manifest,
      expected: {
        organisation: 1,
        contacts: contacts.length,
        authorised_accrec_invoices: authorisedInvoiceCount,
        paid_accrec_invoices: paidInvoiceCount,
        authorised_accrec_payments: payments.length,
        canonical_mapping: canonicalCount,
      },
    })
    const readiness = await dependencies.recordReadiness({
      ...authority,
      supabaseAdmin,
    })
    if (!readiness.validated) {
      throw new XeroGenerationImportError({
        code: 'generation_validation_failed',
        resource: readiness.resultCode,
        runId: authority.syncRunId,
      })
    }
    await completeStep('validation', 1)
    await lease.renewNow()
    const validationMs = elapsedMilliseconds(
      validationStartedAt,
      dependencies.monotonicNow()
    )
    dependencies.recordLatency({
      stage: 'T6',
      outcome: 'succeeded',
      userId,
      tenantId,
      syncRunId: authority.syncRunId,
      durationMs: validationMs,
    })

    return {
      status: 'ready_for_promotion',
      runId: authority.syncRunId,
      fencingToken: authority.fencingToken,
      leaseExpiresAt: latestLeaseExpiresAt,
      counts: {
        organisation: 1,
        contacts: contacts.length,
        authorisedInvoices: authorisedInvoiceCount,
        paidInvoices: paidInvoiceCount,
        payments: payments.length,
        canonical: mapping.counts,
      },
      validation: mapping.validation,
      readiness,
      diagnostics: {
        runStartedAt: new Date(runStartedMs).toISOString(),
        catchUpSince,
        organisation: {
          records: organisationResult.records.length,
          httpAttempts: organisationResult.attemptCount,
          metadata: organisationResult.metadata,
        },
        resources: {
          contacts: diagnosticsFor(contactsPrimary),
          authorisedInvoices: diagnosticsFor(authorisedPrimary),
          paidInvoices: diagnosticsFor(paidPrimary),
          payments: diagnosticsFor(paymentsPrimary),
          catchUpContacts: diagnosticsFor(contactsCatchUp),
          catchUpInvoices: diagnosticsFor(invoicesCatchUp),
          catchUpPayments: diagnosticsFor(paymentsCatchUp),
        },
        timings: {
          totalMs: elapsedMilliseconds(importStartedAt, dependencies.monotonicNow()),
          acquisitionMs,
          providerWallMs,
          organisationPersistenceMs,
          rawPersistenceMs,
          canonicalMappingMs,
          validationMs,
          providerCalls: providerCallDurations,
        },
      },
    }
  } catch (rawError) {
    abortController.abort()
    let error = classifyError(rawError, authority.syncRunId)
    try {
      lease.assertOwned()
    } catch {
      error = new XeroGenerationImportError({
        code: 'lease_lost',
        runId: authority.syncRunId,
      })
    }
    if (deadlineReached) {
      error = new XeroGenerationImportError({
        code: 'run_deadline',
        runId: authority.syncRunId,
      })
    } else if (externallyCancelled) {
      error = new XeroGenerationImportError({
        code: 'run_cancelled',
        runId: authority.syncRunId,
      })
    }
    dependencies.recordLatency({
      stage: 'T6',
      outcome: 'failed',
      userId,
      tenantId,
      syncRunId: authority.syncRunId,
      durationMs: elapsedMilliseconds(importStartedAt, dependencies.monotonicNow()),
      detail: error.code,
    })
    try {
      await dependencies.failRun({
        syncRunId: authority.syncRunId,
        leaseOwner: authority.leaseOwner,
        fencingToken: authority.fencingToken,
        errorCode: error.code,
        errorResource: error.resource,
        supabaseAdmin,
      })
    } catch {
      // A stale or superseded worker cannot mutate the replacement run. Preserve
      // the original sanitized classification for its caller.
    }
    throw error
  } finally {
    dependencies.cancelDeadline(deadlineHandle)
    params.signal?.removeEventListener('abort', onExternalAbort)
    await lease.stop()
  }
}
