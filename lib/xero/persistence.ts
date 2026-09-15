import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export const XERO_GENERATION_WRITE_CHUNK_SIZE = 500

export type XeroLegacyRawResourceType =
  | 'accounts'
  | 'contacts'
  | 'invoices'
  | 'organisations'
  | 'organisation_actions'

export type XeroGenerationRawResourceType =
  | 'contacts'
  | 'invoices'
  | 'organisations'
  | 'organisation_actions'
  | 'payments'

export type XeroCanonicalResourceType =
  | 'organisations'
  | 'customers'
  | 'invoices'
  | 'payments'

export interface XeroRawPersistenceRecord {
  sourceId: string
  rawJson: Record<string, unknown>
}

export interface XeroPersistenceCounts {
  inputCount: number
  affectedCount: number
  batchCount: number
}

interface SupabaseErrorLike {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
}

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>

const GENERATION_SOURCE_ID_KEYS: Record<XeroGenerationRawResourceType, string> = {
  contacts: 'ContactID',
  invoices: 'InvoiceID',
  organisations: 'OrganisationID',
  organisation_actions: 'Name',
  payments: 'PaymentID',
}

const LEGACY_CANONICAL_CONFLICT_TARGETS: Record<XeroCanonicalResourceType, string> = {
  organisations: 'user_id,tenant_id,source_system,source_organisation_id',
  customers: 'user_id,tenant_id,source_system,source_id',
  invoices: 'user_id,tenant_id,source_system,source_id',
  payments: 'user_id,tenant_id,source_system,source_id',
}

const CANONICAL_TABLES = {
  organisations: 'canonical_organisations',
  customers: 'canonical_customers',
  invoices: 'canonical_invoices',
  payments: 'canonical_payments',
} as const

const CANONICAL_SOURCE_ID_KEYS: Record<XeroCanonicalResourceType, string> = {
  organisations: 'source_organisation_id',
  customers: 'source_id',
  invoices: 'source_id',
  payments: 'source_id',
}

export class XeroPersistenceError extends Error {
  readonly operation: 'legacy_raw' | 'legacy_canonical' | 'generation_raw' | 'generation_canonical'
  readonly resourceType: string
  readonly code: string | null

  constructor(params: {
    operation: XeroPersistenceError['operation']
    resourceType: string
    code?: string | null
    detail: string
  }) {
    super(`Xero ${params.operation} ${params.resourceType} persistence failed: ${params.detail}`)
    this.name = 'XeroPersistenceError'
    this.operation = params.operation
    this.resourceType = params.resourceType
    this.code = params.code ?? null
  }
}

function requireNonEmpty(value: string, label: string) {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label} is required`)
  return normalized
}

function requireGenerationIdentity(params: {
  syncRunId: string
  userId: string
  tenantId: string
  leaseOwner: string
  fencingToken: number
}) {
  return {
    syncRunId: requireNonEmpty(params.syncRunId, 'syncRunId'),
    userId: requireNonEmpty(params.userId, 'userId'),
    tenantId: requireNonEmpty(params.tenantId, 'tenantId'),
    leaseOwner: requireNonEmpty(params.leaseOwner, 'leaseOwner'),
    fencingToken: (() => {
      if (!Number.isSafeInteger(params.fencingToken) || params.fencingToken <= 0) {
        throw new Error('fencingToken must be a positive safe integer')
      }
      return params.fencingToken
    })(),
  }
}

function requireIsoTimestamp(value: string, label: string) {
  const normalized = requireNonEmpty(value, label)
  if (Number.isNaN(Date.parse(normalized))) {
    throw new Error(`${label} must be a valid timestamp`)
  }
  return normalized
}

function requireObjectRows<TRow extends object>(rows: readonly TRow[]) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array')
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('rows must contain only objects')
    }
  }
}

function requireCanonicalRows<TRow extends object>(
  resourceType: XeroCanonicalResourceType,
  rows: readonly TRow[]
) {
  requireObjectRows(rows)
  const sourceIdKey = CANONICAL_SOURCE_ID_KEYS[resourceType]
  for (const row of rows) {
    const sourceId = (row as Record<string, unknown>)[sourceIdKey]
    if (typeof sourceId !== 'string' || !sourceId.trim()) {
      throw new Error(`${sourceIdKey} is required for ${resourceType}`)
    }
  }
}

function serializeRawRows(rows: readonly XeroRawPersistenceRecord[]) {
  const sourceIds = new Set<string>()
  return rows.map((row) => {
    const sourceId = requireNonEmpty(row.sourceId, 'sourceId')
    if (!row.rawJson || typeof row.rawJson !== 'object' || Array.isArray(row.rawJson)) {
      throw new Error(`rawJson must be an object for source ${sourceId}`)
    }
    if (sourceIds.has(sourceId)) {
      throw new Error(`duplicate sourceId in raw batch for ${sourceId}`)
    }
    sourceIds.add(sourceId)
    return { source_id: sourceId, raw_json: row.rawJson }
  })
}

function safeDatabaseDetail(error: SupabaseErrorLike) {
  if (error.code) return `database error ${error.code}`
  return 'database request failed'
}

function isMissingPersistenceRpc(error: SupabaseErrorLike | null | undefined, functionName: string) {
  if (!error) return false
  if (error.code === 'PGRST202' || error.code === '42883') return true

  const message = [error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()

  return (
    message.includes(functionName.toLowerCase()) &&
    (message.includes('schema cache') || message.includes('could not find') || message.includes('does not exist'))
  )
}

function readAffectedCount(data: unknown, operation: XeroPersistenceError['operation'], resourceType: string) {
  const value = typeof data === 'string' && /^\d+$/.test(data) ? Number(data) : data
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new XeroPersistenceError({
      operation,
      resourceType,
      detail: 'database returned an invalid affected-row count',
    })
  }
  return value
}

async function callRpc(params: {
  supabaseAdmin: SupabaseAdminClient
  functionName: string
  args: Record<string, unknown>
  operation: XeroPersistenceError['operation']
  resourceType: string
}) {
  const { data, error } = await params.supabaseAdmin.rpc(params.functionName, params.args)
  if (error) {
    throw new XeroPersistenceError({
      operation: params.operation,
      resourceType: params.resourceType,
      code: error.code,
      detail: safeDatabaseDetail(error),
    })
  }
  return readAffectedCount(data, params.operation, params.resourceType)
}

export function toXeroGenerationRawRecords(
  resourceType: XeroGenerationRawResourceType,
  records: readonly Record<string, unknown>[]
): XeroRawPersistenceRecord[] {
  requireObjectRows(records)
  const sourceIdKey = GENERATION_SOURCE_ID_KEYS[resourceType]
  const sourceIds = new Set<string>()

  return records.map((record) => {
    const rawSourceId = record[sourceIdKey]
    const sourceId = typeof rawSourceId === 'string' ? rawSourceId.trim() : ''
    if (!sourceId) {
      throw new Error(`${resourceType} record is missing ${sourceIdKey}`)
    }
    if (sourceIds.has(sourceId)) {
      throw new Error(`duplicate ${sourceIdKey} in ${resourceType} batch`)
    }
    sourceIds.add(sourceId)
    return { sourceId, rawJson: record }
  })
}

export async function persistLegacyXeroRawBatch(params: {
  userId: string
  tenantId: string
  resourceType: XeroLegacyRawResourceType
  fetchedAt: string
  rows: readonly XeroRawPersistenceRecord[]
  supabaseAdmin: SupabaseAdminClient
}) {
  const userId = requireNonEmpty(params.userId, 'userId')
  const tenantId = requireNonEmpty(params.tenantId, 'tenantId')
  const fetchedAt = requireIsoTimestamp(params.fetchedAt, 'fetchedAt')
  const rows = serializeRawRows(params.rows)
  if (rows.length === 0) return 0

  const functionName = 'upsert_xero_legacy_raw_batch'
  const args = {
    p_user_id: userId,
    p_tenant_id: tenantId,
    p_resource_type: params.resourceType,
    p_fetched_at: fetchedAt,
    p_rows: rows,
  }
  const rpcResult = await params.supabaseAdmin.rpc(functionName, args)
  if (!rpcResult.error) {
    return readAffectedCount(rpcResult.data, 'legacy_raw', params.resourceType)
  }
  if (!isMissingPersistenceRpc(rpcResult.error, functionName)) {
    throw new XeroPersistenceError({
      operation: 'legacy_raw',
      resourceType: params.resourceType,
      code: rpcResult.error.code,
      detail: safeDatabaseDetail(rpcResult.error),
    })
  }

  const legacyRows = rows.map((row) => ({
    user_id: userId,
    tenant_id: tenantId,
    resource_type: params.resourceType,
    source_id: row.source_id,
    raw_json: row.raw_json,
    fetched_at: fetchedAt,
  }))
  const { error } = await params.supabaseAdmin.from('xero_raw').upsert(legacyRows, {
    onConflict: 'user_id,tenant_id,resource_type,source_id',
  })
  if (error) {
    throw new XeroPersistenceError({
      operation: 'legacy_raw',
      resourceType: params.resourceType,
      code: error.code,
      detail: safeDatabaseDetail(error),
    })
  }
  return rows.length
}

export async function persistXeroGenerationRawBatch(params: {
  syncRunId: string
  userId: string
  tenantId: string
  leaseOwner: string
  fencingToken: number
  resourceType: XeroGenerationRawResourceType
  fetchedAt: string
  records: readonly Record<string, unknown>[]
  supabaseAdmin?: SupabaseAdminClient
  chunkSize?: number
}): Promise<XeroPersistenceCounts> {
  const identity = requireGenerationIdentity(params)
  const fetchedAt = requireIsoTimestamp(params.fetchedAt, 'fetchedAt')
  const rows = serializeRawRows(toXeroGenerationRawRecords(params.resourceType, params.records))
  const chunkSize = params.chunkSize ?? XERO_GENERATION_WRITE_CHUNK_SIZE
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
    throw new Error('chunkSize must be a positive safe integer')
  }

  const supabaseAdmin = params.supabaseAdmin ?? createSupabaseAdminClient()
  let affectedCount = 0
  let batchCount = 0
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize)
    affectedCount += await callRpc({
      supabaseAdmin,
      functionName: 'upsert_xero_generation_raw_batch',
      args: {
        p_sync_run_id: identity.syncRunId,
        p_user_id: identity.userId,
        p_tenant_id: identity.tenantId,
        p_lease_owner: identity.leaseOwner,
        p_fencing_token: identity.fencingToken,
        p_resource_type: params.resourceType,
        p_fetched_at: fetchedAt,
        p_rows: chunk,
      },
      operation: 'generation_raw',
      resourceType: params.resourceType,
    })
    batchCount += 1
  }

  return { inputCount: rows.length, affectedCount, batchCount }
}

export async function persistLegacyCanonicalRows<TRow extends object>(params: {
  userId: string
  tenantId: string
  resourceType: XeroCanonicalResourceType
  rows: readonly TRow[]
  supabaseAdmin: SupabaseAdminClient
  chunkSize?: number
}) {
  const userId = requireNonEmpty(params.userId, 'userId')
  const tenantId = requireNonEmpty(params.tenantId, 'tenantId')
  requireCanonicalRows(params.resourceType, params.rows)
  const chunkSize = params.chunkSize ?? XERO_GENERATION_WRITE_CHUNK_SIZE
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
    throw new Error('chunkSize must be a positive safe integer')
  }

  for (let index = 0; index < params.rows.length; index += chunkSize) {
    const chunk = params.rows.slice(index, index + chunkSize)
    const functionName = 'upsert_xero_legacy_canonical_batch'
    const rpcResult = await params.supabaseAdmin.rpc(functionName, {
      p_user_id: userId,
      p_tenant_id: tenantId,
      p_resource_type: params.resourceType,
      p_rows: chunk,
    })

    if (!rpcResult.error) {
      readAffectedCount(rpcResult.data, 'legacy_canonical', params.resourceType)
      continue
    }
    if (!isMissingPersistenceRpc(rpcResult.error, functionName)) {
      throw new XeroPersistenceError({
        operation: 'legacy_canonical',
        resourceType: params.resourceType,
        code: rpcResult.error.code,
        detail: safeDatabaseDetail(rpcResult.error),
      })
    }

    const table = CANONICAL_TABLES[params.resourceType]
    const { error } = await params.supabaseAdmin.from(table).upsert(chunk as object[], {
      onConflict: LEGACY_CANONICAL_CONFLICT_TARGETS[params.resourceType],
    })
    if (error) {
      throw new XeroPersistenceError({
        operation: 'legacy_canonical',
        resourceType: params.resourceType,
        code: error.code,
        detail: safeDatabaseDetail(error),
      })
    }
  }
}

export async function persistXeroGenerationCanonicalRows<TRow extends object>(params: {
  syncRunId: string
  userId: string
  tenantId: string
  leaseOwner: string
  fencingToken: number
  resourceType: XeroCanonicalResourceType
  rows: readonly TRow[]
  supabaseAdmin?: SupabaseAdminClient
  chunkSize?: number
}): Promise<XeroPersistenceCounts> {
  const identity = requireGenerationIdentity(params)
  requireCanonicalRows(params.resourceType, params.rows)
  const chunkSize = params.chunkSize ?? XERO_GENERATION_WRITE_CHUNK_SIZE
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
    throw new Error('chunkSize must be a positive safe integer')
  }

  const supabaseAdmin = params.supabaseAdmin ?? createSupabaseAdminClient()
  let affectedCount = 0
  let batchCount = 0
  for (let index = 0; index < params.rows.length; index += chunkSize) {
    const chunk = params.rows.slice(index, index + chunkSize)
    affectedCount += await callRpc({
      supabaseAdmin,
      functionName: 'upsert_xero_generation_canonical_batch',
      args: {
        p_sync_run_id: identity.syncRunId,
        p_user_id: identity.userId,
        p_tenant_id: identity.tenantId,
        p_lease_owner: identity.leaseOwner,
        p_fencing_token: identity.fencingToken,
        p_resource_type: params.resourceType,
        p_rows: chunk,
      },
      operation: 'generation_canonical',
      resourceType: params.resourceType,
    })
    batchCount += 1
  }

  return { inputCount: params.rows.length, affectedCount, batchCount }
}
