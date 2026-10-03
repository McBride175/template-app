import {
  calculateCustomerFinancialFeatures,
  type CustomerFeatureInput,
  type CustomerFinancialFeaturesResult,
} from '@/lib/collections/customer-features'
import type { CustomerCreditCertificate, CustomerCreditEvidenceRow } from '@/lib/collections/customer-credit-actionability'

/** Increment on incompatible payload changes or financial calculation changes.
 * Not a commit SHA; old versions never validate under a new calculator. */
export const CUSTOMER_ACCOUNTING_BASIS_VERSION = 'customer_basis_v1'
export const CUSTOMER_FINANCIAL_FEATURE_VERSION = 'customer_features_v1'
export interface CustomerAccountingBasis {
  organisations: CustomerFeatureInput['organisations']
  customers: CustomerFeatureInput['customers']
  invoices: CustomerFeatureInput['invoices']
  payments: CustomerFeatureInput['payments']
  creditRows: CustomerCreditEvidenceRow[]
  creditCounts: Record<'overpayment' | 'prepayment' | 'credit_note', number>
  invoiceOrdinals: number[]
}
export interface MaterializedCustomerFeature {
  result: CustomerFinancialFeaturesResult
  /** Only invalid invoices require portfolio issue ordering metadata. */
  issueOrdinals: number[]
}
export type CertificateWithObservations = CustomerCreditCertificate & {
  resource_observations?: { initial?: Record<string, { count?: unknown }> }
}

/** Same completeness gate as the live loader. Unknown evidence is never zero. */
export function validatedCustomerCredit(basis: CustomerAccountingBasis, certificate: CertificateWithObservations | null) {
  if (!certificate || certificate.readiness_state !== 'ready' || certificate.reason_code !== 'stable_observation' ||
    certificate.consistency_result !== 'matched' || certificate.contract_version !== 'customer_credit_v1' ||
    certificate.invoice_money_contract_version !== 'invoice_exact_v1') {
    return { certificate, rows: [] as CustomerCreditEvidenceRow[] }
  }
  const resources = { overpayment: 'overpayments', prepayment: 'prepayments', credit_note: 'creditnotes' } as const
  for (const kind of Object.keys(resources) as (keyof typeof resources)[]) {
    const expected = certificate.resource_observations?.initial?.[resources[kind]]?.count
    if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 0 || expected !== basis.creditCounts[kind]) {
      return { certificate: null, rows: [] as CustomerCreditEvidenceRow[] }
    }
  }
  return { certificate, rows: basis.creditRows }
}

export function calculateMaterializedCustomerFeature(params: {
  basis: CustomerAccountingBasis
  userId: string
  tenantId: string
  generationId: string
  evaluationDate: string
  certificate: CertificateWithObservations | null
  disputes: CustomerFeatureInput['disputes']
  promises: CustomerFeatureInput['promises']
}): MaterializedCustomerFeature {
  const { basis } = params
  const result = calculateCustomerFinancialFeatures({
    evaluationDate: params.evaluationDate, userId: params.userId, tenantId: params.tenantId,
    snapshot: { syncRunId: params.generationId }, organisations: basis.organisations, customers: basis.customers,
    invoices: basis.invoices, payments: basis.payments, disputes: params.disputes, promises: params.promises,
    customerCredit: validatedCustomerCredit(basis, params.certificate),
  })
  const ordinals = new Map(basis.invoices.map((invoice, index) => [invoice.source_id, basis.invoiceOrdinals[index]]))
  return { result, issueOrdinals: result.currencyEvaluation.currencyIssues.map(issue => ordinals.get(issue.invoiceSourceId)!) }
}

/** Projection metadata merges already-calculated customers, never financial formulas.
 * Explicit source ordinals preserve the live loader's insertion order/tie behaviour. */
export function mergeMaterializedCustomerFeatures(items: readonly { order: number; feature: MaterializedCustomerFeature }[]): CustomerFinancialFeaturesResult {
  if (!items.length) throw new Error('Complete materialized population required')
  const ordered = [...items].sort((a, b) => a.order - b.order)
  const first = ordered[0].feature.result
  const issues = items.flatMap(({ feature }) => feature.result.currencyEvaluation.currencyIssues.map((issue, i) =>
    ({ issue, order: feature.issueOrdinals[i] }))).sort((a, b) => a.order - b.order).map(item => item.issue)
  const affectedIds = [...new Set(issues.map(issue => issue.customerSourceId).filter(Boolean))].sort()
  const unavailable = first.currencyHealth.status === 'unavailable'
  const failureReasons: CustomerFinancialFeaturesResult['currencyHealth']['failureReasons'] = {}
  for (const issue of issues) failureReasons[issue.failureReason] = (failureReasons[issue.failureReason] ?? 0) + 1
  if (unavailable && !issues.length) Object.assign(failureReasons, first.currencyHealth.failureReasons)
  const currencyHealth: CustomerFinancialFeaturesResult['currencyHealth'] = {
    status: unavailable ? 'unavailable' : issues.length ? 'degraded' : 'healthy',
    rankingStatus: unavailable ? 'unavailable' : issues.length ? 'provisional' : 'complete',
    affectedInvoiceCount: issues.length, affectedCustomerCount: affectedIds.length, failureReasons,
  }
  const currencies = [...new Set(items.flatMap(item => item.feature.result.currencyContext.invoicedCurrencies))].sort()
  return {
    rows: ordered.flatMap(item => item.feature.result.rows),
    reviewRequiredCustomers: items.flatMap(item => item.feature.result.reviewRequiredCustomers)
      .sort((a, b) => a.customer_source_id < b.customer_source_id ? -1 : a.customer_source_id > b.customer_source_id ? 1 : 0),
    organisationBaseCurrency: first.organisationBaseCurrency, organisationTimezone: first.organisationTimezone,
    currencyHealth,
    currencyEvaluation: { organisationBaseCurrency: first.organisationBaseCurrency, currencyHealth,
      affectedCustomerSourceIds: affectedIds, currencyIssues: issues },
    currencyContext: { mode: currencies.length > 1 ? 'multi_currency' : 'single_currency', invoicedCurrencies: currencies,
      relevantInvoiceCount: items.reduce((sum, item) => sum + item.feature.result.currencyContext.relevantInvoiceCount, 0) },
    sourceCounts: { customers: items.reduce((n, item) => n + item.feature.result.sourceCounts.customers, 0),
      invoices: items.reduce((n, item) => n + item.feature.result.sourceCounts.invoices, 0),
      payments: items.reduce((n, item) => n + item.feature.result.sourceCounts.payments, 0) },
  }
}
