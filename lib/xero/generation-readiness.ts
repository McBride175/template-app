import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>

export const XERO_GENERATION_READINESS_CONTRACT_VERSION = 'collections_readiness_v2'

type XeroGenerationReadinessOperation = 'inspect' | 'record' | 'reacquire'

export class XeroGenerationReadinessContractError extends Error {
  readonly operation: XeroGenerationReadinessOperation
  readonly code: string | null

  constructor(params: {
    operation: XeroGenerationReadinessOperation
    code?: string | null
    detail: string
  }) {
    super(`Xero generation readiness ${params.operation} failed: ${params.detail}`)
    this.name = 'XeroGenerationReadinessContractError'
    this.operation = params.operation
    this.code = params.code ?? null
  }
}

export interface XeroGenerationReadinessEvaluation {
  ready: boolean
  resultCode: string
  contractVersion: typeof XERO_GENERATION_READINESS_CONTRACT_VERSION
  baseCurrencyCode: string | null
  counts: {
    rawOrganisations: number
    rawContacts: number
    rawAuthorisedInvoices: number
    rawPaidInvoices: number
    rawPayments: number
    canonicalOrganisations: number
    canonicalCustomers: number
    canonicalInvoices: number
    canonicalPayments: number
  }
  violations: {
    incompleteFxInvoices: number
    source: number
    reconciliation: number
    relationships: number
    fx: number
  }
}

export interface XeroGenerationReadinessEvidence {
  validated: boolean
  resultCode: string
  validationId: string | null
  validatedAt: string | null
  contractVersion: typeof XERO_GENERATION_READINESS_CONTRACT_VERSION
  fencingToken: number
  baseCurrencyCode: string | null
  incompleteFxInvoiceCount: number | null
  fxViolationCount: number | null
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

function readRpcRow(data: unknown, operation: XeroGenerationReadinessOperation) {
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new XeroGenerationReadinessContractError({
      operation,
      detail: 'database returned an invalid contract response',
    })
  }
  return row as Record<string, unknown>
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readRequiredString(
  row: Record<string, unknown>,
  key: string,
  operation: XeroGenerationReadinessOperation
) {
  const value = readOptionalString(row[key])
  if (!value) {
    throw new XeroGenerationReadinessContractError({
      operation,
      detail: `response was missing ${key}`,
    })
  }
  return value
}

function readRequiredBoolean(
  row: Record<string, unknown>,
  key: string,
  operation: XeroGenerationReadinessOperation
) {
  if (typeof row[key] !== 'boolean') {
    throw new XeroGenerationReadinessContractError({
      operation,
      detail: `response was missing ${key}`,
    })
  }
  return row[key]
}

function readInteger(
  value: unknown,
  operation: XeroGenerationReadinessOperation,
  key: string,
  nullable?: false
): number
function readInteger(
  value: unknown,
  operation: XeroGenerationReadinessOperation,
  key: string,
  nullable: true
): number | null
function readInteger(
  value: unknown,
  operation: XeroGenerationReadinessOperation,
  key: string,
  nullable = false
) {
  if (nullable && value === null) return null
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value)
      ? Number(value)
      : Number.NaN
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new XeroGenerationReadinessContractError({
      operation,
      detail: `response contained invalid ${key}`,
    })
  }
  return parsed
}

async function rpcRow(params: {
  supabaseAdmin: SupabaseAdminClient
  functionName: string
  args: Record<string, unknown>
  operation: XeroGenerationReadinessOperation
}) {
  const { data, error } = await params.supabaseAdmin.rpc(params.functionName, params.args)
  if (error) {
    throw new XeroGenerationReadinessContractError({
      operation: params.operation,
      code: error.code,
      detail: error.code ? `database error ${error.code}` : 'database request failed',
    })
  }
  return readRpcRow(data, params.operation)
}

function requireContractVersion(value = XERO_GENERATION_READINESS_CONTRACT_VERSION) {
  if (value !== XERO_GENERATION_READINESS_CONTRACT_VERSION) {
    throw new TypeError('unsupported Xero generation readiness contract version')
  }
  return value
}

function parseEvaluation(row: Record<string, unknown>): XeroGenerationReadinessEvaluation {
  const operation = 'inspect' as const
  const contractVersion = readRequiredString(row, 'contract_version', operation)
  if (contractVersion !== XERO_GENERATION_READINESS_CONTRACT_VERSION) {
    throw new XeroGenerationReadinessContractError({
      operation,
      detail: 'database returned an unsupported readiness contract version',
    })
  }
  return {
    ready: readRequiredBoolean(row, 'ready', operation),
    resultCode: readRequiredString(row, 'result_code', operation),
    contractVersion,
    baseCurrencyCode: readOptionalString(row.base_currency_code),
    counts: {
      rawOrganisations: readInteger(row.raw_organisation_count, operation, 'raw_organisation_count'),
      rawContacts: readInteger(row.raw_contact_count, operation, 'raw_contact_count'),
      rawAuthorisedInvoices: readInteger(
        row.raw_authorised_invoice_count,
        operation,
        'raw_authorised_invoice_count'
      ),
      rawPaidInvoices: readInteger(row.raw_paid_invoice_count, operation, 'raw_paid_invoice_count'),
      rawPayments: readInteger(row.raw_payment_count, operation, 'raw_payment_count'),
      canonicalOrganisations: readInteger(
        row.canonical_organisation_count,
        operation,
        'canonical_organisation_count'
      ),
      canonicalCustomers: readInteger(
        row.canonical_customer_count,
        operation,
        'canonical_customer_count'
      ),
      canonicalInvoices: readInteger(
        row.canonical_invoice_count,
        operation,
        'canonical_invoice_count'
      ),
      canonicalPayments: readInteger(
        row.canonical_payment_count,
        operation,
        'canonical_payment_count'
      ),
    },
    violations: {
      incompleteFxInvoices: readInteger(
        row.incomplete_fx_invoice_count,
        operation,
        'incomplete_fx_invoice_count'
      ),
      source: readInteger(row.source_violation_count, operation, 'source_violation_count'),
      reconciliation: readInteger(
        row.reconciliation_violation_count,
        operation,
        'reconciliation_violation_count'
      ),
      relationships: readInteger(
        row.relationship_violation_count,
        operation,
        'relationship_violation_count'
      ),
      fx: readInteger(row.fx_violation_count, operation, 'fx_violation_count'),
    },
  }
}

export async function inspectXeroGenerationReadiness(params: {
  syncRunId: string
  userId: string
  tenantId: string
  contractVersion?: typeof XERO_GENERATION_READINESS_CONTRACT_VERSION
  supabaseAdmin?: SupabaseAdminClient
}) {
  const supabaseAdmin = params.supabaseAdmin ?? createSupabaseAdminClient()
  const row = await rpcRow({
    supabaseAdmin,
    functionName: 'inspect_xero_sync_run_readiness',
    operation: 'inspect',
    args: {
      p_sync_run_id: requireNonEmpty(params.syncRunId, 'syncRunId'),
      p_user_id: requireNonEmpty(params.userId, 'userId'),
      p_tenant_id: requireNonEmpty(params.tenantId, 'tenantId'),
      p_contract_version: requireContractVersion(params.contractVersion),
    },
  })
  return parseEvaluation(row)
}

export async function recordXeroGenerationReadiness(params: {
  syncRunId: string
  userId: string
  tenantId: string
  leaseOwner: string
  fencingToken: number
  contractVersion?: typeof XERO_GENERATION_READINESS_CONTRACT_VERSION
  supabaseAdmin?: SupabaseAdminClient
}): Promise<XeroGenerationReadinessEvidence> {
  const supabaseAdmin = params.supabaseAdmin ?? createSupabaseAdminClient()
  const row = await rpcRow({
    supabaseAdmin,
    functionName: 'record_xero_sync_run_readiness',
    operation: 'record',
    args: {
      p_sync_run_id: requireNonEmpty(params.syncRunId, 'syncRunId'),
      p_user_id: requireNonEmpty(params.userId, 'userId'),
      p_tenant_id: requireNonEmpty(params.tenantId, 'tenantId'),
      p_lease_owner: requireNonEmpty(params.leaseOwner, 'leaseOwner'),
      p_fencing_token: requirePositiveInteger(params.fencingToken, 'fencingToken'),
      p_contract_version: requireContractVersion(params.contractVersion),
    },
  })
  const contractVersion = readRequiredString(row, 'contract_version', 'record')
  if (contractVersion !== XERO_GENERATION_READINESS_CONTRACT_VERSION) {
    throw new XeroGenerationReadinessContractError({
      operation: 'record',
      detail: 'database returned an unsupported readiness contract version',
    })
  }
  return {
    validated: readRequiredBoolean(row, 'validated', 'record'),
    resultCode: readRequiredString(row, 'result_code', 'record'),
    validationId: readOptionalString(row.validation_id),
    validatedAt: readOptionalString(row.validated_at),
    contractVersion,
    fencingToken: requirePositiveInteger(
      readInteger(row.fencing_token, 'record', 'fencing_token'),
      'fencingToken'
    ),
    baseCurrencyCode: readOptionalString(row.base_currency_code),
    incompleteFxInvoiceCount: readInteger(
      row.incomplete_fx_invoice_count,
      'record',
      'incomplete_fx_invoice_count',
      true
    ),
    fxViolationCount: readInteger(
      row.fx_violation_count,
      'record',
      'fx_violation_count',
      true
    ),
  }
}

export async function reacquireXeroGenerationRunForPromotion(params: {
  syncRunId: string
  userId: string
  tenantId: string
  leaseOwner: string
  leaseTtlSeconds: number
  contractVersion?: typeof XERO_GENERATION_READINESS_CONTRACT_VERSION
  supabaseAdmin?: SupabaseAdminClient
}) {
  const supabaseAdmin = params.supabaseAdmin ?? createSupabaseAdminClient()
  const row = await rpcRow({
    supabaseAdmin,
    functionName: 'reacquire_xero_sync_run_for_promotion',
    operation: 'reacquire',
    args: {
      p_sync_run_id: requireNonEmpty(params.syncRunId, 'syncRunId'),
      p_user_id: requireNonEmpty(params.userId, 'userId'),
      p_tenant_id: requireNonEmpty(params.tenantId, 'tenantId'),
      p_lease_owner: requireNonEmpty(params.leaseOwner, 'leaseOwner'),
      p_contract_version: requireContractVersion(params.contractVersion),
      p_ttl_seconds: requirePositiveInteger(params.leaseTtlSeconds, 'leaseTtlSeconds'),
    },
  })
  const acquired = readRequiredBoolean(row, 'acquired', 'reacquire')
  const resultCode = readRequiredString(row, 'result_code', 'reacquire')
  const syncRunId = readOptionalString(row.sync_run_id)
  const fencingToken = row.fencing_token === null
    ? null
    : readInteger(row.fencing_token, 'reacquire', 'fencing_token')
  const leaseExpiresAt = readOptionalString(row.lease_expires_at)
  if (acquired && (!syncRunId || !fencingToken || !leaseExpiresAt)) {
    throw new XeroGenerationReadinessContractError({
      operation: 'reacquire',
      detail: 'acquired response omitted ownership fields',
    })
  }
  return { acquired, resultCode, syncRunId, fencingToken, leaseExpiresAt }
}
