import 'server-only'
import { compareDecimalValues, convertCurrencyAmounts, normalizeCurrencyCode, normalizeDecimalValue } from '@/lib/money/currency'
import { parseXeroDate, parseXeroDateTime } from '@/lib/xero/canonical-mapping'
import { normalizeXeroOrganisationTimezone } from '@/lib/xero/organisation-timezone'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export const XERO_ACCOUNTING_EVIDENCE_CONTRACT = 'promise_accounting_evidence_v1'
export type EvidenceResource = 'payments' | 'overpayments' | 'prepayments'
type RecordValue = Record<string, unknown>
export interface EvidenceObservation {
  resource: EvidenceResource
  started_at: string
  completed_at: string | null
  page_requests: number
  populated_pages: number
  source_count: number
  complete: boolean
}
const object = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
function required(value: unknown, field: string): string {
  const result = text(value)
  if (!result) throw new Error(`Invalid accounting evidence: ${field}`)
  return result
}
function date(value: unknown) {
  const parsed = parseXeroDate(value)
  if (!parsed || !/^\d{4}-\d{2}-\d{2}$/.test(parsed) || new Date(`${parsed}T00:00:00Z`).toISOString().slice(0, 10) !== parsed) {
    throw new Error('Invalid accounting evidence: accounting date')
  }
  return parsed
}
function amount(value: unknown) {
  // The HTTP path supplies exact strings. Safe integers remain accepted for fixtures;
  // binary fractional numbers cannot be certified after their original token was lost.
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value))) throw new Error('Inexact accounting evidence amount')
  const result = normalizeDecimalValue(value as string | number)
  if (result === null || compareDecimalValues(result, '0') === -1) throw new Error('Invalid accounting evidence amount')
  return result
}
function updated(value: unknown) {
  if (value === null || value === undefined) return null
  const result = parseXeroDateTime(value)
  if (!result || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result.slice(0, 10)) throw new Error('Invalid accounting evidence modification time')
  return result
}
function currency(value: unknown) {
  const result = normalizeCurrencyCode(value)
  if (!result) throw new Error('Invalid accounting evidence currency')
  return result
}
function unique(records: RecordValue[], key: string) {
  const seen = new Set<string>()
  for (const record of records) {
    const id = required(record[key], key)
    if (seen.has(id)) throw new Error('Duplicate accounting evidence identity')
    seen.add(id)
  }
}

/** No totals, allocation, eligibility against a promise, or lifecycle decisions. */
export function mapXeroPaymentEvidence(records: RecordValue[], invoices: RecordValue[]) {
  unique(records, 'PaymentID')
  const contexts = new Map(invoices.map(invoice => [text(invoice.InvoiceID), invoice]))
  return records.map(payment => {
    const invoiceRef = object(payment.Invoice)
    const invoiceId = text(invoiceRef.InvoiceID)
    const invoice = invoiceId ? contexts.get(invoiceId) : undefined
    const paymentType = required(payment.PaymentType, 'PaymentType').toUpperCase()
    const status = required(payment.Status, 'Status').toUpperCase()
    if (!['AUTHORISED', 'DELETED'].includes(status)) throw new Error('Invalid payment status')
    const supported = paymentType === 'ACCRECPAYMENT'
    let currencyCode: string | null = null
    let customerId: string | null = null
    if (supported) {
      if (!invoice || invoice.Type !== 'ACCREC') throw new Error('Payment invoice context unavailable')
      currencyCode = currency(invoice.CurrencyCode)
      customerId = required(object(invoice.Contact).ContactID, 'invoice ContactID')
      for (const candidate of [payment.CurrencyCode, invoiceRef.CurrencyCode]) {
        if (candidate !== undefined && candidate !== null && currency(candidate) !== currencyCode) throw new Error('Conflicting payment currency')
      }
      const embeddedContact = text(object(invoiceRef.Contact).ContactID)
      if (embeddedContact && embeddedContact !== customerId) throw new Error('Conflicting payment customer')
    }
    return {
      source_id: required(payment.PaymentID, 'PaymentID'), invoice_source_id: invoiceId,
      customer_source_id: customerId, amount_native: amount(payment.Amount), currency_code: currencyCode,
      payment_date: date(payment.Date), payment_type: paymentType, payment_status: status,
      source_updated_at: updated(payment.UpdatedDateUTC),
    }
  })
}

export function mapXeroUnappliedCashEvidence(resource: 'overpayments' | 'prepayments', records: RecordValue[], contacts: RecordValue[], organisation: RecordValue) {
  const sourceKind = resource === 'overpayments' ? 'overpayment' : 'prepayment'
  const idKey = resource === 'overpayments' ? 'OverpaymentID' : 'PrepaymentID'
  unique(records, idKey)
  const customers = new Set(contacts.map(contact => text(contact.ContactID)))
  return records.flatMap(record => {
    const type = required(record.Type, 'Type').toUpperCase()
    if (type === `SPEND-${sourceKind.toUpperCase()}`) return []
    if (type !== `RECEIVE-${sourceKind.toUpperCase()}`) throw new Error('Invalid cash resource type')
    const customerId = required(object(record.Contact).ContactID, 'ContactID')
    if (!customers.has(customerId)) throw new Error('Cash customer context unavailable')
    const status = required(record.Status, 'Status').toUpperCase()
    if (!['AUTHORISED', 'PAID', 'VOIDED', 'DELETED'].includes(status)) throw new Error('Invalid cash status')
    const remaining = amount(record.RemainingCredit)
    const nativeCurrency = currency(record.CurrencyCode)
    // Missing/invalid FX is retained as unavailable, never defaulted or valued at zero.
    const conversion = convertCurrencyAmounts({ transactionCurrency: nativeCurrency,
      organisationBaseCurrency: organisation.BaseCurrency,
      xeroCurrencyRate: typeof record.CurrencyRate === 'string' || Number.isSafeInteger(record.CurrencyRate) ? record.CurrencyRate as string | number : null,
      amounts: { remaining } })
    return [{ source_kind: sourceKind, source_id: required(record[idKey], idKey), customer_source_id: customerId,
      provider_type: type, remaining_credit_native: remaining, currency_code: nativeCurrency,
      accounting_date: date(record.DateString ?? record.Date), status, source_updated_at: updated(record.UpdatedDateUTC),
      organisation_base_currency_code: conversion.organisationBaseCurrencyCode,
      xero_currency_rate: conversion.xeroCurrencyRate, remaining_credit_base: conversion.amounts.remaining.base,
      currency_conversion_status: conversion.status, currency_conversion_failure_reason: conversion.failureReason }]
  })
}

export async function persistXeroAccountingEvidence(params: {
  syncRunId: string; userId: string; tenantId: string; leaseOwner: string; fencingToken: number
  observation: EvidenceObservation; rows: RecordValue[]; organisation: RecordValue
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>
}) {
  const batches = Math.max(1, Math.ceil(params.rows.length / 500))
  for (let index = 0; index < batches; index++) {
    const { error } = await params.supabaseAdmin.rpc('persist_xero_accounting_evidence', {
      p_sync_run_id: params.syncRunId, p_user_id: params.userId, p_tenant_id: params.tenantId,
      p_lease_owner: params.leaseOwner, p_fencing_token: params.fencingToken,
      p_observation: { ...params.observation, complete: params.observation.complete && index === batches - 1 },
      p_rows: params.rows.slice(index * 500, (index + 1) * 500),
      p_timezone_iana: normalizeXeroOrganisationTimezone(params.organisation.Timezone, params.organisation.CountryCode),
    })
    if (error) throw new Error('Accounting evidence persistence failed')
  }
}

export async function inspectXeroAccountingEvidence(params: {
  syncRunId: string; userId: string; tenantId: string
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>
}) {
  const { data, error } = await params.supabaseAdmin.rpc('inspect_xero_accounting_evidence', {
    p_sync_run_id: params.syncRunId, p_user_id: params.userId, p_tenant_id: params.tenantId,
  })
  const result = object(data)
  if (error || result.contract_version !== XERO_ACCOUNTING_EVIDENCE_CONTRACT || typeof result.ready !== 'boolean'
    || !Array.isArray(result.resources) || (result.ready && (result.resources.length !== 3 || !text(result.timezone_iana)))) {
    throw new Error('Accounting evidence inspection failed')
  }
  return data as { contract_version: string; ready: boolean; resources: EvidenceObservation[]; timezone_iana: string | null }
}
