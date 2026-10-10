import type { InvoiceDisputeView } from '@/lib/collections/invoice-dispute-view'
export const disputeReference = (row: InvoiceDisputeView) => row.invoiceNumber || row.reference || row.invoiceSourceId
export function disputeStatus(row: InvoiceDisputeView) {
 if (row.isResolved) return 'Resolved by user'
 return `${row.disputeMode === 'full' ? 'Full' : 'Partial'} dispute · Active`
}
export function disputeWarning(row: InvoiceDisputeView & { effectiveDisputedBase?: string | null }) {
 if (row.invoiceState === 'unavailable' || row.invoiceState === 'invalid') return 'Current accounting values unavailable. Recorded dispute retained; no payment is inferred.'
 if (row.invoiceState === 'settled') return row.isActive ? 'Settled in accounting · dispute remains unresolved.' : 'Settled in accounting; resolution is a separate operational decision.'
 if (row.needsReview) return 'Balance changed · review the dispute against the current outstanding amount.'
 if (row.effectiveDisputedBase === null && row.effectiveDisputedAmountNative !== null) return 'Base-currency equivalent unavailable; invoice-native disputed amount retained.'
 if (!row.currencyCode || row.effectiveDisputedAmountNative === null) return 'Effective disputed amount or currency unavailable.'
 return null
}
