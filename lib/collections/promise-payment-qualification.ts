import { normalizeCurrencyCode, sumDecimalValues } from '@/lib/money/currency'
import {
  PROMISE_ACCOUNTING_CONTRACT, completePromiseResource, derivePromiseTimeContext,
  exactPromiseAmount, observationMatchesPromise, promiseInstant, samePromiseScope, validPromiseDate,
  type PromiseAccountingObservation, type PromiseLifecycleRecord, type PromisePaymentEvidence,
} from '@/lib/collections/promise-evidence'

export const PROMISE_PAYMENT_QUALIFICATION_VERSION = 'promise_payment_qualification_v1'
export type PaymentExclusionReason = 'creation_baseline' | 'another_invoice' | 'deleted_payment' |
  'unsupported_payment_type' | 'before_creation_date' | 'after_promised_date'
export type PaymentQualificationFailure = 'payment_evidence_incomplete' | 'identity_invalid' |
  'currency_evidence_unavailable' | 'timezone_unavailable' | 'baseline_invalid' |
  'promise_terms_invalid' | 'payment_evidence_invalid' | 'observation_invalid'

export interface QualifiedPaymentContribution {
  source_id: string
  amount_native: string
  payment_date: string
}

export interface PromisePaymentQualification {
  contract_version: typeof PROMISE_PAYMENT_QUALIFICATION_VERSION
  promise_id: string
  promise_revision: number
  promised_amount_native: string | null
  promised_date: string
  currency_code: string | null
  generation_id: string
  payment_observation: { started_at: string; completed_at: string } | null
  deadline_boundary: string | null
  creation_local_date: string | null
  valid: boolean
  reason: PaymentQualificationFailure | null
  qualifying_paid_amount_native: string | null
  contributions: QualifiedPaymentContribution[]
  excluded: { source_id: string; reason: PaymentExclusionReason }[]
}

/** Recompute from the whole certified generation; totals are never accumulated or capped. */
export function qualifyPromisePayments(input: {
  promise: PromiseLifecycleRecord
  observation: PromiseAccountingObservation
  payments: readonly PromisePaymentEvidence[]
}): PromisePaymentQualification {
  const { promise, observation, payments } = input
  const promised = exactPromiseAmount(promise.promised_amount_native, true)
  const currency = normalizeCurrencyCode(promise.currency_code)
  const result: PromisePaymentQualification = {
    contract_version: PROMISE_PAYMENT_QUALIFICATION_VERSION, promise_id: promise.id,
    promise_revision: promise.revision, promised_amount_native: promised, promised_date: promise.promised_date,
    currency_code: currency, generation_id: observation.sync_run_id, payment_observation: null, deadline_boundary: null,
    creation_local_date: null, valid: false, reason: null, qualifying_paid_amount_native: null,
    contributions: [], excluded: [],
  }
  const fail = (reason: PaymentQualificationFailure) => ({ ...result, reason })
  if (!observationMatchesPromise(observation, promise)) return fail('identity_invalid')
  if (!promised || !validPromiseDate(promise.promised_date) || !Number.isSafeInteger(promise.revision) || promise.revision < 1) return fail('promise_terms_invalid')
  if (!currency) return fail('currency_evidence_unavailable')
  const time = derivePromiseTimeContext(promise.created_at, promise.promised_date, observation.timezone_iana)
  if (!time) return fail('timezone_unavailable')
  result.creation_local_date = time.creationLocalDate
  result.deadline_boundary = time.deadlineBoundary
  const baseline = promise.payment_baseline
  const baselineStart = promiseInstant(baseline?.observation_started_at)
  const baselineEnd = promiseInstant(baseline?.observation_completed_at)
  if (baseline?.version !== 1 || !Array.isArray(baseline.payment_ids) ||
      baseline.payment_ids.some(id => typeof id !== 'string' || !id.trim()) ||
      new Set(baseline.payment_ids).size !== baseline.payment_ids.length ||
      baselineStart === null || baselineEnd === null || baselineEnd < baselineStart ||
      baselineEnd > promiseInstant(promise.created_at)!) return fail('baseline_invalid')
  if (observation.contract_version !== PROMISE_ACCOUNTING_CONTRACT || observation.status !== 'succeeded' || !observation.authoritative) return fail('payment_evidence_incomplete')
  const resource = completePromiseResource(observation, 'payments')
  if (!resource || resource.mapped_count !== payments.length) return fail('payment_evidence_incomplete')
  if (promiseInstant(resource.completed_at)! < promiseInstant(promise.created_at)! ||
      promiseInstant(resource.started_at)! < baselineStart) return fail('observation_invalid')
  result.payment_observation = { started_at: resource.started_at, completed_at: resource.completed_at! }
  const known = new Set(baseline.payment_ids), seen = new Set<string>()
  for (const payment of [...payments].sort((a, b) => a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 : 0)) {
    if (!samePromiseScope(payment, observation)) return fail('identity_invalid')
    if (!payment.source_id?.trim() || seen.has(payment.source_id)) return fail('payment_evidence_invalid')
    seen.add(payment.source_id)
    const exclude = (reason: PaymentExclusionReason) => result.excluded.push({ source_id: payment.source_id, reason })
    if (known.has(payment.source_id)) { exclude('creation_baseline'); continue }
    if (payment.payment_type !== 'ACCRECPAYMENT') { exclude('unsupported_payment_type'); continue }
    if (!payment.invoice_source_id?.trim()) return fail('identity_invalid')
    if (payment.invoice_source_id !== promise.invoice_source_id) { exclude('another_invoice'); continue }
    if (payment.customer_source_id !== promise.customer_source_id) return fail('identity_invalid')
    if (normalizeCurrencyCode(payment.currency_code) !== currency) return fail('currency_evidence_unavailable')
    if (payment.payment_status === 'DELETED') { exclude('deleted_payment'); continue }
    const amount = exactPromiseAmount(payment.amount_native)
    if (payment.payment_status !== 'AUTHORISED' || amount === null || !validPromiseDate(payment.payment_date)) return fail('payment_evidence_invalid')
    if (payment.payment_date < time.creationLocalDate) { exclude('before_creation_date'); continue }
    if (payment.payment_date > promise.promised_date) { exclude('after_promised_date'); continue }
    result.contributions.push({ source_id: payment.source_id, amount_native: amount, payment_date: payment.payment_date })
  }
  const total = sumDecimalValues(result.contributions.map(row => row.amount_native))
  if (exactPromiseAmount(total) === null) return fail('payment_evidence_invalid')
  return { ...result, valid: true, qualifying_paid_amount_native: total }
}
