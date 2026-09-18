import type { XeroSnapshotReference } from '@/lib/xero/authoritative-snapshot'
import type { XeroSyncRunStepKey } from '@/lib/xero/generation-run'

export type XeroPreparationStage =
  | 'connected'
  | 'reading_xero'
  | 'analysing_receivables'
  | 'building_priorities'
  | 'ready'
  | 'failed'
  | 'interrupted'

export type XeroPreparationFailureKind =
  | 'reconnect_required'
  | 'permission_upgrade_required'
  | 'provider_failure'
  | 'preparation_failure'

export interface XeroPreparationCounts {
  contacts: number
  invoices: number
  payments: number
}

export interface XeroPreparationStatus {
  stage: XeroPreparationStage
  active: boolean
  startedAt: string | null
  counts: XeroPreparationCounts | null
  failureKind: XeroPreparationFailureKind | null
}

export interface XeroPreparationAttempt {
  state: 'running' | 'failed' | 'interrupted' | 'promoted'
  startedAt: string | null
  errorCode: string | null
}

export interface XeroPreparationStep {
  stepKey: XeroSyncRunStepKey
  status: 'pending' | 'succeeded'
  recordCount: number | null
}

const RETRIEVAL_STEPS = [
  'contacts',
  'authorised_accrec_invoices',
  'paid_accrec_invoices',
  'authorised_accrec_payments',
] as const satisfies readonly XeroSyncRunStepKey[]

function succeededStep(
  steps: readonly XeroPreparationStep[],
  stepKey: XeroSyncRunStepKey
) {
  return steps.find((step) => step.stepKey === stepKey && step.status === 'succeeded') ?? null
}

function safeCount(step: XeroPreparationStep | null) {
  return step && Number.isSafeInteger(step.recordCount) && (step.recordCount ?? -1) >= 0
    ? step.recordCount
    : null
}

function resolveCounts(steps: readonly XeroPreparationStep[]) {
  if (!RETRIEVAL_STEPS.every((stepKey) => succeededStep(steps, stepKey))) return null

  const contacts = safeCount(succeededStep(steps, 'contacts'))
  const authorisedInvoices = safeCount(succeededStep(steps, 'authorised_accrec_invoices'))
  const paidInvoices = safeCount(succeededStep(steps, 'paid_accrec_invoices'))
  const payments = safeCount(succeededStep(steps, 'authorised_accrec_payments'))
  if (
    contacts === null ||
    authorisedInvoices === null ||
    paidInvoices === null ||
    payments === null
  ) {
    return null
  }

  return {
    contacts,
    invoices: authorisedInvoices + paidInvoices,
    payments,
  }
}

export function classifyXeroPreparationFailure(errorCode: string | null) {
  if (errorCode === 'xero_reauth_required') return 'reconnect_required'
  if (errorCode === 'xero_permission_required') return 'permission_upgrade_required'
  if (
    errorCode === 'xero_rate_limited' ||
    errorCode === 'xero_daily_limit' ||
    errorCode === 'provider_unavailable' ||
    errorCode === 'provider_timeout' ||
    errorCode === 'provider_data_invalid'
  ) {
    return 'provider_failure'
  }
  return 'preparation_failure'
}

export function resolveXeroPreparationStatus(params: {
  snapshot: XeroSnapshotReference | null
  lastSyncedAt: string | null
  attempt: XeroPreparationAttempt | null
  steps: readonly XeroPreparationStep[]
}): XeroPreparationStatus {
  if (params.snapshot && params.lastSyncedAt) {
    return {
      stage: 'ready',
      active: false,
      startedAt: params.attempt?.startedAt ?? null,
      counts: null,
      failureKind: null,
    }
  }

  if (!params.attempt) {
    return {
      stage: 'connected',
      active: false,
      startedAt: null,
      counts: null,
      failureKind: null,
    }
  }

  if (params.attempt.state === 'failed') {
    return {
      stage: 'failed',
      active: false,
      startedAt: params.attempt.startedAt,
      counts: null,
      failureKind: classifyXeroPreparationFailure(params.attempt.errorCode),
    }
  }

  if (params.attempt.state === 'interrupted') {
    return {
      stage: 'interrupted',
      active: false,
      startedAt: params.attempt.startedAt,
      counts: null,
      failureKind: 'preparation_failure',
    }
  }

  if (params.attempt.state === 'promoted') {
    return {
      stage: 'ready',
      active: false,
      startedAt: params.attempt.startedAt,
      counts: null,
      failureKind: null,
    }
  }

  const counts = resolveCounts(params.steps)
  if (!counts) {
    return {
      stage: 'reading_xero',
      active: true,
      startedAt: params.attempt.startedAt,
      counts: null,
      failureKind: null,
    }
  }

  if (!succeededStep(params.steps, 'canonical_mapping')) {
    return {
      stage: 'analysing_receivables',
      active: true,
      startedAt: params.attempt.startedAt,
      counts,
      failureKind: null,
    }
  }

  return {
    stage: 'building_priorities',
    active: true,
    startedAt: params.attempt.startedAt,
    counts,
    failureKind: null,
  }
}
