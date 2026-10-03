import { calculatePortfolioBenchmarks, calculatePortfolioBaseScores, type PortfolioBenchmarks } from '@/lib/collections/portfolio-benchmarks'
import type { CustomerFinancialFeatures, CustomerFinancialFeaturesResult } from '@/lib/collections/customer-features'
import { PRIORITIZATION_CONFIG, type BaseCustomerScore } from '@/lib/collections/prioritization'

export const PORTFOLIO_CALCULATION_VERSION = 'portfolio_base_v1'
export const COLLECTION_SCORING_MODEL_VERSION = 'collection_scoring_50_25_15_10_v1'
export type PortfolioScoringScope = 'collections'

// Only fields consumed by the existing queue projection, in addition to the
// scorer's input. No history observations, invoice/payment arrays or prose.
const PROJECTION_FIELDS = [
  'customer_to_chase_overdue_base_decimal','customer_credit_applied_base','invoice_to_chase_overdue_base_decimal',
  'collectible_outstanding_base_decimal','gross_outstanding_base_decimal','gross_overdue_base_decimal',
  'effective_disputed_outstanding_base_decimal','effective_disputed_overdue_base_decimal',
  'active_promised_outstanding_base_decimal','active_promised_overdue_base_decimal',
  'to_chase_outstanding_base_decimal','to_chase_overdue_base_decimal','to_chase_outstanding_base','to_chase_overdue_base',
  'total_outstanding_base','overdue_outstanding_base','total_outstanding_base_decimal','overdue_outstanding_base_decimal',
  'open_invoices_count','overdue_invoices_count','actionable_open_invoices_count','actionable_overdue_invoices_count',
  'native_currency_breakdown','collectible_native_currency_breakdown','customer_credit_state',
  'available_customer_credit_base_decimal','customer_credit_applied_base_decimal',
] as const satisfies readonly (keyof CustomerFinancialFeatures)[]
export interface CompactPortfolioCustomer {
  customerId: string
  order: number
  membership: { invoiceScope: boolean; ageing: boolean; scoring: boolean; analysed: boolean }
  projection: Pick<CustomerFinancialFeatures, typeof PROJECTION_FIELDS[number]>
  score: null | {
    input: BaseCustomerScore['row']; components: BaseCustomerScore['componentScores']; weighted: number
    validity: BaseCustomerScore['validity']; explanation: Pick<BaseCustomerScore['explanationInputs'], 'exposureSharePercent' | 'exposureRelativeToLargestPercent' | 'urgencyBaseScore' | 'invoiceCountBonus' | 'rawScore'>
  }
}
export type StoredPortfolioBenchmarks = Omit<PortfolioBenchmarks,
  'invoiceScopeRows' | 'scopeRows' | 'ageingRows' | 'filteredRows' | 'analysedOverdueRows'>
export interface PortfolioFinancialCalculation {
  benchmarks: StoredPortfolioBenchmarks | null
  population: { features: number; invoiceScope: number; ageing: number; scoring: number; analysed: number }
  metadata: Pick<CustomerFinancialFeaturesResult, 'organisationBaseCurrency' | 'organisationTimezone' | 'currencyHealth' | 'currencyContext' | 'sourceCounts'> & { reviewRequiredCustomerCount: number }
  rows: CompactPortfolioCustomer[]
}
/** The production currency-unavailable guard precedes benchmark construction. */
export function calculateReusablePortfolio(features: CustomerFinancialFeaturesResult, overdueOnly: boolean,
  timing?: { benchmarkMs: number; baseScoreMs: number }): PortfolioFinancialCalculation {
  const { organisationBaseCurrency, organisationTimezone, currencyHealth, currencyContext, sourceCounts } = features
  const metadata = { organisationBaseCurrency, organisationTimezone, currencyHealth, currencyContext, sourceCounts,
    reviewRequiredCustomerCount: features.reviewRequiredCustomers.length }
  if (!organisationBaseCurrency || currencyHealth.status === 'unavailable') {
    return { benchmarks: null, population: { features: features.rows.length, invoiceScope: 0, ageing: 0, scoring: 0, analysed: 0 }, metadata, rows: [] }
  }
  let started = performance.now()
  const b = calculatePortfolioBenchmarks({ rows: features.rows, overdueOnly })
  if (timing) timing.benchmarkMs += performance.now() - started
  started = performance.now()
  const bases = calculatePortfolioBaseScores(b, organisationBaseCurrency)
  if (timing) timing.baseScoreMs += performance.now() - started
  const scores = new Map(bases.map(({ features, base }) => [features.customer_source_id, base]))
  const ids = (rows: readonly CustomerFinancialFeatures[]) => new Set(rows.map(row => row.customer_source_id))
  const { invoiceScopeRows, scopeRows, ageingRows, filteredRows, analysedOverdueRows, ...benchmarks } = b
  const invoice = ids(invoiceScopeRows), ageing = ids(ageingRows), scoring = ids(filteredRows), analysed = ids(analysedOverdueRows)
  return { benchmarks, population: { features: features.rows.length, invoiceScope: invoiceScopeRows.length, ageing: ageingRows.length,
    scoring: scopeRows.length, analysed: analysedOverdueRows.length }, metadata,
    rows: features.rows.map((features, order) => {
      const base = scores.get(features.customer_source_id)
      const explanation = base ? { exposureSharePercent: base.explanationInputs.exposureSharePercent, exposureRelativeToLargestPercent: base.explanationInputs.exposureRelativeToLargestPercent, urgencyBaseScore: base.explanationInputs.urgencyBaseScore, invoiceCountBonus: base.explanationInputs.invoiceCountBonus, rawScore: base.explanationInputs.rawScore } : null
      return { customerId: features.customer_source_id, order,
        membership: { invoiceScope: invoice.has(features.customer_source_id), ageing: ageing.has(features.customer_source_id), scoring: scoring.has(features.customer_source_id), analysed: analysed.has(features.customer_source_id) },
        projection: Object.fromEntries(PROJECTION_FIELDS.map(key => [key, features[key]])) as CompactPortfolioCustomer['projection'],
        score: base ? { input: base.row, components: base.componentScores, weighted: base.baseScore, validity: base.validity, explanation: explanation! } : null }
    }),
  }
}
/** Rehydrate structured evidence only. No benchmark or base-score calculation. */
export function restorePortfolioBaseScore(row: CompactPortfolioCustomer, benchmarks: StoredPortfolioBenchmarks): BaseCustomerScore | null {
  if (!row.score) return null
  const { input, components, weighted, validity, explanation } = row.score
  const weights = PRIORITIZATION_CONFIG.weights
  const invoiceAgeApplicable = input.invoice_overdue_to_chase_base > 0
  return { row: input, context: benchmarks.context, componentScores: components, baseScore: weighted, validity,
    explanationInputs: { ...explanation,
      exposureScore: components.exposureScore, customerOverdueOutstanding: Math.max(0,input.customer_overdue_to_chase_base),
      normalizedTotalOverdue: Math.max(0,benchmarks.context.totalOverdueOutstandingBase), normalizedMaxOverdue: Math.max(0,benchmarks.context.maxOverdueOutstandingBase),
      urgencyWeightedAvgDays: invoiceAgeApplicable ? Math.max(0,input.weighted_avg_overdue_days) : 0,
      portfolioAvgWeightedDays: invoiceAgeApplicable ? Math.max(0,benchmarks.context.overallWeightedAvgOverdueDays) : 0,
      portfolioMaxWeightedDays: invoiceAgeApplicable ? Math.max(0,benchmarks.context.maxWeightedAvgOverdueDays) : 0,
      urgencyScore: components.urgencyScore, behaviourBaseScore: components.paymentRecencyScore, behaviourScore: components.paymentRecencyScore,
      relativeLatenessScore: components.relativeDeteriorationScore,
      weightedExposure: weights.exposure * components.exposureScore, weightedUrgency: weights.urgency * components.urgencyScore,
      weightedRelativeDeterioration: weights.relativeDeterioration * components.relativeDeteriorationScore,
      weightedPaymentRecency: weights.behaviour * components.paymentRecencyScore, baseScore: weighted,
      behaviourDaysInput: input.last_payment_days_ago === null ? 'no payment history' : `${Math.max(0,input.last_payment_days_ago)} days ago`,
    } }

}
/** Dependency evidence; broad exact rescoring is intentionally simpler initially.
 * Totals can alter share explanations even if the exposure maximum is unchanged. */
export function comparePortfolioBenchmarkDependencies(previous: StoredPortfolioBenchmarks | null, next: StoredPortfolioBenchmarks | null) {
  if (!previous || !next) return { exposure: true, exposureShares: true, urgency: true, deterioration: true }
  return { exposure: previous.maxOverdueOutstandingBase !== next.maxOverdueOutstandingBase ||
      (previous.totalOverdueOutstandingBase > 0) !== (next.totalOverdueOutstandingBase > 0),
    exposureShares: previous.totalOverdueOutstandingBase !== next.totalOverdueOutstandingBase,
    urgency: previous.overallWeightedAvgOverdueDays !== next.overallWeightedAvgOverdueDays || previous.maxWeightedAvgOverdueDays !== next.maxWeightedAvgOverdueDays,
    deterioration: previous.relativeLatenessContext.mode !== next.relativeLatenessContext.mode ||
      previous.relativeLatenessContext.midpointAnchorDays !== next.relativeLatenessContext.midpointAnchorDays ||
      previous.relativeLatenessContext.highAnchorDays !== next.relativeLatenessContext.highAnchorDays }
}
