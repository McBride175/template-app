import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>

export const XERO_SYNC_RUN_REQUIRED_STEPS = [
  'organisation',
  'contacts',
  'authorised_accrec_invoices',
  'paid_accrec_invoices',
  'authorised_accrec_payments',
  'canonical_mapping',
  'validation',
] as const

export type XeroSyncRunStepKey = (typeof XERO_SYNC_RUN_REQUIRED_STEPS)[number]

export class XeroSyncRunContractError extends Error {
  readonly operation: 'acquire' | 'heartbeat' | 'complete_step' | 'fail' | 'manifest'
  readonly code: string | null

  constructor(params: {
    operation: XeroSyncRunContractError['operation']
    code?: string | null
    detail: string
  }) {
    super(`Xero sync-run ${params.operation} failed: ${params.detail}`)
    this.name = 'XeroSyncRunContractError'
    this.operation = params.operation
    this.code = params.code ?? null
  }
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

function safeDatabaseDetail(code?: string | null) {
  return code ? `database error ${code}` : 'database request failed'
}

function readRpcRow(data: unknown, operation: XeroSyncRunContractError['operation']) {
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new XeroSyncRunContractError({
      operation,
      detail: 'database returned an invalid contract response',
    })
  }
  return row as Record<string, unknown>
}

async function rpcRow(params: {
  supabaseAdmin: SupabaseAdminClient
  functionName: string
  args: Record<string, unknown>
  operation: XeroSyncRunContractError['operation']
}) {
  const { data, error } = await params.supabaseAdmin.rpc(params.functionName, params.args)
  if (error) {
    throw new XeroSyncRunContractError({
      operation: params.operation,
      code: error.code,
      detail: safeDatabaseDetail(error.code),
    })
  }
  return readRpcRow(data, params.operation)
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readRequiredBoolean(row: Record<string, unknown>, key: string, operation: XeroSyncRunContractError['operation']) {
  if (typeof row[key] !== 'boolean') {
    throw new XeroSyncRunContractError({ operation, detail: `response was missing ${key}` })
  }
  return row[key]
}

export async function acquireXeroGenerationRun(params: {
  userId: string
  tenantId: string
  leaseOwner: string
  scopeVersion: string
  leaseTtlSeconds: number
  supabaseAdmin?: SupabaseAdminClient
}) {
  const supabaseAdmin = params.supabaseAdmin ?? createSupabaseAdminClient()
  const row = await rpcRow({
    supabaseAdmin,
    functionName: 'acquire_xero_sync_run',
    operation: 'acquire',
    args: {
      p_user_id: requireNonEmpty(params.userId, 'userId'),
      p_tenant_id: requireNonEmpty(params.tenantId, 'tenantId'),
      p_lease_owner: requireNonEmpty(params.leaseOwner, 'leaseOwner'),
      p_scope_version: requireNonEmpty(params.scopeVersion, 'scopeVersion'),
      p_ttl_seconds: requirePositiveInteger(params.leaseTtlSeconds, 'leaseTtlSeconds'),
    },
  })

  const acquired = readRequiredBoolean(row, 'acquired', 'acquire')
  const resultCode = readOptionalString(row.result_code)
  if (!resultCode) {
    throw new XeroSyncRunContractError({ operation: 'acquire', detail: 'response was missing result_code' })
  }
  const syncRunId = readOptionalString(row.sync_run_id)
  const fencingToken = typeof row.fencing_token === 'number'
    ? row.fencing_token
    : typeof row.fencing_token === 'string' && /^\d+$/.test(row.fencing_token)
      ? Number(row.fencing_token)
      : null
  const leaseExpiresAt = readOptionalString(row.lease_expires_at)

  if (acquired && (!syncRunId || !fencingToken || !leaseExpiresAt)) {
    throw new XeroSyncRunContractError({
      operation: 'acquire',
      detail: 'acquired response omitted ownership fields',
    })
  }

  return { acquired, resultCode, syncRunId, fencingToken, leaseExpiresAt }
}

export async function heartbeatXeroGenerationRun(params: {
  syncRunId: string
  leaseOwner: string
  fencingToken: number
  leaseTtlSeconds: number
  supabaseAdmin?: SupabaseAdminClient
}) {
  const supabaseAdmin = params.supabaseAdmin ?? createSupabaseAdminClient()
  const row = await rpcRow({
    supabaseAdmin,
    functionName: 'heartbeat_xero_sync_run',
    operation: 'heartbeat',
    args: {
      p_sync_run_id: requireNonEmpty(params.syncRunId, 'syncRunId'),
      p_lease_owner: requireNonEmpty(params.leaseOwner, 'leaseOwner'),
      p_fencing_token: requirePositiveInteger(params.fencingToken, 'fencingToken'),
      p_ttl_seconds: requirePositiveInteger(params.leaseTtlSeconds, 'leaseTtlSeconds'),
    },
  })
  const renewed = readRequiredBoolean(row, 'renewed', 'heartbeat')
  const resultCode = readOptionalString(row.result_code)
  if (!resultCode) {
    throw new XeroSyncRunContractError({ operation: 'heartbeat', detail: 'response was missing result_code' })
  }
  return {
    renewed,
    resultCode,
    leaseExpiresAt: readOptionalString(row.lease_expires_at),
  }
}

export async function completeXeroGenerationRunStep(params: {
  syncRunId: string
  leaseOwner: string
  fencingToken: number
  stepKey: XeroSyncRunStepKey
  recordCount: number
  supabaseAdmin?: SupabaseAdminClient
}) {
  if (!Number.isSafeInteger(params.recordCount) || params.recordCount < 0) {
    throw new TypeError('recordCount must be a non-negative safe integer')
  }
  const supabaseAdmin = params.supabaseAdmin ?? createSupabaseAdminClient()
  const row = await rpcRow({
    supabaseAdmin,
    functionName: 'complete_xero_sync_run_step',
    operation: 'complete_step',
    args: {
      p_sync_run_id: requireNonEmpty(params.syncRunId, 'syncRunId'),
      p_lease_owner: requireNonEmpty(params.leaseOwner, 'leaseOwner'),
      p_fencing_token: requirePositiveInteger(params.fencingToken, 'fencingToken'),
      p_step_key: params.stepKey,
      p_record_count: params.recordCount,
    },
  })
  const completed = readRequiredBoolean(row, 'completed', 'complete_step')
  const resultCode = readOptionalString(row.result_code)
  if (!resultCode) {
    throw new XeroSyncRunContractError({ operation: 'complete_step', detail: 'response was missing result_code' })
  }
  return { completed, resultCode }
}

export async function failXeroGenerationRun(params: {
  syncRunId: string
  leaseOwner: string
  fencingToken: number
  errorCode: string
  errorResource?: string | null
  supabaseAdmin?: SupabaseAdminClient
}) {
  const supabaseAdmin = params.supabaseAdmin ?? createSupabaseAdminClient()
  const row = await rpcRow({
    supabaseAdmin,
    functionName: 'fail_xero_sync_run',
    operation: 'fail',
    args: {
      p_sync_run_id: requireNonEmpty(params.syncRunId, 'syncRunId'),
      p_lease_owner: requireNonEmpty(params.leaseOwner, 'leaseOwner'),
      p_fencing_token: requirePositiveInteger(params.fencingToken, 'fencingToken'),
      p_error_code: requireNonEmpty(params.errorCode, 'errorCode'),
      p_error_resource: params.errorResource?.trim() || null,
    },
  })
  const failed = readRequiredBoolean(row, 'failed', 'fail')
  const resultCode = readOptionalString(row.result_code)
  if (!resultCode) {
    throw new XeroSyncRunContractError({ operation: 'fail', detail: 'response was missing result_code' })
  }
  return { failed, resultCode }
}

export interface XeroSyncRunManifestStep {
  stepKey: XeroSyncRunStepKey
  status: 'pending' | 'succeeded'
  recordCount: number | null
  completedAt: string | null
}

export async function loadXeroGenerationRunManifest(params: {
  syncRunId: string
  supabaseAdmin?: SupabaseAdminClient
}) {
  const syncRunId = requireNonEmpty(params.syncRunId, 'syncRunId')
  const supabaseAdmin = params.supabaseAdmin ?? createSupabaseAdminClient()
  const { data, error } = await supabaseAdmin
    .from('xero_sync_run_steps')
    .select('step_key, status, record_count, completed_at')
    .eq('sync_run_id', syncRunId)
    .order('step_key', { ascending: true })

  if (error) {
    throw new XeroSyncRunContractError({
      operation: 'manifest',
      code: error.code,
      detail: safeDatabaseDetail(error.code),
    })
  }
  if (!Array.isArray(data)) {
    throw new XeroSyncRunContractError({
      operation: 'manifest',
      detail: 'database returned an invalid manifest',
    })
  }

  return data.map((raw): XeroSyncRunManifestStep => {
    const row = raw as Record<string, unknown>
    const stepKey = readOptionalString(row.step_key)
    const status = readOptionalString(row.status)
    const recordCount = row.record_count === null
      ? null
      : typeof row.record_count === 'number'
        ? row.record_count
        : typeof row.record_count === 'string' && /^\d+$/.test(row.record_count)
          ? Number(row.record_count)
          : Number.NaN
    if (
      !stepKey ||
      !XERO_SYNC_RUN_REQUIRED_STEPS.includes(stepKey as XeroSyncRunStepKey) ||
      (status !== 'pending' && status !== 'succeeded') ||
      !(
        recordCount === null ||
        (Number.isSafeInteger(recordCount) && recordCount >= 0)
      )
    ) {
      throw new XeroSyncRunContractError({
        operation: 'manifest',
        detail: 'database returned a malformed manifest row',
      })
    }
    return {
      stepKey: stepKey as XeroSyncRunStepKey,
      status,
      recordCount,
      completedAt: readOptionalString(row.completed_at),
    }
  })
}
