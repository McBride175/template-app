import type { ReactNode } from 'react'
import type { InvoiceDisputeView as InvoiceRow } from '@/lib/collections/invoice-dispute-view'
import InvoiceAmounts from './InvoiceAmounts'

function date(value: string | null) {
  if (!value) return '—'
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString()
}

function status(invoice: InvoiceRow) {
  if (invoice.invoiceState === 'settled') {
    if (invoice.isResolved) return 'Resolved by you · settled in accounting'
    return invoice.isActive ? 'Settled in accounting · dispute remains unresolved' : 'Settled in accounting'
  }
  if (invoice.invoiceState === 'unavailable') return 'Unavailable in current accounting data'
  if (invoice.invoiceState === 'invalid') return 'Accounting balance unavailable'
  if (invoice.isResolved) return 'Resolved by you'
  if (invoice.isActive) return `${invoice.disputeMode === 'full' ? 'Full' : 'Partial'} dispute${invoice.needsReview ? ' · Needs review' : ''}`
  return 'No dispute'
}


export default function InvoiceFrame({ invoice, selection, children }: { invoice: InvoiceRow; selection?: ReactNode; children: ReactNode }) {
  return <article id={`invoice-${invoice.invoiceSourceId}`} tabIndex={-1} aria-label={`Invoice ${invoice.invoiceNumber || invoice.reference || invoice.invoiceSourceId}`}
    className="min-w-0 scroll-mt-4 rounded-surface border border-border-default bg-surface p-3 text-sm focus-visible:outline-2 focus-visible:outline-focus sm:p-4">
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex min-w-0 items-start gap-2">{selection}<h4 className="break-words font-semibold text-text-primary [overflow-wrap:anywhere]">{invoice.invoiceNumber || invoice.reference || invoice.invoiceSourceId}</h4></div>
        <p className="mt-1 text-xs text-text-secondary">Issued {date(invoice.issueDate)} · Due {date(invoice.dueDate)} · {invoice.currencyCode || 'Currency unavailable'}</p>
      </div>
      <p className="break-words text-xs text-text-secondary">{invoice.invoiceState === 'open' ? 'Open in accounting · ' : ''}{status(invoice)}</p>
    </div>
    <InvoiceAmounts invoice={invoice} />
    {invoice.needsReview && <p className="mt-3 rounded-surface bg-feedback-warning-surface p-2 text-feedback-warning">Balance changed since this dispute was last reviewed. Update it or keep it as is.</p>}
    {children}
  </article>
}
