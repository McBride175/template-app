import type { PromiseView } from '@/lib/collections/promise-presentation'

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
  /** Compatibility alias for canonical To chase. */
  collectibleAmountNative: string | null
  activePromisedCoverageAmountNative?: string | null
  toChaseAmountNative?: string | null
  grossOpenAmountBase?: string | null
  effectiveDisputedAmountBase?: string | null
  activePromisedCoverageAmountBase?: string | null
  toChaseAmountBase?: string | null
  latestPromise?: PromiseView | null
  activePromise?: {
    id: string
    status: 'active'
    revision?: string
    note?: string | null
    promisedAmountNative: string | null
    promisedDate?: string
    qualifyingPaidAmountNative: string | null
    activeCoverageAmountNative: string | null
  } | null
}
