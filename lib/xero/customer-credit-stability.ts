import 'server-only'

import { createHash } from 'node:crypto'
import { compareDecimalValues, normalizeCurrencyCode, normalizeDecimalValue } from '@/lib/money/currency'
import { parseXeroDate, parseXeroDateTime } from '@/lib/xero/canonical-mapping'

type RecordValue = Record<string, unknown>
const object = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null

export class CustomerCreditStabilityError extends Error {
  constructor(readonly reason: 'missing_version_evidence' | 'invalid_invoice_state' | 'invalid_credit_state') {
    super(reason)
    this.name = 'CustomerCreditStabilityError'
  }
}

function exact(value: unknown, reason: CustomerCreditStabilityError['reason'], nullable = false) {
  if (nullable && (value === undefined || value === null)) return null
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value))) {
    throw new CustomerCreditStabilityError(reason)
  }
  const result = normalizeDecimalValue(value as string | number)
  if (result === null || compareDecimalValues(result, '0') === -1) throw new CustomerCreditStabilityError(reason)
  return result
}

function digest(rows: readonly unknown[][]) {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
}

/** Signatures compare the current authorised AR set, including membership. */
export function signatureForAuthorisedInvoices(records: readonly RecordValue[]) {
  const tuples: unknown[][] = []
  const seen = new Set<string>()
  for (const invoice of records) {
    const id = text(invoice.InvoiceID)
    const customer = text(object(invoice.Contact).ContactID)
    const dueDate = parseXeroDate(invoice.DueDateString ?? invoice.DueDate)
    const currency = normalizeCurrencyCode(invoice.CurrencyCode)
    const updateRaw = invoice.UpdatedDateUTC ?? invoice.UpdatedDateUTCString
    const updatedAt = parseXeroDateTime(updateRaw)
    if (!updatedAt) throw new CustomerCreditStabilityError('missing_version_evidence')
    const amountDue = exact(invoice.AmountDue, 'invalid_invoice_state')
    const rate = exact(invoice.CurrencyRate, 'invalid_invoice_state', true)
    if (!id || !customer || !dueDate || !currency || invoice.Type !== 'ACCREC' || invoice.Status !== 'AUTHORISED' ||
      seen.has(id)) throw new CustomerCreditStabilityError('invalid_invoice_state')
    seen.add(id)
    tuples.push([id, customer, 'ACCREC', 'AUTHORISED', dueDate, currency, amountDue, rate, updatedAt])
  }
  tuples.sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  return { count: tuples.length, signature: digest(tuples) }
}

const TYPES: Record<string, string> = { overpayment: 'RECEIVE-OVERPAYMENT', prepayment: 'RECEIVE-PREPAYMENT', credit_note: 'ACCRECCREDIT' }

/** Canonical rows from the same mappers used for persisted residual evidence. */
export function signatureForCreditRows(kind: 'overpayment' | 'prepayment' | 'credit_note', records: readonly RecordValue[]) {
  const tuples: unknown[][] = []
  const seen = new Set<string>()
  for (const row of records) {
    const id = text(row.source_id)
    const customer = text(row.customer_source_id)
    const currency = normalizeCurrencyCode(row.currency_code)
    const base = normalizeCurrencyCode(row.organisation_base_currency_code)
    const status = text(row.status)
    const type = text(row.provider_type)
    const remaining = exact(row.remaining_credit_native, 'invalid_credit_state', kind === 'credit_note')
    const rate = exact(row.xero_currency_rate, 'invalid_credit_state', true)
    const updatedAt = row.source_updated_at === null || row.source_updated_at === undefined
      ? null : parseXeroDateTime(row.source_updated_at)
    if (!id || !customer || !currency || !base || !status || type !== TYPES[kind] ||
      (row.source_kind !== undefined && row.source_kind !== kind) || seen.has(id) ||
      (row.source_updated_at !== null && row.source_updated_at !== undefined && !updatedAt)) {
      throw new CustomerCreditStabilityError('invalid_credit_state')
    }
    const live = status === 'AUTHORISED' || status === 'PAID'
    if ((live && (remaining === null || !updatedAt)) ||
      (status === 'PAID' && remaining !== '0') ||
      (kind === 'credit_note' && row.residual_state === 'invalid') ||
      !['AUTHORISED', 'PAID', 'VOIDED', 'DELETED', ...(kind === 'credit_note' ? ['DRAFT', 'SUBMITTED'] : [])].includes(status)) {
      throw new CustomerCreditStabilityError(live && !updatedAt ? 'missing_version_evidence' : 'invalid_credit_state')
    }
    seen.add(id)
    tuples.push([kind, id, customer, type, status, remaining, currency, base, rate, updatedAt])
  }
  tuples.sort((a, b) => String(a[1]).localeCompare(String(b[1])))
  return { count: tuples.length, signature: digest(tuples) }
}

export interface CreditStabilityObservation {
  count: number
  signature: string
  started_at: string
  completed_at: string
  page_requests: number
  populated_pages: number
  complete: true
}

export function completeCreditStabilityObservation(params: {
  count: number; signature: string; started_at: string; completed_at: string | null
  page_requests: number; populated_pages: number; complete: boolean
}): CreditStabilityObservation | null {
  if (!params.complete || !params.completed_at || params.page_requests <= params.populated_pages ||
    params.page_requests < 1 || !/^[0-9a-f]{64}$/.test(params.signature) ||
    !Number.isSafeInteger(params.count) || params.count < 0 ||
    !Number.isFinite(Date.parse(params.started_at)) || !Number.isFinite(Date.parse(params.completed_at)) ||
    Date.parse(params.completed_at) < Date.parse(params.started_at)) return null
  return { ...params, completed_at: params.completed_at, complete: true }
}
