import type { FounderContextLevel } from '@/lib/collections/founder-context'

export type SortBy =
  | 'overdue_outstanding'
  | 'total_outstanding'
  | 'oldest_overdue_days'
  | 'customer_name'

export type SortDir = 'asc' | 'desc'

export interface CustomerCollectionsSummaryRow {
  customer_source_id: string
  customer_name: string
  customer_email: string | null
  is_customer: boolean | null
  is_supplier: boolean | null
  status: string | null
  total_invoices_count: number
  open_invoices_count: number
  overdue_invoices_count: number
  total_outstanding_base_decimal: string | null
  overdue_outstanding_base_decimal: string | null
  total_outstanding_base: number | null
  overdue_outstanding_base: number | null
  collectible_outstanding_base: number
  collectible_overdue_base: number
  customer_to_chase_overdue_base: number
  customer_credit_applied_base: number
  effective_disputed_outstanding_base_decimal: string | null
  effective_disputed_overdue_base_decimal: string | null
  has_active_dispute: boolean
  oldest_overdue_invoice_date: string | null
  oldest_overdue_days: number | null
  weighted_avg_overdue_days: number
  historical_paid_invoice_count: number
  historical_mean_days_late: number | null
  historical_normal_days_late: number | null
  relative_lateness_days: number | null
  latest_invoice_date: string | null
  latest_due_date: string | null
  last_payment_date: string | null
  organisation_base_currency_code: string
  native_currency_breakdown: Array<{
    currency_code: string
    total_outstanding_native: string
    overdue_outstanding_native: string
  }>
  collectible_native_currency_breakdown: Array<{
    currency_code: string
    effective_disputed_outstanding_native: string
    effective_disputed_overdue_native: string
    collectible_outstanding_native: string
    collectible_overdue_native: string
  }>
  override_level: FounderContextLevel
}
