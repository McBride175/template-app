import 'server-only'
import { isDeepStrictEqual } from 'node:util'

const XERO_ACCOUNTING_API_BASE_URL = 'https://api.xero.com/api.xro/2.0'

export const XERO_ACCOUNTING_REQUEST_TIMEOUT_MS = 30_000
export const XERO_ACCOUNTING_MAX_ATTEMPTS = 3
export const XERO_ACCOUNTING_RETRY_BASE_DELAY_MS = 500
export const XERO_ACCOUNTING_RETRY_MAX_DELAY_MS = 8_000
export const XERO_ACCOUNTING_DEFAULT_PAGE_SIZE = 1_000
export const XERO_ACCOUNTING_PROCESSING_LIMIT_RECORDS = 100_000

export type XeroAccountingCollectionName =
  | 'organisation'
  | 'contacts'
  | 'invoices'
  | 'payments'
export type XeroGranularCapability =
  | 'accounting.settings'
  | 'accounting.contacts'
  | 'accounting.invoices'
  | 'accounting.payments'

export type XeroAccountingQueryValue =
  | string
  | number
  | boolean
  | readonly (string | number | boolean)[]
  | null
  | undefined

export type XeroAccountingQuery = Record<string, XeroAccountingQueryValue>

export interface XeroRateLimitMetadata {
  minuteRemaining: number | null
  dayRemaining: number | null
  appMinuteRemaining: number | null
  correlationId: string | null
  retryAfterSeconds: number | null
  problem: string | null
}

export interface XeroAggregateRequestMetadata {
  minimumMinuteRemaining: number | null
  minimumDayRemaining: number | null
  minimumAppMinuteRemaining: number | null
  latestMinuteRemaining: number | null
  latestDayRemaining: number | null
  latestAppMinuteRemaining: number | null
  maximumRetryAfterSeconds: number | null
  rateLimitProblems: string[]
  correlationIds: string[]
}

export type XeroAccountingRequestErrorKind =
  | 'authentication'
  | 'permission'
  | 'rate_limit'
  | 'daily_rate_limit'
  | 'http'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'deadline'
  | 'malformed_response'

export class XeroAccountingRequestError extends Error {
  readonly kind: XeroAccountingRequestErrorKind
  readonly resource: XeroAccountingCollectionName
  readonly page: number | null
  readonly status: number | null
  readonly retryable: boolean
  readonly attemptCount: number
  readonly metadata: XeroAggregateRequestMetadata

  constructor(params: {
    kind: XeroAccountingRequestErrorKind
    resource: XeroAccountingCollectionName
    page?: number | null
    status?: number | null
    retryable: boolean
    attemptCount: number
    metadata?: XeroAggregateRequestMetadata
    detail?: string
  }) {
    const pageDetail = params.page === null || params.page === undefined ? '' : ` page ${params.page}`
    const statusDetail = params.status === null || params.status === undefined
      ? ''
      : ` (HTTP ${params.status})`
    const safeDetail = params.detail ? `: ${params.detail}` : ''

    super(`Xero ${params.resource}${pageDetail} request failed${statusDetail}${safeDetail}`)
    this.name = 'XeroAccountingRequestError'
    this.kind = params.kind
    this.resource = params.resource
    this.page = params.page ?? null
    this.status = params.status ?? null
    this.retryable = params.retryable
    this.attemptCount = params.attemptCount
    this.metadata = params.metadata ?? createEmptyAggregateMetadata()
  }
}

export type XeroPaginationErrorKind =
  | 'invalid_record'
  | 'missing_source_id'
  | 'duplicate_record'
  | 'page_limit_exceeded'

export class XeroPaginationError extends Error {
  readonly kind: XeroPaginationErrorKind
  readonly resource: XeroAccountingCollectionName
  readonly page: number
  readonly duplicateKind: 'identical' | 'conflicting' | null

  constructor(params: {
    kind: XeroPaginationErrorKind
    resource: XeroAccountingCollectionName
    page: number
    duplicateKind?: 'identical' | 'conflicting' | null
    detail: string
  }) {
    super(`Xero ${params.resource} pagination failed on page ${params.page}: ${params.detail}`)
    this.name = 'XeroPaginationError'
    this.kind = params.kind
    this.resource = params.resource
    this.page = params.page
    this.duplicateKind = params.duplicateKind ?? null
  }
}

export interface XeroAccountingRequestDependencies {
  fetch: typeof fetch
  sleep: (milliseconds: number) => Promise<void>
  random: () => number
  now: () => number
  scheduleTimeout: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>
  cancelTimeout: (handle: ReturnType<typeof setTimeout>) => void
}

export interface XeroAccountingRequestOptions {
  accessToken: string
  tenantId: string
  resource: XeroAccountingCollectionName
  path: string
  responseKey: string
  page?: number | null
  query?: XeroAccountingQuery
  ifModifiedSince?: string
  signal?: AbortSignal
  deadlineAtMs?: number
  timeoutMs?: number
  maxAttempts?: number
  dependencies?: Partial<XeroAccountingRequestDependencies>
}

export interface XeroAccountingRequestResult<TRecord extends Record<string, unknown>> {
  records: TRecord[]
  attemptCount: number
  metadata: XeroAggregateRequestMetadata
}

export interface XeroPaginatedCollectionConfig<TRecord extends Record<string, unknown>> {
  resource: XeroAccountingCollectionName
  path: string
  responseKey: string
  sourceIdKey: string
  order: string
  query: XeroAccountingQuery
  // Capability-family metadata only. OAuth consent remains outside this provider client;
  // a future read-only migration can choose the corresponding `.read` scope.
  granularCapability: XeroGranularCapability
  getSourceId: (record: TRecord) => string | null
}

export interface XeroPaginatedCollectionOptions<TRecord extends Record<string, unknown>> {
  accessToken: string
  tenantId: string
  config: XeroPaginatedCollectionConfig<TRecord>
  pageSize?: number
  maxPages?: number
  requestTimeoutMs?: number
  requestMaxAttempts?: number
  ifModifiedSince?: string
  signal?: AbortSignal
  deadlineAtMs?: number
  dependencies?: Partial<XeroAccountingRequestDependencies>
}

export interface XeroPaginatedCollectionResult<TRecord extends Record<string, unknown>> {
  records: TRecord[]
  recordCount: number
  populatedPageCount: number
  pageRequestCount: number
  httpAttemptCount: number
  metadata: XeroAggregateRequestMetadata
}

export interface XeroContactsCollectionOptions {
  includeArchived?: boolean
  where?: string
  summaryOnly?: boolean
  query?: XeroAccountingQuery
}

export interface XeroInvoicesCollectionOptions {
  statuses?: readonly string[]
  where?: string
  summaryOnly?: boolean
  query?: XeroAccountingQuery
}

export interface XeroPaymentsCollectionOptions {
  where?: string
  query?: XeroAccountingQuery
}

interface MutableAggregateRequestMetadata {
  minimumMinuteRemaining: number | null
  minimumDayRemaining: number | null
  minimumAppMinuteRemaining: number | null
  latestMinuteRemaining: number | null
  latestDayRemaining: number | null
  latestAppMinuteRemaining: number | null
  maximumRetryAfterSeconds: number | null
  rateLimitProblems: Set<string>
  correlationIds: Set<string>
}

const DEFAULT_DEPENDENCIES: XeroAccountingRequestDependencies = {
  fetch: (...args) => fetch(...args),
  sleep: (milliseconds) =>
    new Promise((resolve) => {
      setTimeout(resolve, milliseconds)
    }),
  random: Math.random,
  now: Date.now,
  scheduleTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  cancelTimeout: (handle) => clearTimeout(handle),
}

function createMutableAggregateMetadata(): MutableAggregateRequestMetadata {
  return {
    minimumMinuteRemaining: null,
    minimumDayRemaining: null,
    minimumAppMinuteRemaining: null,
    latestMinuteRemaining: null,
    latestDayRemaining: null,
    latestAppMinuteRemaining: null,
    maximumRetryAfterSeconds: null,
    rateLimitProblems: new Set(),
    correlationIds: new Set(),
  }
}

function createEmptyAggregateMetadata(): XeroAggregateRequestMetadata {
  return finalizeAggregateMetadata(createMutableAggregateMetadata())
}

function finalizeAggregateMetadata(
  metadata: MutableAggregateRequestMetadata
): XeroAggregateRequestMetadata {
  return {
    minimumMinuteRemaining: metadata.minimumMinuteRemaining,
    minimumDayRemaining: metadata.minimumDayRemaining,
    minimumAppMinuteRemaining: metadata.minimumAppMinuteRemaining,
    latestMinuteRemaining: metadata.latestMinuteRemaining,
    latestDayRemaining: metadata.latestDayRemaining,
    latestAppMinuteRemaining: metadata.latestAppMinuteRemaining,
    maximumRetryAfterSeconds: metadata.maximumRetryAfterSeconds,
    rateLimitProblems: [...metadata.rateLimitProblems],
    correlationIds: [...metadata.correlationIds],
  }
}

function minimumNullable(current: number | null, next: number | null) {
  if (next === null) return current
  return current === null ? next : Math.min(current, next)
}

function maximumNullable(current: number | null, next: number | null) {
  if (next === null) return current
  return current === null ? next : Math.max(current, next)
}

function mergeRateLimitMetadata(
  aggregate: MutableAggregateRequestMetadata,
  metadata: XeroRateLimitMetadata
) {
  aggregate.minimumMinuteRemaining = minimumNullable(
    aggregate.minimumMinuteRemaining,
    metadata.minuteRemaining
  )
  aggregate.minimumDayRemaining = minimumNullable(
    aggregate.minimumDayRemaining,
    metadata.dayRemaining
  )
  aggregate.minimumAppMinuteRemaining = minimumNullable(
    aggregate.minimumAppMinuteRemaining,
    metadata.appMinuteRemaining
  )
  aggregate.latestMinuteRemaining = metadata.minuteRemaining ?? aggregate.latestMinuteRemaining
  aggregate.latestDayRemaining = metadata.dayRemaining ?? aggregate.latestDayRemaining
  aggregate.latestAppMinuteRemaining =
    metadata.appMinuteRemaining ?? aggregate.latestAppMinuteRemaining
  aggregate.maximumRetryAfterSeconds = maximumNullable(
    aggregate.maximumRetryAfterSeconds,
    metadata.retryAfterSeconds
  )
  if (metadata.problem) aggregate.rateLimitProblems.add(metadata.problem)
  if (metadata.correlationId) aggregate.correlationIds.add(metadata.correlationId)
}

function mergeAggregateMetadata(
  aggregate: MutableAggregateRequestMetadata,
  metadata: XeroAggregateRequestMetadata
) {
  aggregate.minimumMinuteRemaining = minimumNullable(
    aggregate.minimumMinuteRemaining,
    metadata.minimumMinuteRemaining
  )
  aggregate.minimumDayRemaining = minimumNullable(
    aggregate.minimumDayRemaining,
    metadata.minimumDayRemaining
  )
  aggregate.minimumAppMinuteRemaining = minimumNullable(
    aggregate.minimumAppMinuteRemaining,
    metadata.minimumAppMinuteRemaining
  )
  aggregate.latestMinuteRemaining = metadata.latestMinuteRemaining ?? aggregate.latestMinuteRemaining
  aggregate.latestDayRemaining = metadata.latestDayRemaining ?? aggregate.latestDayRemaining
  aggregate.latestAppMinuteRemaining =
    metadata.latestAppMinuteRemaining ?? aggregate.latestAppMinuteRemaining
  aggregate.maximumRetryAfterSeconds = maximumNullable(
    aggregate.maximumRetryAfterSeconds,
    metadata.maximumRetryAfterSeconds
  )
  for (const problem of metadata.rateLimitProblems) aggregate.rateLimitProblems.add(problem)
  for (const correlationId of metadata.correlationIds) {
    aggregate.correlationIds.add(correlationId)
  }
}

function parseNonNegativeIntegerHeader(value: string | null) {
  if (!value || !/^\d+$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parseRetryAfterSeconds(value: string | null, nowMs: number) {
  if (!value) return null
  const trimmed = value.trim()

  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed)
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
  }

  const retryAtMs = Date.parse(trimmed)
  if (Number.isNaN(retryAtMs)) return null
  return Math.max(0, (retryAtMs - nowMs) / 1_000)
}

export function extractXeroRateLimitMetadata(
  headers: Headers,
  nowMs = Date.now()
): XeroRateLimitMetadata {
  const problem = headers.get('x-rate-limit-problem')?.trim().toLowerCase() || null
  return {
    minuteRemaining: parseNonNegativeIntegerHeader(headers.get('x-minlimit-remaining')),
    dayRemaining: parseNonNegativeIntegerHeader(headers.get('x-daylimit-remaining')),
    appMinuteRemaining: parseNonNegativeIntegerHeader(headers.get('x-appminlimit-remaining')),
    correlationId: headers.get('xero-correlation-id')?.trim() || null,
    retryAfterSeconds: parseRetryAfterSeconds(headers.get('retry-after'), nowMs),
    problem,
  }
}

function resolveDependencies(
  overrides?: Partial<XeroAccountingRequestDependencies>
): XeroAccountingRequestDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides }
}

function assertPositiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`)
  }
}

function requireIfModifiedSince(value: string | undefined) {
  if (value === undefined) return undefined
  const normalized = value.trim()
  if (!normalized || Number.isNaN(Date.parse(normalized))) {
    throw new TypeError('ifModifiedSince must be a valid timestamp')
  }
  return new Date(normalized).toUTCString()
}

function buildQueryString(query: XeroAccountingQuery | undefined) {
  const searchParams = new URLSearchParams()
  if (!query) return searchParams

  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue
    searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value))
  }

  return searchParams
}

function buildRequestUrl(path: string, query?: XeroAccountingQuery) {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new TypeError('Xero Accounting API path must be an absolute API path')
  }

  const url = new URL(`${XERO_ACCOUNTING_API_BASE_URL}${path}`)
  const searchParams = buildQueryString(query)
  for (const [key, value] of searchParams) url.searchParams.set(key, value)
  return url
}

function calculateRetryDelayMs(
  retryIndex: number,
  random: () => number,
  retryAfterSeconds: number | null
) {
  if (retryAfterSeconds !== null) {
    return retryAfterSeconds * 1_000
  }

  const exponentialDelay = Math.min(
    XERO_ACCOUNTING_RETRY_BASE_DELAY_MS * 2 ** retryIndex,
    XERO_ACCOUNTING_RETRY_MAX_DELAY_MS
  )
  const jitterMultiplier = 0.5 + Math.min(1, Math.max(0, random()))
  return Math.min(
    Math.round(exponentialDelay * jitterMultiplier),
    XERO_ACCOUNTING_RETRY_MAX_DELAY_MS
  )
}

function isDailyRateLimitProblem(problem: string | null) {
  return problem === 'day' || problem === 'daily'
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 500 || status === 502 || status === 503 || status === 504
}

async function discardResponseBody(response: Response) {
  try {
    await response.body?.cancel()
  } catch {
    // Error bodies are intentionally neither parsed nor logged. Cancellation is best-effort.
  }
}

function requestError(params: {
  kind: XeroAccountingRequestErrorKind
  options: XeroAccountingRequestOptions
  status?: number | null
  retryable: boolean
  attemptCount: number
  aggregate: MutableAggregateRequestMetadata
  detail?: string
}) {
  return new XeroAccountingRequestError({
    kind: params.kind,
    resource: params.options.resource,
    page: params.options.page,
    status: params.status,
    retryable: params.retryable,
    attemptCount: params.attemptCount,
    metadata: finalizeAggregateMetadata(params.aggregate),
    detail: params.detail,
  })
}

function stoppedRequestError(params: {
  options: XeroAccountingRequestOptions
  dependencies: XeroAccountingRequestDependencies
  attemptCount: number
  aggregate: MutableAggregateRequestMetadata
}) {
  if (
    params.options.deadlineAtMs !== undefined &&
    params.dependencies.now() >= params.options.deadlineAtMs
  ) {
    return requestError({
      kind: 'deadline',
      options: params.options,
      retryable: false,
      attemptCount: params.attemptCount,
      aggregate: params.aggregate,
    })
  }
  if (params.options.signal?.aborted) {
    return requestError({
      kind: 'cancelled',
      options: params.options,
      retryable: false,
      attemptCount: params.attemptCount,
      aggregate: params.aggregate,
    })
  }
  return null
}

async function waitBeforeRetry(params: {
  delayMs: number
  options: XeroAccountingRequestOptions
  dependencies: XeroAccountingRequestDependencies
  attemptCount: number
  aggregate: MutableAggregateRequestMetadata
}) {
  const stopped = stoppedRequestError(params)
  if (stopped) throw stopped
  if (
    params.options.deadlineAtMs !== undefined &&
    params.dependencies.now() + params.delayMs >= params.options.deadlineAtMs
  ) {
    throw requestError({
      kind: 'deadline',
      options: params.options,
      retryable: false,
      attemptCount: params.attemptCount,
      aggregate: params.aggregate,
    })
  }

  if (!params.options.signal) {
    await params.dependencies.sleep(params.delayMs)
    return
  }

  const signal = params.options.signal
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      reject(
        requestError({
          kind: 'cancelled',
          options: params.options,
          retryable: false,
          attemptCount: params.attemptCount,
          aggregate: params.aggregate,
        })
      )
    }
    signal.addEventListener('abort', onAbort, { once: true })
    params.dependencies.sleep(params.delayMs).then(
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

export async function requestXeroAccountingCollectionPage<
  TRecord extends Record<string, unknown>,
>(options: XeroAccountingRequestOptions): Promise<XeroAccountingRequestResult<TRecord>> {
  const timeoutMs = options.timeoutMs ?? XERO_ACCOUNTING_REQUEST_TIMEOUT_MS
  const maxAttempts = options.maxAttempts ?? XERO_ACCOUNTING_MAX_ATTEMPTS
  assertPositiveInteger(timeoutMs, 'timeoutMs')
  assertPositiveInteger(maxAttempts, 'maxAttempts')
  if (maxAttempts > XERO_ACCOUNTING_MAX_ATTEMPTS) {
    throw new RangeError(`maxAttempts must not exceed ${XERO_ACCOUNTING_MAX_ATTEMPTS}`)
  }

  const dependencies = resolveDependencies(options.dependencies)
  const url = buildRequestUrl(options.path, options.query)
  const aggregate = createMutableAggregateMetadata()
  const ifModifiedSince = requireIfModifiedSince(options.ifModifiedSince)
  if (options.deadlineAtMs !== undefined && !Number.isFinite(options.deadlineAtMs)) {
    throw new TypeError('deadlineAtMs must be finite')
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const stopped = stoppedRequestError({ options, dependencies, attemptCount: attempt, aggregate })
    if (stopped) throw stopped

    const abortController = new AbortController()
    const timeoutState: { kind: 'timeout' | 'deadline' | null } = { kind: null }
    const remainingDeadlineMs = options.deadlineAtMs === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, options.deadlineAtMs - dependencies.now())
    const effectiveTimeoutMs = Math.min(timeoutMs, remainingDeadlineMs)
    const timeoutHandle = dependencies.scheduleTimeout(() => {
      timeoutState.kind = remainingDeadlineMs <= timeoutMs ? 'deadline' : 'timeout'
      abortController.abort()
    }, effectiveTimeoutMs)
    const externalAbort = () => abortController.abort()
    options.signal?.addEventListener('abort', externalAbort, { once: true })

    let response: Response
    try {
      response = await dependencies.fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${options.accessToken}`,
          'xero-tenant-id': options.tenantId,
          Accept: 'application/json',
          ...(ifModifiedSince ? { 'If-Modified-Since': ifModifiedSince } : {}),
        },
        signal: abortController.signal,
      })
    } catch {
      dependencies.cancelTimeout(timeoutHandle)
      options.signal?.removeEventListener('abort', externalAbort)
      const externallyStopped = stoppedRequestError({
        options,
        dependencies,
        attemptCount: attempt,
        aggregate,
      })
      if (externallyStopped) throw externallyStopped
      const kind: XeroAccountingRequestErrorKind = timeoutState.kind ?? 'network'
      if (kind === 'deadline') {
        throw requestError({
          kind,
          options,
          retryable: false,
          attemptCount: attempt,
          aggregate,
        })
      }
      if (attempt < maxAttempts) {
        await waitBeforeRetry({
          delayMs: calculateRetryDelayMs(attempt - 1, dependencies.random, null),
          options,
          dependencies,
          attemptCount: attempt,
          aggregate,
        })
        continue
      }
      throw requestError({
        kind,
        options,
        retryable: true,
        attemptCount: attempt,
        aggregate,
      })
    }
    const responseMetadata = extractXeroRateLimitMetadata(response.headers, dependencies.now())
    mergeRateLimitMetadata(aggregate, responseMetadata)

    if (!response.ok) {
      dependencies.cancelTimeout(timeoutHandle)
      options.signal?.removeEventListener('abort', externalAbort)
      await discardResponseBody(response)
      if (response.status === 401) {
        throw requestError({
          kind: 'authentication',
          options,
          status: response.status,
          retryable: false,
          attemptCount: attempt,
          aggregate,
        })
      }

      if (response.status === 403) {
        throw requestError({
          kind: 'permission',
          options,
          status: response.status,
          retryable: false,
          attemptCount: attempt,
          aggregate,
        })
      }

      if (response.status === 429) {
        if (isDailyRateLimitProblem(responseMetadata.problem)) {
          throw requestError({
            kind: 'daily_rate_limit',
            options,
            status: response.status,
            retryable: false,
            attemptCount: attempt,
            aggregate,
          })
        }

        if (attempt < maxAttempts) {
          await waitBeforeRetry({
            delayMs: calculateRetryDelayMs(
              attempt - 1,
              dependencies.random,
              responseMetadata.retryAfterSeconds
            ),
            options,
            dependencies,
            attemptCount: attempt,
            aggregate,
          })
          continue
        }

        throw requestError({
          kind: 'rate_limit',
          options,
          status: response.status,
          retryable: true,
          attemptCount: attempt,
          aggregate,
        })
      }

      if (isRetryableStatus(response.status) && attempt < maxAttempts) {
        await waitBeforeRetry({
          delayMs: calculateRetryDelayMs(attempt - 1, dependencies.random, null),
          options,
          dependencies,
          attemptCount: attempt,
          aggregate,
        })
        continue
      }

      throw requestError({
        kind: 'http',
        options,
        status: response.status,
        retryable: isRetryableStatus(response.status),
        attemptCount: attempt,
        aggregate,
      })
    }

    try {
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        const externallyStopped = stoppedRequestError({
          options,
          dependencies,
          attemptCount: attempt,
          aggregate,
        })
        if (externallyStopped) throw externallyStopped
        if (timeoutState.kind) {
          if (timeoutState.kind === 'deadline') {
            throw requestError({
              kind: 'deadline',
              options,
              retryable: false,
              attemptCount: attempt,
              aggregate,
            })
          }
          if (attempt < maxAttempts) {
            await waitBeforeRetry({
              delayMs: calculateRetryDelayMs(attempt - 1, dependencies.random, null),
              options,
              dependencies,
              attemptCount: attempt,
              aggregate,
            })
            continue
          }
          throw requestError({
            kind: 'timeout',
            options,
            retryable: true,
            attemptCount: attempt,
            aggregate,
          })
        }
        throw requestError({
          kind: 'malformed_response',
          options,
          retryable: false,
          attemptCount: attempt,
          aggregate,
          detail: 'response was not valid JSON',
        })
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw requestError({
          kind: 'malformed_response',
          options,
          retryable: false,
          attemptCount: attempt,
          aggregate,
          detail: 'response envelope was not an object',
        })
      }

      if (!Object.prototype.hasOwnProperty.call(payload, options.responseKey)) {
        throw requestError({
          kind: 'malformed_response',
          options,
          retryable: false,
          attemptCount: attempt,
          aggregate,
          detail: `response envelope was missing ${options.responseKey}`,
        })
      }

      const records = (payload as Record<string, unknown>)[options.responseKey]
      if (!Array.isArray(records)) {
        throw requestError({
          kind: 'malformed_response',
          options,
          retryable: false,
          attemptCount: attempt,
          aggregate,
          detail: `${options.responseKey} was not an array`,
        })
      }

      return {
        records: records as TRecord[],
        attemptCount: attempt,
        metadata: finalizeAggregateMetadata(aggregate),
      }
    } finally {
      dependencies.cancelTimeout(timeoutHandle)
      options.signal?.removeEventListener('abort', externalAbort)
    }
  }

  throw new Error('Unreachable Xero request state')
}

function sourceIdFromKey<TRecord extends Record<string, unknown>>(
  sourceIdKey: string,
  record: TRecord
) {
  const value = record[sourceIdKey]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function withBaseQuery(
  baseQuery: XeroAccountingQuery,
  query: XeroAccountingQuery | undefined
) {
  const definedBaseQuery = Object.fromEntries(
    Object.entries(baseQuery).filter(([, value]) => value !== null && value !== undefined)
  ) as XeroAccountingQuery
  return { ...query, ...definedBaseQuery }
}

export function createXeroContactsCollectionConfig(
  options: XeroContactsCollectionOptions = {}
): XeroPaginatedCollectionConfig<Record<string, unknown>> {
  const query = withBaseQuery(
    {
      includeArchived: options.includeArchived,
      where: options.where,
      summaryOnly: options.summaryOnly,
    },
    options.query
  )

  return {
    resource: 'contacts',
    path: '/Contacts',
    responseKey: 'Contacts',
    sourceIdKey: 'ContactID',
    // Xero's order syntax is `order={PropertyName} [DESC]`; ASC is the default.
    // Immutable provider IDs prevent ordinary record updates from moving page boundaries.
    order: 'ContactID',
    query,
    granularCapability: 'accounting.contacts',
    getSourceId: (record) => sourceIdFromKey('ContactID', record),
  }
}

export function createXeroInvoicesCollectionConfig(
  options: XeroInvoicesCollectionOptions = {}
): XeroPaginatedCollectionConfig<Record<string, unknown>> {
  const query = withBaseQuery(
    {
      Statuses: options.statuses,
      where: options.where,
      summaryOnly: options.summaryOnly,
    },
    options.query
  )

  return {
    resource: 'invoices',
    path: '/Invoices',
    responseKey: 'Invoices',
    sourceIdKey: 'InvoiceID',
    order: 'InvoiceID',
    query,
    granularCapability: 'accounting.invoices',
    getSourceId: (record) => sourceIdFromKey('InvoiceID', record),
  }
}

export function createXeroAuthorisedAccrecInvoicesConfig(
  options: Omit<XeroInvoicesCollectionOptions, 'statuses' | 'where'> = {}
) {
  return createXeroInvoicesCollectionConfig({
    ...options,
    statuses: ['AUTHORISED'],
    where: 'Type=="ACCREC"',
  })
}

export function createXeroPaidAccrecInvoicesConfig(
  options: Omit<XeroInvoicesCollectionOptions, 'statuses' | 'where'> = {}
) {
  return createXeroInvoicesCollectionConfig({
    ...options,
    statuses: ['PAID'],
    where: 'Type=="ACCREC"',
  })
}

export function createXeroPaymentsCollectionConfig(
  options: XeroPaymentsCollectionOptions = {}
): XeroPaginatedCollectionConfig<Record<string, unknown>> {
  const query = withBaseQuery({ where: options.where }, options.query)

  return {
    resource: 'payments',
    path: '/Payments',
    responseKey: 'Payments',
    sourceIdKey: 'PaymentID',
    order: 'PaymentID',
    query,
    granularCapability: 'accounting.payments',
    getSourceId: (record) => sourceIdFromKey('PaymentID', record),
  }
}

export function createXeroAuthorisedAccrecPaymentsConfig(
  options: Omit<XeroPaymentsCollectionOptions, 'where'> = {}
) {
  return createXeroPaymentsCollectionConfig({
    ...options,
    where: 'PaymentType=="ACCRECPAYMENT" AND Status=="AUTHORISED"',
  })
}

export async function fetchXeroPaginatedCollection<TRecord extends Record<string, unknown>>(
  options: XeroPaginatedCollectionOptions<TRecord>
): Promise<XeroPaginatedCollectionResult<TRecord>> {
  const pageSize = options.pageSize ?? XERO_ACCOUNTING_DEFAULT_PAGE_SIZE
  assertPositiveInteger(pageSize, 'pageSize')
  if (pageSize > XERO_ACCOUNTING_DEFAULT_PAGE_SIZE) {
    throw new RangeError(`pageSize must not exceed ${XERO_ACCOUNTING_DEFAULT_PAGE_SIZE}`)
  }

  const defaultMaxPages = Math.ceil(XERO_ACCOUNTING_PROCESSING_LIMIT_RECORDS / pageSize) + 1
  const maxPages = options.maxPages ?? defaultMaxPages
  assertPositiveInteger(maxPages, 'maxPages')

  const records: TRecord[] = []
  const seenBySourceId = new Map<string, TRecord>()
  const aggregate = createMutableAggregateMetadata()
  let populatedPageCount = 0
  let pageRequestCount = 0
  let httpAttemptCount = 0

  for (let page = 1; page <= maxPages; page += 1) {
    const query: XeroAccountingQuery = {
      ...options.config.query,
      order: options.config.order,
      page,
      pageSize,
    }
    const result = await requestXeroAccountingCollectionPage<TRecord>({
      accessToken: options.accessToken,
      tenantId: options.tenantId,
      resource: options.config.resource,
      path: options.config.path,
      responseKey: options.config.responseKey,
      page,
      query,
      timeoutMs: options.requestTimeoutMs,
      maxAttempts: options.requestMaxAttempts,
      ifModifiedSince: options.ifModifiedSince,
      signal: options.signal,
      deadlineAtMs: options.deadlineAtMs,
      dependencies: options.dependencies,
    })

    pageRequestCount += 1
    httpAttemptCount += result.attemptCount
    mergeAggregateMetadata(aggregate, result.metadata)

    if (result.records.length === 0) {
      return {
        records,
        recordCount: records.length,
        populatedPageCount,
        pageRequestCount,
        httpAttemptCount,
        metadata: finalizeAggregateMetadata(aggregate),
      }
    }

    populatedPageCount += 1

    for (const record of result.records) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw new XeroPaginationError({
          kind: 'invalid_record',
          resource: options.config.resource,
          page,
          detail: 'collection contained a non-object record',
        })
      }

      const sourceId = options.config.getSourceId(record)
      if (!sourceId) {
        throw new XeroPaginationError({
          kind: 'missing_source_id',
          resource: options.config.resource,
          page,
          detail: `record was missing ${options.config.sourceIdKey}`,
        })
      }

      const previous = seenBySourceId.get(sourceId)
      if (previous) {
        const duplicateKind = isDeepStrictEqual(previous, record) ? 'identical' : 'conflicting'
        throw new XeroPaginationError({
          kind: 'duplicate_record',
          resource: options.config.resource,
          page,
          duplicateKind,
          detail: `${duplicateKind} duplicate source ID`,
        })
      }

      seenBySourceId.set(sourceId, record)
      records.push(record)
    }

    if (page === maxPages) {
      throw new XeroPaginationError({
        kind: 'page_limit_exceeded',
        resource: options.config.resource,
        page,
        detail: `maximum page count ${maxPages} was reached before an empty page`,
      })
    }
  }

  throw new Error('Unreachable Xero pagination state')
}

type EndpointFetchOptions<TOptions> = Omit<
  XeroPaginatedCollectionOptions<Record<string, unknown>>,
  'config'
> & {
  endpoint?: TOptions
}

export function fetchXeroOrganisation(
  options: Omit<
    XeroAccountingRequestOptions,
    'resource' | 'path' | 'responseKey' | 'page' | 'query'
  >
) {
  return requestXeroAccountingCollectionPage({
    ...options,
    resource: 'organisation',
    path: '/Organisation',
    responseKey: 'Organisations',
  })
}

export function fetchXeroContacts(
  options: EndpointFetchOptions<XeroContactsCollectionOptions>
) {
  const { endpoint, ...paginationOptions } = options
  return fetchXeroPaginatedCollection({
    ...paginationOptions,
    config: createXeroContactsCollectionConfig(endpoint),
  })
}

export function fetchXeroInvoices(
  options: EndpointFetchOptions<XeroInvoicesCollectionOptions>
) {
  const { endpoint, ...paginationOptions } = options
  return fetchXeroPaginatedCollection({
    ...paginationOptions,
    config: createXeroInvoicesCollectionConfig(endpoint),
  })
}

export function fetchXeroPayments(
  options: EndpointFetchOptions<XeroPaymentsCollectionOptions>
) {
  const { endpoint, ...paginationOptions } = options
  return fetchXeroPaginatedCollection({
    ...paginationOptions,
    config: createXeroPaymentsCollectionConfig(endpoint),
  })
}
