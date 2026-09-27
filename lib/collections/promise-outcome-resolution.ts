import { compareDecimalValues, convertCurrencyAmounts, normalizeCurrencyCode, sumDecimalValues } from '@/lib/money/currency'
import {
  PROMISE_ACCOUNTING_CONTRACT, completePromiseResource, derivePromiseTimeContext, exactPromiseAmount,
  observationMatchesPromise, promiseInstant, samePromiseScope, validPromiseDate,
  type PromiseAccountingObservation, type PromiseCashEvidence, type PromiseLifecycleRecord, type PromiseEvidenceScope,
} from '@/lib/collections/promise-evidence'
import {
  PROMISE_PAYMENT_QUALIFICATION_VERSION,
  type PaymentQualificationFailure, type PromisePaymentQualification, type QualifiedPaymentContribution,
} from '@/lib/collections/promise-payment-qualification'

export const PROMISE_RESOLVER_VERSION = 'promise_resolution_v1'
export type PromiseResolutionDecision = 'retain_active' | 'kept' | 'missed' | 'unclear' | 'defer'
export type PromiseResolutionReason = PaymentQualificationFailure | 'terminal_promise_unchanged' |
  'payment_commitment_satisfied' | 'deadline_not_yet_observed' | 'cash_evidence_incomplete' |
  'cash_evidence_invalid' | 'accounting_evidence_not_ready' | 'sufficient_unapplied_cash' |
  'insufficient_payment_no_plausible_cash'

export interface PromiseCurrencyValuation extends PromiseEvidenceScope {
  invoice_source_id: string
  currency_code: string
  organisation_base_currency_code: string | null
  xero_currency_rate: string | null
  currency_conversion_status: 'identity' | 'converted' | 'incomplete'
}

interface CashComparison {
  comparison: 'native' | 'base'
  same_currency_amount_native: string
  shortfall_native: string
  foreign_amount_base: string | null
  shortfall_base: string | null
  base_currency_code: string | null
  unavailable_foreign_count: number
  sufficient: boolean
  sources: { source_kind: string; source_id: string }[]
}

export interface PromiseResolutionEvidence {
  version: 1
  resolver_version: typeof PROMISE_RESOLVER_VERSION
  source_sync_run_id: string
  promised_amount_native: string
  promised_date: string
  currency_code: string
  qualifying_paid_amount_native: string
  remaining_unpaid_amount_native: string
  payments: QualifiedPaymentContribution[]
  timezone_iana: string
  deadline_boundary: string
  resource_observations: { resource: string; started_at: string; completed_at: string }[]
  cash_comparison: CashComparison | null
  effective_date: string | null
  reason_code: PromiseResolutionReason
}

export interface PromiseResolutionResult {
  decision: PromiseResolutionDecision
  reason_code: PromiseResolutionReason
  terminal: boolean
  transition_required: boolean
  payment_evaluation_valid: boolean
  qualifying_paid_amount_native: string | null
  remaining_unpaid_amount_native: string | null
  source_sync_run_id: string | null
  resolver_version: typeof PROMISE_RESOLVER_VERSION
  evaluated_at: string | null
  effective_at: string | null
  effective_date: string | null
  evidence: PromiseResolutionEvidence | null
}

function compareCash(input: {
  promise: PromiseLifecycleRecord; observation: PromiseAccountingObservation
  cash: readonly PromiseCashEvidence[]; remaining: string; valuation: PromiseCurrencyValuation | null
}): { comparison: CashComparison | null; failure: PromiseResolutionReason | null } {
  const { promise, observation, cash, remaining, valuation } = input
  const eligible: PromiseCashEvidence[] = [], seen = new Set<string>()
  const fail = (failure: PromiseResolutionReason) => ({ comparison: null, failure })
  for (const row of cash) {
    if (!samePromiseScope(row, observation)) return fail('identity_invalid')
    const key = `${row.source_kind}:${row.source_id}`
    if (!row.source_id?.trim() || seen.has(key) || !['overpayment', 'prepayment'].includes(row.source_kind)) return fail('cash_evidence_invalid')
    seen.add(key)
    if (row.customer_source_id !== promise.customer_source_id) continue
    if (row.provider_type !== `RECEIVE-${row.source_kind.toUpperCase()}` || ['VOIDED', 'DELETED', 'PAID'].includes(row.status)) continue
    if (row.status !== 'AUTHORISED' || !validPromiseDate(row.accounting_date)) return fail('cash_evidence_invalid')
    if (row.accounting_date > promise.promised_date) continue
    const amount = exactPromiseAmount(row.remaining_credit_native)
    if (amount === null || !normalizeCurrencyCode(row.currency_code)) return fail('cash_evidence_invalid')
    if (compareDecimalValues(amount, '0') === 1) eligible.push(row)
  }
  const currency = normalizeCurrencyCode(promise.currency_code)!
  const native = sumDecimalValues(eligible.filter(row => normalizeCurrencyCode(row.currency_code) === currency).map(row => row.remaining_credit_native))
  const difference = native === null ? null : sumDecimalValues([remaining, `-${native}`])
  if (difference === null) return fail('cash_evidence_invalid')
  const shortfall = compareDecimalValues(difference, '0') === -1 ? '0' : difference
  const comparison: CashComparison = {
    comparison: 'native', same_currency_amount_native: native!, shortfall_native: shortfall,
    foreign_amount_base: null, shortfall_base: null, base_currency_code: null,
    unavailable_foreign_count: 0, sufficient: shortfall === '0',
    sources: eligible.map(row => ({ source_kind: row.source_kind, source_id: row.source_id }))
      .sort((a, b) => `${a.source_kind}:${a.source_id}` < `${b.source_kind}:${b.source_id}` ? -1 : 1),
  }
  if (comparison.sufficient) return { comparison, failure: null }
  const foreign = eligible.filter(row => normalizeCurrencyCode(row.currency_code) !== currency)
  if (!foreign.length) return { comparison, failure: null }
  const base = normalizeCurrencyCode(observation.organisation_base_currency_code)
  if (!valuation || !samePromiseScope(valuation, observation) || valuation.invoice_source_id !== promise.invoice_source_id ||
      normalizeCurrencyCode(valuation.currency_code) !== currency || !base ||
      normalizeCurrencyCode(valuation.organisation_base_currency_code) !== base) return fail('currency_evidence_unavailable')
  const target = convertCurrencyAmounts({ transactionCurrency: currency, organisationBaseCurrency: base,
    xeroCurrencyRate: valuation.xero_currency_rate, amounts: { shortfall } })
  if (target.status === 'incomplete' || target.status !== valuation.currency_conversion_status ||
      target.amounts.shortfall.base === null || compareDecimalValues(target.amounts.shortfall.base, '0') !== 1) return fail('currency_evidence_unavailable')
  const baseValues: string[] = []
  for (const row of foreign) {
    const converted = convertCurrencyAmounts({ transactionCurrency: row.currency_code, organisationBaseCurrency: base,
      xeroCurrencyRate: row.xero_currency_rate, amounts: { remaining: row.remaining_credit_native } })
    if (normalizeCurrencyCode(row.organisation_base_currency_code) !== base || converted.status === 'incomplete' ||
        converted.status !== row.currency_conversion_status || exactPromiseAmount(row.remaining_credit_base) === null ||
        compareDecimalValues(converted.amounts.remaining.base, row.remaining_credit_base) !== 0) {
      comparison.unavailable_foreign_count++
    } else baseValues.push(row.remaining_credit_base!)
  }
  const total = sumDecimalValues(baseValues)
  if (exactPromiseAmount(total) === null) return fail('currency_evidence_unavailable')
  comparison.comparison = 'base'
  comparison.base_currency_code = base
  comparison.shortfall_base = target.amounts.shortfall.base
  comparison.foreign_amount_base = total
  comparison.sufficient = compareDecimalValues(total, comparison.shortfall_base)! >= 0
  if (!comparison.sufficient && comparison.unavailable_foreign_count) return fail('currency_evidence_unavailable')
  return { comparison, failure: null }
}

/** Pure evidence decision. A defer is never a persisted business status. */
export function resolvePromiseOutcome(input: {
  promise: PromiseLifecycleRecord
  observation: PromiseAccountingObservation
  qualifiedPayments: PromisePaymentQualification
  cash: readonly PromiseCashEvidence[]
  promiseValuation: PromiseCurrencyValuation | null
}): PromiseResolutionResult {
  const { promise, observation, qualifiedPayments: qualified } = input
  const result: PromiseResolutionResult = {
    decision: 'defer', reason_code: 'promise_terms_invalid', terminal: false, transition_required: false, payment_evaluation_valid: false,
    qualifying_paid_amount_native: null, remaining_unpaid_amount_native: null,
    source_sync_run_id: null, resolver_version: PROMISE_RESOLVER_VERSION,
    evaluated_at: null, effective_at: null, effective_date: null, evidence: null,
  }
  if (['kept', 'missed', 'unclear', 'cancelled'].includes(promise.status)) {
    // Preserve operational facts without inspecting new evidence or proposing a transition.
    const paid = exactPromiseAmount(promise.qualifying_paid_amount_native)
    const promised = exactPromiseAmount(promise.promised_amount_native, true)
    const remaining = promised !== null && paid !== null ? sumDecimalValues([promised, `-${paid}`]) : null
    return { ...result, terminal: true, reason_code: 'terminal_promise_unchanged',
      qualifying_paid_amount_native: paid,
      remaining_unpaid_amount_native: remaining === null ? null : compareDecimalValues(remaining, '0') === -1 ? '0' : remaining }
  }
  const defer = (reason_code: PromiseResolutionReason) => ({ ...result, reason_code })
  if (promise.status !== 'active' || !exactPromiseAmount(promise.promised_amount_native, true)) return defer('promise_terms_invalid')
  if (!observationMatchesPromise(observation, promise)) return defer('identity_invalid')
  const time = derivePromiseTimeContext(promise.created_at, promise.promised_date, observation.timezone_iana)
  if (!time) return defer('timezone_unavailable')
  if (observation.contract_version !== PROMISE_ACCOUNTING_CONTRACT || observation.status !== 'succeeded' || !observation.authoritative) return defer('payment_evidence_incomplete')
  const paymentResource = completePromiseResource(observation, 'payments')
  if (!paymentResource) return defer('payment_evidence_incomplete')
  if (!qualified.valid) return defer(qualified.reason ?? 'payment_evidence_invalid')
  const promised = exactPromiseAmount(promise.promised_amount_native, true)!
  const currency = normalizeCurrencyCode(promise.currency_code)
  if (!currency || qualified.currency_code !== currency) return defer('currency_evidence_unavailable')
  if (qualified.contract_version !== PROMISE_PAYMENT_QUALIFICATION_VERSION || qualified.promise_id !== promise.id ||
      qualified.promise_revision !== promise.revision || qualified.generation_id !== observation.sync_run_id ||
      qualified.promised_amount_native !== promised || qualified.promised_date !== promise.promised_date ||
      qualified.deadline_boundary !== time.deadlineBoundary || qualified.creation_local_date !== time.creationLocalDate) return defer('identity_invalid')
  if (qualified.payment_observation?.started_at !== paymentResource.started_at ||
      qualified.payment_observation?.completed_at !== paymentResource.completed_at) return defer('observation_invalid')
  const paid = exactPromiseAmount(qualified.qualifying_paid_amount_native)
  const baseline = new Set(promise.payment_baseline.payment_ids), ids = new Set<string>()
  for (const payment of qualified.contributions) {
    if (!payment.source_id?.trim() || ids.has(payment.source_id) || baseline.has(payment.source_id) ||
        exactPromiseAmount(payment.amount_native) === null || !validPromiseDate(payment.payment_date) ||
        payment.payment_date < time.creationLocalDate || payment.payment_date > promise.promised_date) return defer('payment_evidence_invalid')
    ids.add(payment.source_id)
  }
  if (paid === null || compareDecimalValues(sumDecimalValues(qualified.contributions.map(row => row.amount_native)), paid) !== 0) return defer('payment_evidence_invalid')
  const unpaid = sumDecimalValues([promised, `-${paid}`])
  if (unpaid === null) return defer('payment_evidence_invalid')
  result.qualifying_paid_amount_native = paid
  result.payment_evaluation_valid = true
  result.remaining_unpaid_amount_native = compareDecimalValues(unpaid, '0') === -1 ? '0' : unpaid
  result.source_sync_run_id = observation.sync_run_id
  result.evaluated_at = new Date(promiseInstant(paymentResource.completed_at)!).toISOString()
  const resources = [paymentResource]
  const finish = (decision: PromiseResolutionDecision, reason: PromiseResolutionReason,
    cash: CashComparison | null = null, effectiveDate: string | null = null): PromiseResolutionResult => {
    const terminal = ['kept', 'missed', 'unclear'].includes(decision)
    const negative = decision === 'missed' || decision === 'unclear'
    return { ...result, decision, reason_code: reason, terminal, transition_required: terminal,
      effective_at: negative ? time.deadlineBoundary : null, effective_date: effectiveDate,
      evidence: { version: 1, resolver_version: PROMISE_RESOLVER_VERSION, source_sync_run_id: observation.sync_run_id,
        promised_amount_native: promised, promised_date: promise.promised_date, currency_code: currency,
        qualifying_paid_amount_native: paid, remaining_unpaid_amount_native: result.remaining_unpaid_amount_native!,
        payments: qualified.contributions.map(row => ({ ...row })).sort((a, b) => a.source_id < b.source_id ? -1 : 1),
        timezone_iana: time.timezone, deadline_boundary: time.deadlineBoundary,
        resource_observations: resources.map(row => ({ resource: row.resource, started_at: row.started_at, completed_at: row.completed_at! })),
        cash_comparison: cash, effective_date: effectiveDate, reason_code: reason } }
  }
  if (compareDecimalValues(paid, promised)! >= 0) {
    let cumulative = '0', satisfiedDate: string | null = null
    for (const payment of [...qualified.contributions].sort((a, b) => a.payment_date < b.payment_date ? -1 : a.payment_date > b.payment_date ? 1 : a.source_id < b.source_id ? -1 : 1)) {
      cumulative = sumDecimalValues([cumulative, payment.amount_native])!
      if (compareDecimalValues(cumulative, promised)! >= 0) { satisfiedDate = payment.payment_date; break }
    }
    return finish('kept', 'payment_commitment_satisfied', null, satisfiedDate)
  }
  if (promiseInstant(paymentResource.started_at)! < promiseInstant(time.deadlineBoundary)!) return finish('retain_active', 'deadline_not_yet_observed')
  for (const resource of ['overpayments', 'prepayments'] as const) {
    const row = completePromiseResource(observation, resource)
    if (!row) return defer('cash_evidence_incomplete')
    resources.push(row)
  }
  if (resources.some(row => promiseInstant(row.started_at)! < promiseInstant(time.deadlineBoundary)!)) return finish('retain_active', 'deadline_not_yet_observed')
  if (!observation.ready) return defer('accounting_evidence_not_ready')
  if (resources.slice(1).some(row => row.mapped_count !== input.cash.filter(cash => cash.source_kind === (row.resource === 'overpayments' ? 'overpayment' : 'prepayment')).length)) return defer('cash_evidence_incomplete')
  result.evaluated_at = new Date(Math.max(...resources.map(row => promiseInstant(row.completed_at)!))).toISOString()
  const cash = compareCash({ promise, observation, cash: input.cash,
    remaining: result.remaining_unpaid_amount_native!, valuation: input.promiseValuation })
  if (cash.failure) return defer(cash.failure)
  return cash.comparison!.sufficient
    ? finish('unclear', 'sufficient_unapplied_cash', cash.comparison, promise.promised_date)
    : finish('missed', 'insufficient_payment_no_plausible_cash', cash.comparison, promise.promised_date)
}
