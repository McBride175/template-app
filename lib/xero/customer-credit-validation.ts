import 'server-only'

import type { createSupabaseAdminClient } from '@/lib/supabase-admin'
import {
  CUSTOMER_CREDIT_CONTRACT_VERSION,
  INVOICE_EXACT_MONEY_CONTRACT_VERSION,
} from '@/lib/collections/customer-credit-actionability'
import {
  CustomerCreditStabilityError,
  type CreditStabilityObservation,
} from '@/lib/xero/customer-credit-stability'

export type CreditResource = 'overpayments' | 'prepayments' | 'creditnotes'
export type CreditValidationResource = 'invoices' | CreditResource
export type CreditValidationReason =
  | 'stable_observation' | 'initial_invoice_incomplete' | 'overpayments_incomplete'
  | 'prepayments_incomplete' | 'credit_notes_incomplete' | 'invoice_verification_incomplete'
  | 'credit_verification_incomplete' | 'invoice_state_changed' | 'credit_state_changed'
  | 'invalid_invoice_state' | 'invalid_credit_state' | 'missing_version_evidence'
  | 'validation_timeout' | 'evidence_changed_after_validation'

export interface CreditValidationRecord {
  readiness_state: 'ready' | 'unavailable'
  reason_code: CreditValidationReason
  consistency_result: 'matched' | 'changed' | 'incomplete'
  validation_started_at: string
  validation_completed_at: string
  resource_observations: {
    initial: Partial<Record<CreditValidationResource, CreditStabilityObservation>>
    verification: Partial<Record<CreditValidationResource, CreditStabilityObservation>>
  }
}

function isDeadline(error: unknown) {
  return !!error && typeof error === 'object' && 'kind' in error && error.kind === 'deadline'
}

/** One ordered observational sweep. No convergence retries and no Xero snapshot claim. */
export async function validateCustomerCreditStability(params: {
  initial: Partial<Record<CreditValidationResource, CreditStabilityObservation>>
  initialProblem?: CreditValidationReason
  readInvoices: () => Promise<CreditStabilityObservation>
  readCredit: (resource: CreditResource) => Promise<CreditStabilityObservation>
  now: () => number
  deadlineAtMs: number
}): Promise<CreditValidationRecord> {
  const startedAt = new Date(params.now()).toISOString()
  const observations: CreditValidationRecord['resource_observations'] = { initial: params.initial, verification: {} }
  const result = (reason: CreditValidationReason, consistency: CreditValidationRecord['consistency_result']): CreditValidationRecord => ({
    readiness_state: reason === 'stable_observation' ? 'ready' : 'unavailable',
    reason_code: reason, consistency_result: consistency,
    validation_started_at: startedAt, validation_completed_at: new Date(params.now()).toISOString(),
    resource_observations: observations,
  })
  if (params.initialProblem) return result(params.initialProblem, 'incomplete')
  if (!params.initial.invoices) return result('initial_invoice_incomplete', 'incomplete')
  for (const [resource, reason] of [
    ['overpayments', 'overpayments_incomplete'], ['prepayments', 'prepayments_incomplete'],
    ['creditnotes', 'credit_notes_incomplete'],
  ] as const) {
    if (!params.initial[resource]) return result(reason, 'incomplete')
  }
  if (params.now() >= params.deadlineAtMs) return result('validation_timeout', 'incomplete')
  try {
    observations.verification.invoices = await params.readInvoices()
  } catch (error) {
    if (isDeadline(error) || params.now() >= params.deadlineAtMs) return result('validation_timeout', 'incomplete')
    if (error instanceof CustomerCreditStabilityError) return result(error.reason, 'incomplete')
    return result('invoice_verification_incomplete', 'incomplete')
  }
  if (params.now() >= params.deadlineAtMs) return result('validation_timeout', 'incomplete')
  const resources: CreditResource[] = ['overpayments', 'prepayments', 'creditnotes']
  const settled = await Promise.allSettled(resources.map(resource => params.readCredit(resource)))
  for (let index = 0; index < settled.length; index++) {
    const outcome = settled[index]
    if (outcome.status === 'fulfilled') observations.verification[resources[index]] = outcome.value
  }
  if (params.now() >= params.deadlineAtMs || settled.some(outcome => outcome.status === 'rejected' && isDeadline(outcome.reason))) {
    return result('validation_timeout', 'incomplete')
  }
  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      return result(outcome.reason instanceof CustomerCreditStabilityError ? outcome.reason.reason : 'credit_verification_incomplete', 'incomplete')
    }
  }
  const invoice0 = params.initial.invoices
  const invoice1 = observations.verification.invoices
  if (invoice0.count !== invoice1.count || invoice0.signature !== invoice1.signature) {
    return result('invoice_state_changed', 'changed')
  }
  for (const resource of resources) {
    const before = params.initial[resource]
    const after = observations.verification[resource]
    if (!before || !after) return result('credit_verification_incomplete', 'incomplete')
    if (before.count !== after.count || before.signature !== after.signature) {
      return result('credit_state_changed', 'changed')
    }
  }
  return result('stable_observation', 'matched')
}

export async function persistCustomerCreditValidation(params: {
  syncRunId: string; userId: string; tenantId: string; leaseOwner: string; fencingToken: number
  validation: CreditValidationRecord
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>
}) {
  const { error } = await params.supabaseAdmin.rpc('record_xero_customer_credit_stability_validation', {
    p_sync_run_id: params.syncRunId, p_user_id: params.userId, p_tenant_id: params.tenantId,
    p_lease_owner: params.leaseOwner, p_fencing_token: params.fencingToken,
    p_contract_version: CUSTOMER_CREDIT_CONTRACT_VERSION,
    p_invoice_money_contract_version: INVOICE_EXACT_MONEY_CONTRACT_VERSION,
    p_validation: params.validation,
  })
  if (error) throw new Error('Customer-credit stability persistence failed')
}
