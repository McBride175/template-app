import { compareDecimalValues, normalizeDecimalValue } from '@/lib/money/currency'
import type { InvoicePromiseRecord } from '@/lib/collections/invoice-promises'
import type { EvidenceObservation } from '@/lib/xero/accounting-evidence'

export const PROMISE_ACCOUNTING_CONTRACT = 'promise_accounting_evidence_v1'

export interface PromisePaymentBaseline {
  version: 1
  payment_ids: readonly string[]
  observation_started_at: string
  observation_completed_at: string
}

export interface PromiseLifecycleRecord extends Omit<InvoicePromiseRecord, 'promised_amount_native' | 'qualifying_paid_amount_native'> {
  promised_amount_native: string
  qualifying_paid_amount_native: string
  revision: number
  created_at: string
  promised_date: string
  creation_sync_run_id: string
  payment_baseline: PromisePaymentBaseline
}

export interface PromiseEvidenceScope {
  sync_run_id: string
  user_id: string
  tenant_id: string
  source_system: string
}

/** Exact held generation + SQL readiness inspection, supplied by a later server layer. */
export interface PromiseAccountingObservation extends PromiseEvidenceScope {
  contract_version: string
  status: 'succeeded' | 'failed' | 'candidate'
  authoritative: boolean
  ready: boolean
  timezone_iana: string | null
  organisation_base_currency_code: string | null
  resources: readonly (EvidenceObservation & { mapped_count: number })[]
}

export interface PromisePaymentEvidence extends PromiseEvidenceScope {
  source_id: string
  invoice_source_id: string | null
  customer_source_id: string | null
  amount_native: string
  currency_code: string | null
  payment_date: string
  payment_type: string
  payment_status: string
  source_updated_at: string | null
}

export interface PromiseCashEvidence extends PromiseEvidenceScope {
  source_kind: 'overpayment' | 'prepayment'
  source_id: string
  customer_source_id: string
  provider_type: string
  remaining_credit_native: string
  currency_code: string
  accounting_date: string
  status: string
  source_updated_at: string | null
  organisation_base_currency_code: string | null
  xero_currency_rate: string | null
  remaining_credit_base: string | null
  currency_conversion_status: 'identity' | 'converted' | 'incomplete'
  currency_conversion_failure_reason: string | null
}

export function validPromiseDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

export function promiseInstant(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      !validPromiseDate(value.slice(0, 10))) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

export function exactPromiseAmount(value: unknown, positive = false): string | null {
  if (typeof value !== 'string') return null
  const amount = normalizeDecimalValue(value)
  return amount !== null && compareDecimalValues(amount, '0')! >= (positive ? 1 : 0) ? amount : null
}

export function samePromiseScope(left: PromiseEvidenceScope, right: PromiseEvidenceScope) {
  return left.sync_run_id === right.sync_run_id && left.user_id === right.user_id &&
    left.tenant_id === right.tenant_id && left.source_system === right.source_system
}

export function observationMatchesPromise(observation: PromiseAccountingObservation, promise: PromiseLifecycleRecord) {
  return [observation.sync_run_id, promise.id, promise.user_id, promise.tenant_id,
    promise.invoice_source_id, promise.customer_source_id, promise.creation_sync_run_id].every(value => typeof value === 'string' && value.trim() !== '') &&
    observation.user_id === promise.user_id && observation.tenant_id === promise.tenant_id &&
    observation.source_system === promise.source_system && promise.source_system === 'xero'
}

export function completePromiseResource(observation: PromiseAccountingObservation, resource: EvidenceObservation['resource']) {
  const matches = observation.resources.filter(row => row.resource === resource)
  if (matches.length !== 1) return null
  const row = matches[0]
  const start = promiseInstant(row.started_at), end = promiseInstant(row.completed_at)
  if (!row.complete || start === null || end === null || end < start ||
      ![row.source_count, row.mapped_count, row.page_requests, row.populated_pages].every(value => Number.isSafeInteger(value) && value >= 0) ||
      row.source_count !== row.mapped_count || row.page_requests <= row.populated_pages) return null
  return row
}

export interface PromiseTimeContext {
  timezone: string
  creationLocalDate: string
  deadlineBoundary: string
}

/** Organisation-local calendar boundary, using runtime IANA/DST data; no clock or fallback. */
export function derivePromiseTimeContext(createdAt: string, promisedDate: string, timezone: string | null): PromiseTimeContext | null {
  const created = promiseInstant(createdAt)
  if (created === null || !validPromiseDate(promisedDate) || !timezone) return null
  try {
    const formatter = new Intl.DateTimeFormat('en', {
      timeZone: timezone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit',
    })
    const localDate = (time: number) => {
      const parts = formatter.formatToParts(new Date(time))
      const part = (name: string) => parts.find(value => value.type === name)?.value
      return `${part('year')!.padStart(4, '0')}-${part('month')}-${part('day')}`
    }
    const creationLocalDate = localDate(created)
    if (creationLocalDate > promisedDate) return null
    const nextDayUtc = Date.parse(`${promisedDate}T00:00:00Z`) + 86_400_000
    const nextDate = new Date(nextDayUtc).toISOString().slice(0, 10)
    // Bounded search for the end of the whole promised day, including DST changes.
    let low = nextDayUtc - 36 * 3_600_000, high = nextDayUtc + 36 * 3_600_000
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2)
      if (localDate(middle) < nextDate) low = middle
      else high = middle
    }
    // Unsupported/skipped calendar days fail closed rather than inventing a boundary.
    if (localDate(high - 1) !== promisedDate || localDate(high) !== nextDate) return null
    return { timezone, creationLocalDate, deadlineBoundary: new Date(high).toISOString() }
  } catch { return null }
}
