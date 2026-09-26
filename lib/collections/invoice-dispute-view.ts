/** Native-currency editing contract shared by customer context and the worklist. */
export interface InvoiceDisputeView {
  invoiceSourceId: string
  invoiceNumber: string | null
  reference: string | null
  issueDate: string | null
  dueDate: string | null
  currencyCode: string | null
  disputeId: string | null
  revision: string | null
  note: string | null
  invoiceState: 'open' | 'settled' | 'unavailable' | 'invalid'
  disputeMode: 'full' | 'partial' | null
  isActive: boolean
  isResolved: boolean
  needsReview: boolean
  currentAmountDueNative: string | null
  recordedDisputedAmountNative: string | null
  effectiveDisputedAmountNative: string | null
  collectibleAmountNative: string | null
}
