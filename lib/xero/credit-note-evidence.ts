import 'server-only'

import { compareDecimalValues, normalizeCurrencyCode, normalizeDecimalValue } from '@/lib/money/currency'
import { parseXeroDateTime } from '@/lib/xero/canonical-mapping'
import type { createSupabaseAdminClient } from '@/lib/supabase-admin'

type RecordValue = Record<string, unknown>
const object = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
function required(value: unknown, field: string) {
  const result = text(value)
  if (!result) throw new Error(`Invalid credit-note evidence: ${field}`)
  return result
}
function decimal(value: unknown, field: string) {
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value))) {
    throw new Error(`Inexact credit-note evidence: ${field}`)
  }
  const result = normalizeDecimalValue(value as string | number)
  if (result === null || compareDecimalValues(result, '0') === -1) throw new Error(`Invalid credit-note evidence: ${field}`)
  return result
}

export type CreditNoteResidualState = 'qualifying' | 'zero' | 'excluded' | 'invalid'
export interface CreditNoteObservation {
  resource: 'creditnotes'
  started_at: string
  completed_at: string | null
  page_requests: number
  populated_pages: number
  source_count: number
  complete: boolean
}

/** A residual is always the provider's RemainingCredit, never reconstructed from children. */
export function mapXeroCreditNoteEvidence(records: RecordValue[], contacts: RecordValue[], organisation: RecordValue) {
  const customerIds = new Set(contacts.map(contact => text(contact.ContactID)))
  const baseCurrency = normalizeCurrencyCode(organisation.BaseCurrency)
  if (!baseCurrency) throw new Error('Credit-note organisation currency unavailable')
  const seen = new Set<string>()
  return records.flatMap(record => {
    const sourceId = required(record.CreditNoteID, 'CreditNoteID')
    if (seen.has(sourceId)) throw new Error('Duplicate credit-note identity')
    seen.add(sourceId)
    const type = required(record.Type, 'Type').toUpperCase()
    if (type === 'ACCPAYCREDIT') return []
    if (type !== 'ACCRECCREDIT') throw new Error('Unknown credit-note type')
    const customerId = required(object(record.Contact).ContactID, 'ContactID')
    if (!customerIds.has(customerId)) throw new Error('Credit-note customer context unavailable')
    const status = required(record.Status, 'Status').toUpperCase()
    if (status.length > 32) throw new Error('Invalid credit-note status')
    const currencyCode = normalizeCurrencyCode(record.CurrencyCode)
    if (!currencyCode) throw new Error('Credit-note currency unavailable')
    const hasResidual = record.RemainingCredit !== null && record.RemainingCredit !== undefined
    const remaining = hasResidual ? decimal(record.RemainingCredit, 'RemainingCredit') : null
    const suppliedRate = record.CurrencyRate === null || record.CurrencyRate === undefined
      ? null : decimal(record.CurrencyRate, 'CurrencyRate')
    const invalidRate = suppliedRate !== null && compareDecimalValues(suppliedRate, '0') !== 1
    const rate = invalidRate ? null : suppliedRate
    const live = status === 'AUTHORISED' || status === 'PAID'
    const residualState: CreditNoteResidualState = invalidRate || (live && remaining === null)
      ? 'invalid'
      : status === 'AUTHORISED'
        ? compareDecimalValues(remaining!, '0') === 1 ? 'qualifying' : 'zero'
        : status === 'PAID'
          ? compareDecimalValues(remaining!, '0') === 0 ? 'zero' : 'invalid'
          : ['DRAFT', 'SUBMITTED', 'VOIDED', 'DELETED'].includes(status) ? 'excluded' : 'invalid'
    const providerUpdatedAt = record.UpdatedDateUTC ?? record.UpdatedDateUTCString
    const sourceUpdatedAt = providerUpdatedAt === null || providerUpdatedAt === undefined
      ? null : parseXeroDateTime(providerUpdatedAt)
    if (providerUpdatedAt !== null && providerUpdatedAt !== undefined &&
      (!sourceUpdatedAt || !Number.isFinite(Date.parse(sourceUpdatedAt)))) {
      throw new Error('Invalid credit-note provider update time')
    }
    return [{ source_id: sourceId, customer_source_id: customerId, provider_type: type, status,
      residual_state: residualState, remaining_credit_native: remaining, currency_code: currencyCode,
      organisation_base_currency_code: baseCurrency, xero_currency_rate: rate,
      source_updated_at: sourceUpdatedAt }]
  })
}

export async function persistXeroCreditNoteEvidence(params: {
  syncRunId: string; userId: string; tenantId: string; leaseOwner: string; fencingToken: number
  observation: CreditNoteObservation; rows: RecordValue[]
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>
}) {
  const batches = Math.max(1, Math.ceil(params.rows.length / 500))
  for (let index = 0; index < batches; index += 1) {
    const { error } = await params.supabaseAdmin.rpc('persist_xero_credit_note_evidence', {
      p_sync_run_id: params.syncRunId, p_user_id: params.userId, p_tenant_id: params.tenantId,
      p_lease_owner: params.leaseOwner, p_fencing_token: params.fencingToken,
      p_observation: { ...params.observation, complete: params.observation.complete && index === batches - 1 },
      p_rows: params.rows.slice(index * 500, (index + 1) * 500),
    })
    if (error) throw new Error('Credit-note evidence persistence failed')
  }
}
