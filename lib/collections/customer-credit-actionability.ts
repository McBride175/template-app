import { compareDecimalValues, normalizeCurrencyCode, normalizeDecimalValue, sumDecimalValues } from '@/lib/money/currency'

export const CUSTOMER_CREDIT_CONTRACT_VERSION = 'customer_credit_v1'
export const INVOICE_EXACT_MONEY_CONTRACT_VERSION = 'invoice_exact_v1'

export interface CustomerCreditScope {
  syncRunId: string
  userId: string
  tenantId: string
  sourceSystem: 'xero'
  customerSourceId: string
}

export interface CustomerCreditCertificate {
  sync_run_id: string
  user_id: string
  tenant_id: string
  source_system: string
  contract_version: string
  invoice_money_contract_version: string
  readiness_state: 'ready' | 'unavailable'
  reason_code: string
  consistency_result: 'matched' | 'changed' | 'incomplete' | null
}

export interface CustomerCreditEvidenceRow {
  sync_run_id: string
  user_id: string
  tenant_id: string
  source_system: string
  source_kind: string
  source_id: string
  customer_source_id: string
  provider_type: string
  status: string
  residual_state: string
  remaining_credit_native: string | null
  currency_code: string
  organisation_base_currency_code: string | null
  xero_currency_rate: string | null
}

type SourceBreakdown = { overpayment: string; prepayment: string; credit_note: string }
export type CustomerCreditActionability = {
  state: 'ready' | 'unavailable' | 'unsupported_currency'
  reason: string | null
  overdueInvoiceToChase: string
  availableCustomerCredit: string | null
  creditApplied: string
  customerOverdueToChase: string
  excessAvailableCredit: string | null
  sourceBreakdown: SourceBreakdown | null
}

const PROVIDER_TYPES: Record<keyof SourceBreakdown, string> = {
  overpayment: 'RECEIVE-OVERPAYMENT',
  prepayment: 'RECEIVE-PREPAYMENT',
  credit_note: 'ACCRECCREDIT',
}

function fallback(state: 'unavailable' | 'unsupported_currency', reason: string, overdue: string): CustomerCreditActionability {
  return { state, reason, overdueInvoiceToChase: overdue, availableCustomerCredit: null,
    creditApplied: '0', customerOverdueToChase: overdue, excessAvailableCredit: null, sourceBreakdown: null }
}

/** Exact customer-level accounting only; no I/O, invoice allocation, or scoring. */
export function deriveCustomerCreditActionability(params: {
  scope: CustomerCreditScope
  organisationBaseCurrency: string | null
  overdueInvoiceToChase: string
  positiveOverdueInvoiceCurrencies: readonly string[]
  certificate: CustomerCreditCertificate | null
  creditRows: readonly CustomerCreditEvidenceRow[]
}): CustomerCreditActionability {
  if (typeof params.overdueInvoiceToChase !== 'string') throw new Error('Overdue To chase must be exact decimal text')
  const overdue = normalizeDecimalValue(params.overdueInvoiceToChase)
  if (overdue === null || compareDecimalValues(overdue, '0') === -1) throw new Error('Invalid overdue invoice To chase')
  const { scope, certificate } = params
  if (!certificate) return fallback('unavailable', 'legacy_generation', overdue)
  if (certificate.sync_run_id !== scope.syncRunId || certificate.user_id !== scope.userId ||
    certificate.tenant_id !== scope.tenantId || certificate.source_system !== scope.sourceSystem ||
    certificate.contract_version !== CUSTOMER_CREDIT_CONTRACT_VERSION ||
    certificate.invoice_money_contract_version !== INVOICE_EXACT_MONEY_CONTRACT_VERSION) {
    return fallback('unavailable', 'certificate_scope_or_version_mismatch', overdue)
  }
  if (certificate.readiness_state !== 'ready') {
    return fallback('unavailable', certificate.reason_code || 'credit_evidence_unavailable', overdue)
  }
  if (certificate.reason_code !== 'stable_observation' || certificate.consistency_result !== 'matched') {
    return fallback('unavailable', 'certificate_state_invalid', overdue)
  }

  const base = normalizeCurrencyCode(params.organisationBaseCurrency)
  if (!base || (compareDecimalValues(overdue, '0') === 1 && params.positiveOverdueInvoiceCurrencies.length === 0) ||
    params.positiveOverdueInvoiceCurrencies.some(code => normalizeCurrencyCode(code) !== base)) {
    return fallback('unsupported_currency', 'overdue_currency_unavailable', overdue)
  }

  const amounts: Record<keyof SourceBreakdown, string[]> = { overpayment: [], prepayment: [], credit_note: [] }
  const seen = new Set<string>()
  for (const row of params.creditRows) {
    if (row.sync_run_id !== scope.syncRunId || row.user_id !== scope.userId || row.tenant_id !== scope.tenantId ||
      row.source_system !== scope.sourceSystem || row.customer_source_id !== scope.customerSourceId ||
      !row.source_id || !Object.hasOwn(PROVIDER_TYPES, row.source_kind) ||
      row.provider_type !== PROVIDER_TYPES[row.source_kind as keyof SourceBreakdown]) {
      return fallback('unavailable', 'invalid_credit_evidence', overdue)
    }
    const key = `${row.source_kind}:${row.source_id}`
    if (seen.has(key)) return fallback('unavailable', 'duplicate_credit_evidence', overdue)
    seen.add(key)
    const kind = row.source_kind as keyof SourceBreakdown
    const amount = row.remaining_credit_native === null ? null :
      typeof row.remaining_credit_native === 'string' ? normalizeDecimalValue(row.remaining_credit_native) : null
    if ((amount !== null && compareDecimalValues(amount, '0') === -1) ||
      (row.remaining_credit_native !== null && amount === null) ||
      normalizeCurrencyCode(row.currency_code) === null) {
      return fallback('unavailable', 'invalid_credit_evidence', overdue)
    }
    const isLivePositive = row.status === 'AUTHORISED' && amount !== null && compareDecimalValues(amount, '0') === 1
    const isLiveZero = (row.status === 'AUTHORISED' || row.status === 'PAID') && amount === '0'
    const isExcluded = ['DRAFT', 'SUBMITTED', 'VOIDED', 'DELETED'].includes(row.status)
    if (!(isLivePositive && row.residual_state === 'qualifying') &&
      !(isLiveZero && row.residual_state === 'zero') &&
      !(isExcluded && row.residual_state === 'excluded')) {
      return fallback('unavailable', 'invalid_credit_state', overdue)
    }
    if (normalizeCurrencyCode(row.organisation_base_currency_code) !== base) {
      return fallback('unsupported_currency', 'credit_currency_context_mismatch', overdue)
    }
    if (normalizeCurrencyCode(row.currency_code) === base && row.xero_currency_rate !== null &&
      normalizeDecimalValue(row.xero_currency_rate) !== '1') {
      return fallback('unsupported_currency', 'credit_currency_context_mismatch', overdue)
    }
    if (isLivePositive) {
      if (normalizeCurrencyCode(row.currency_code) !== base) {
        return fallback('unsupported_currency', 'foreign_customer_credit', overdue)
      }
      amounts[kind].push(amount)
    }
  }
  const sourceBreakdown: SourceBreakdown = {
    overpayment: sumDecimalValues(amounts.overpayment) ?? '0',
    prepayment: sumDecimalValues(amounts.prepayment) ?? '0',
    credit_note: sumDecimalValues(amounts.credit_note) ?? '0',
  }
  const available = sumDecimalValues(Object.values(sourceBreakdown)) ?? '0'
  const applied = compareDecimalValues(available, overdue) === 1 ? overdue : available
  const net = sumDecimalValues([overdue, `-${applied}`])!
  const excess = sumDecimalValues([available, `-${applied}`])!
  return { state: 'ready', reason: null, overdueInvoiceToChase: overdue, availableCustomerCredit: available,
    creditApplied: applied, customerOverdueToChase: net, excessAvailableCredit: excess, sourceBreakdown }
}
