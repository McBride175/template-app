import type { CustomerCollectionsSummaryRow } from '@/app/collections/customers/customer-workspace-types'
import type { InvoiceDisputeView } from '@/lib/collections/invoice-dispute-view'
import type { CustomerHistoryEvent } from '@/lib/collections/customer-history'
import type { PromiseView } from '@/lib/collections/promise-presentation'

export const customerFixture: CustomerCollectionsSummaryRow = {
  customer_source_id: 'synthetic-1', customer_name: 'Northbridge Supplies', customer_email: 'finance@example.invalid',
  is_customer: true, is_supplier: false, status: 'ACTIVE', total_invoices_count: 12, open_invoices_count: 3, overdue_invoices_count: 2,
  total_outstanding_base_decimal: '14120', overdue_outstanding_base_decimal: '9792.5',
  total_outstanding_base: 14120, overdue_outstanding_base: 9792.5,
  collectible_outstanding_base: 12170, collectible_overdue_base: 7842.5, customer_to_chase_overdue_base: 6842.5,
  customer_credit_applied_base: 1000, effective_disputed_outstanding_base_decimal: '1200', effective_disputed_overdue_base_decimal: '1200',
  has_active_dispute: true, oldest_overdue_invoice_date: '2026-08-12', oldest_overdue_days: 42, weighted_avg_overdue_days: 28.6,
  historical_paid_invoice_count: 9, historical_mean_days_late: 12, historical_normal_days_late: 10, relative_lateness_days: 18.6,
  latest_invoice_date: '2026-09-30', latest_due_date: '2026-10-20', last_payment_date: '2026-09-27', organisation_base_currency_code: 'GBP',
  native_currency_breakdown: [{ currency_code: 'GBP', total_outstanding_native: '14120', overdue_outstanding_native: '9792.5' }],
  collectible_native_currency_breakdown: [], override_level: 'normal',
}
export const customerFixtures = [customerFixture, { ...customerFixture, customer_source_id: 'synthetic-2', customer_name: 'Cedar & Finch Studio',
  customer_to_chase_overdue_base: 2140, overdue_outstanding_base: 2140, total_outstanding_base: 3620, has_active_dispute: false, customer_credit_applied_base: 0,
  total_outstanding_base_decimal: '3620', overdue_outstanding_base_decimal: '2140', collectible_outstanding_base: 3620, collectible_overdue_base: 2140,
  effective_disputed_outstanding_base_decimal: '0', effective_disputed_overdue_base_decimal: '0',
  native_currency_breakdown: [{ currency_code: 'GBP', total_outstanding_native: '3620', overdue_outstanding_native: '2140' }] },
  { ...customerFixture, customer_source_id: 'synthetic-3', customer_name: 'Harbour Engineering', customer_to_chase_overdue_base: 0,
    customer_credit_applied_base: 7842.5, override_level: 'safe' as const }]
export const promiseFixture: PromiseView = { id: 'synthetic-promise', revision: '3', status: 'active', currencyCode: 'GBP',
  promisedAmountNative: '1000', promisedDate: '2026-10-14', qualifyingPaidAmountNative: '250', note: 'Agreed on the phone. Remaining payment expected Wednesday.' }
export const invoiceFixture: InvoiceDisputeView = { invoiceSourceId: 'synthetic-invoice-1', invoiceNumber: 'INV-1048', reference: 'September materials',
  issueDate: '2026-08-12', dueDate: '2026-08-29', currencyCode: 'GBP', disputeId: 'synthetic-dispute', revision: '4', note: 'Delivery query being checked.',
  invoiceState: 'open', disputeMode: 'partial', isActive: true, isResolved: false, needsReview: false,
  currentAmountDueNative: '5000', recordedDisputedAmountNative: '1200', effectiveDisputedAmountNative: '1200',
  collectibleAmountNative: '3050', activePromisedCoverageAmountNative: '750', toChaseAmountNative: '3050', activePromise: { ...promiseFixture, status: 'active', activeCoverageAmountNative: '750' } }
export const invoiceFixtures: InvoiceDisputeView[] = [invoiceFixture,
  { ...invoiceFixture, invoiceSourceId: 'synthetic-invoice-2', invoiceNumber: 'INV-1056', disputeId: null, revision: null, note: null, isActive: false, disputeMode: null,
    currentAmountDueNative: '4792.5', recordedDisputedAmountNative: null, effectiveDisputedAmountNative: '0', activePromisedCoverageAmountNative: '0', collectibleAmountNative: '4792.5', toChaseAmountNative: '4792.5', activePromise: null },
  { ...invoiceFixture, invoiceSourceId: 'synthetic-invoice-3', invoiceNumber: 'INV-1060', invoiceState: 'settled', isActive: false, isResolved: true,
    currentAmountDueNative: '0', effectiveDisputedAmountNative: '0', activePromisedCoverageAmountNative: '0', activePromise: null,
    latestPromise: { ...promiseFixture, status: 'kept', qualifyingPaidAmountNative: '1000' } },
  { ...invoiceFixture, invoiceSourceId: 'synthetic-invoice-4', invoiceNumber: 'INV-1070', dueDate: '2026-10-20', disputeId: null, revision: null, note: null, isActive: false, isResolved: false, disputeMode: null,
    currentAmountDueNative: '4327.5', recordedDisputedAmountNative: null, effectiveDisputedAmountNative: '0', activePromisedCoverageAmountNative: '0', collectibleAmountNative: '4327.5', toChaseAmountNative: '4327.5', activePromise: null }]
export const historyFixtures: CustomerHistoryEvent[] = [
  { id: 'synthetic-action', kind: 'action', timestamp: '2026-10-10T09:30:00Z', label: 'Message sent', detail: null,
    note: 'Asked for an update on the remaining balance.', followUpDate: '2026-10-13', invoiceSourceId: null, invoiceReference: null, deletable: true, actionId: 'synthetic-action-id' },
  { id: 'synthetic-promise-event', kind: 'promise', timestamp: '2026-10-09T15:00:00Z', label: 'Promise recorded', detail: 'Promised £1,000.00 by 14 Oct 2026',
    note: null, followUpDate: null, invoiceSourceId: 'synthetic-invoice-1', invoiceReference: 'INV-1048', deletable: false, actionId: null },
  { id: 'synthetic-dispute-event', kind: 'dispute', timestamp: '2026-10-08T11:45:00Z', label: 'Dispute raised', detail: null, note: null,
    followUpDate: null, invoiceSourceId: 'synthetic-invoice-1', invoiceReference: 'INV-1048', deletable: false, actionId: null },
  { id: 'synthetic-legacy-event', kind: 'legacy', timestamp: '2026-09-29T08:00:00Z', label: 'Called · legacy activity', detail: 'Legacy outcome: Spoke to customer',
    note: null, followUpDate: null, invoiceSourceId: null, invoiceReference: null, deletable: false, actionId: null },
]
