import type { CustomerFinancialFeatures } from '@/lib/collections/customer-features'
import { buildRelativeLatenessContext } from '@/lib/collections/relative-lateness'
import { compareDecimalValues, decimalValueToFiniteNumber, sumDecimalValues } from '@/lib/money/currency'
import { calculateBaseCustomerScore } from '@/lib/collections/prioritization'

/** Scope controls population; a display limit and operational overlays never do. */
export interface PortfolioBenchmarkInput {
  rows: readonly CustomerFinancialFeatures[]
  overdueOnly: boolean
}

export function calculatePortfolioBenchmarks({ rows: summaryRows, overdueOnly }: PortfolioBenchmarkInput) {
  const invoiceEligibleRows = summaryRows.filter((row) =>
    !((row.has_active_dispute || row.has_active_promise) && row.collectible_outstanding_base <= 0)
  )
  const hasInvoiceOverdue = (row: CustomerFinancialFeatures) =>
    compareDecimalValues(row.invoice_to_chase_overdue_base_decimal, '0') === 1
  // Preserve the invoice-derived ageing/reference population before the
  // customer-level accounting-zero gate removes covered monetary actions.
  const invoiceScopeRows = overdueOnly
    ? invoiceEligibleRows.filter(hasInvoiceOverdue)
    : invoiceEligibleRows
  const hasMonetaryOverdue = (row: CustomerFinancialFeatures) =>
    compareDecimalValues(row.customer_to_chase_overdue_base_decimal, '0') === 1
  const monetaryQueueRows = invoiceEligibleRows.filter((row) =>
    !hasInvoiceOverdue(row) || hasMonetaryOverdue(row)
  )
  const scopeRows = overdueOnly
    ? monetaryQueueRows.filter(hasMonetaryOverdue)
    : monetaryQueueRows

  // These benchmark populations depend only on accounting and authoritative
  // Promise/Dispute/credit state. Neither V1 nor legacy contact history enters.
  const ageingRows = invoiceScopeRows.filter(hasInvoiceOverdue)
  const filteredRows = scopeRows

  const analysedOverdueRows = scopeRows.filter(hasMonetaryOverdue)
  const relativeLatenessContext = buildRelativeLatenessContext(
    ageingRows.map((row) => ({
      overdueOutstandingBase: row.invoice_to_chase_overdue_base,
      relativeLatenessDays: row.relative_lateness_days,
    }))
  )
  const totalOverdueOutstandingBaseDecimal = sumDecimalValues(
    filteredRows.map((row) => row.customer_to_chase_overdue_base_decimal)
  )
  const analysedOverdueBaseDecimal = sumDecimalValues(
    analysedOverdueRows.map((row) => row.customer_to_chase_overdue_base_decimal)
  )
  const maxOverdueOutstandingBaseDecimal = filteredRows.reduce((max, row) => {
    return compareDecimalValues(row.customer_to_chase_overdue_base_decimal, max) === 1
      ? row.customer_to_chase_overdue_base_decimal
      : max
  }, '0')
  const ageingOverdueBaseDecimal = sumDecimalValues(
    ageingRows.map((row) => row.invoice_to_chase_overdue_base_decimal)
  )
  const totalOverdueOutstandingBase = decimalValueToFiniteNumber(
    totalOverdueOutstandingBaseDecimal
  )
  const analysedOverdueBase = decimalValueToFiniteNumber(analysedOverdueBaseDecimal)
  const maxOverdueOutstandingBase = decimalValueToFiniteNumber(
    maxOverdueOutstandingBaseDecimal
  )
  const ageingOverdueBase = decimalValueToFiniteNumber(ageingOverdueBaseDecimal)
  if (
    totalOverdueOutstandingBase === null ||
    analysedOverdueBase === null ||
    maxOverdueOutstandingBase === null ||
    ageingOverdueBase === null
  ) {
    throw new Error('Base-currency portfolio totals exceeded the supported calculation range')
  }
  const overallWeightedAvgOverdueDays =
    ageingOverdueBase > 0
      ? ageingRows.reduce(
          (sum, row) =>
            sum +
            Math.max(0, row.weighted_avg_overdue_days) *
              Math.max(0, row.invoice_to_chase_overdue_base),
          0
        ) / ageingOverdueBase
      : 0
  const maxWeightedAvgOverdueDays = ageingRows.reduce(
    (max, row) => Math.max(max, Math.max(0, row.weighted_avg_overdue_days)),
    0
  )

  return {
    overdueOnly,
    invoiceScopeRows,
    scopeRows,
    ageingRows,
    filteredRows,
    analysedOverdueRows,
    relativeLatenessContext,
    totalOverdueOutstandingBaseDecimal,
    analysedOverdueBaseDecimal,
    maxOverdueOutstandingBaseDecimal,
    ageingOverdueBaseDecimal,
    totalOverdueOutstandingBase,
    analysedOverdueBase,
    maxOverdueOutstandingBase,
    ageingOverdueBase,
    overallWeightedAvgOverdueDays,
    maxWeightedAvgOverdueDays,
    context: {
      totalOverdueOutstandingBase, maxOverdueOutstandingBase,
      overallWeightedAvgOverdueDays, maxWeightedAvgOverdueDays,
      relativeLateness: relativeLatenessContext,
    },
  }
}

export type PortfolioBenchmarks = ReturnType<typeof calculatePortfolioBenchmarks>

/** Feature extraction and benchmark application are independent operations. */
export function calculatePortfolioBaseScores(benchmarks: PortfolioBenchmarks, organisationBaseCurrency: string) {
  return benchmarks.filteredRows.map((row) => ({
    features: row,
    base: calculateBaseCustomerScore({
      customer_source_id: row.customer_source_id,
      customer_name: row.customer_name,
      customer_email: row.customer_email,
      customer_overdue_to_chase_base: row.customer_to_chase_overdue_base,
      has_actionable_overdue_balance: compareDecimalValues(row.customer_to_chase_overdue_base_decimal, '0') === 1,
      invoice_overdue_to_chase_base: row.invoice_to_chase_overdue_base,
      total_outstanding_base: row.collectible_outstanding_base,
      overdue_invoices_count: row.actionable_overdue_invoices_count,
      open_invoices_count: row.actionable_open_invoices_count,
      weighted_avg_overdue_days: row.weighted_avg_overdue_days,
      last_payment_date: row.last_payment_date,
      last_payment_days_ago: row.last_payment_days_ago,
      has_recent_partial_payment: row.has_recent_partial_payment,
      relative_lateness_days: row.relative_lateness_days,
      organisation_base_currency_code: organisationBaseCurrency,
    }, benchmarks.context),
  }))
}

export type PortfolioBaseScores = ReturnType<typeof calculatePortfolioBaseScores>
