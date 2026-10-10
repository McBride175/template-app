'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { InvoiceDisputeView as InvoiceRow } from '@/lib/collections/invoice-dispute-view'
import { promiseDate, promiseMoney } from '@/lib/collections/promise-presentation'
import { compareDecimalValues } from '@/lib/money/currency'
import InvoiceAmounts from './InvoiceAmounts'

function date(value: string | null) {
  if (!value) return 'Unavailable'
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? 'Unavailable' : parsed.toLocaleDateString()
}

function exception(invoice: InvoiceRow) {
  if (invoice.invoiceState === 'settled') {
    if (invoice.isResolved) return 'Resolved by you · settled in accounting'
    return invoice.isActive ? 'Settled in accounting · dispute remains unresolved' : 'Settled in accounting'
  }
  if (invoice.invoiceState === 'unavailable') return 'Unavailable in current accounting data'
  if (invoice.invoiceState === 'invalid') return 'Accounting balance unavailable'
  if (invoice.isResolved) return 'Resolved by you'
  return null
}

/** One disclosure for all invoice tools. Hidden details stay mounted: drafts, commands
 * and reconciliation state survive collapse without fetching or resetting editors. */
export default function InvoiceFrame({ invoice, selection, children, defaultExpanded = false }: { invoice: InvoiceRow; selection?: ReactNode; children: ReactNode; defaultExpanded?: boolean }) {
  const [open, setOpen] = useState(() => defaultExpanded || (typeof window !== 'undefined' && window.location.hash === `#invoice-${invoice.invoiceSourceId}`))
  useEffect(() => {
    const revealLinkedInvoice = () => { if (window.location.hash === `#invoice-${invoice.invoiceSourceId}`) setOpen(true) }
    window.addEventListener('hashchange', revealLinkedInvoice)
    return () => window.removeEventListener('hashchange', revealLinkedInvoice)
  }, [invoice.invoiceSourceId])
  const detailsId = useId()
  const manageRef = useRef<HTMLButtonElement>(null)
  const reference = invoice.invoiceNumber || invoice.reference || invoice.invoiceSourceId
  const exceptional = exception(invoice)
  const promised = invoice.activePromise
  const disputed = compareDecimalValues(invoice.effectiveDisputedAmountNative, '0') === 1
  return <article id={`invoice-${invoice.invoiceSourceId}`} tabIndex={-1} aria-label={`Invoice ${reference}`}
    onFocus={event => { if (event.target === event.currentTarget) setOpen(true) }}
    className="min-w-0 scroll-mt-4 border-b border-border-default bg-surface text-sm focus-visible:outline-2 focus-visible:outline-focus">
    <div className={`grid min-w-0 items-center gap-x-1 py-2 sm:gap-x-3 ${selection ? 'grid-cols-[2.75rem_minmax(0,1fr)_3.25rem] sm:grid-cols-[2.75rem_minmax(0,1fr)_auto]' : 'grid-cols-[minmax(0,1fr)_3.25rem] sm:grid-cols-[minmax(0,1fr)_auto]'}`}>
      {selection}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-x-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="min-w-0"><h4 className="break-words font-semibold text-text-primary [overflow-wrap:anywhere]">{reference}</h4>
          <p className="text-xs text-text-secondary">Due {date(invoice.dueDate)}</p></div>
        <div className="min-w-0 text-right"><p className="break-words font-semibold tabular-nums text-text-primary [overflow-wrap:anywhere]">{promiseMoney(invoice.currentAmountDueNative, invoice.currencyCode)}</p>
          <p className="text-xs text-text-secondary">Outstanding{invoice.currencyCode ? ` ${invoice.currencyCode}` : ' · Currency unavailable'}</p></div>
      </div>
      <button ref={manageRef} type="button" aria-expanded={open} aria-controls={detailsId} aria-label={`${open ? 'Close' : 'Manage'} invoice ${reference}`}
        onClick={() => setOpen(value => !value)} className="flex min-h-11 min-w-13 flex-col-reverse items-center justify-center px-0 font-medium text-link sm:flex-row sm:gap-1 focus-visible:outline-2 focus-visible:outline-focus sm:px-2">
        <span className="text-xs sm:text-sm">{open ? 'Close' : 'Manage'}</span><svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path d={open ? 'M5 12.5 10 7.5l5 5' : 'M5 7.5 10 12.5l5-5'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {(promised || invoice.isActive || exceptional || !invoice.currencyCode || invoice.needsReview) && <div className={`min-w-0 space-y-1 pb-1 text-xs text-text-secondary ${selection ? 'col-span-2 col-start-2' : 'col-span-2'}`}>
        {promised && <p className="break-words text-sm [overflow-wrap:anywhere]">Promise {promiseMoney(promised.promisedAmountNative, invoice.currencyCode)} by {promiseDate(promised.promisedDate)}{compareDecimalValues(invoice.activePromisedCoverageAmountNative, '0') === 1 ? ` · ${promiseMoney(invoice.activePromisedCoverageAmountNative ?? null, invoice.currencyCode)} coverage` : invoice.activePromisedCoverageAmountNative == null ? ' · Coverage unavailable' : ' · No current coverage'}</p>}
        {invoice.isActive && <p className="text-sm">{invoice.disputeMode === 'full' ? 'Full' : 'Partial'} dispute{disputed ? ` · ${promiseMoney(invoice.effectiveDisputedAmountNative, invoice.currencyCode)} disputed` : invoice.effectiveDisputedAmountNative == null ? ' · Coverage unavailable' : ' · No current coverage'}</p>}
        {exceptional && <p className="text-sm">{exceptional}</p>}
        {invoice.needsReview && <p className="text-sm text-feedback-warning">Balance changed since this dispute was last reviewed. Update it or keep it as is.</p>}
      </div>}
    </div>
    <div id={detailsId} hidden={!open} className="min-w-0 border-t border-border-default py-3">
      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">{children}</div>
      <details className="mt-3 border-t border-border-default">
        <summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-text-secondary focus-visible:outline-2 focus-visible:outline-focus">Invoice information & coverage</summary>
        <p className="break-words text-xs text-text-secondary [overflow-wrap:anywhere]">Issued {date(invoice.issueDate)}{invoice.reference && invoice.reference !== reference ? ` · Reference: ${invoice.reference}` : ''}</p>
        <InvoiceAmounts invoice={invoice} />
      </details>
      <button type="button" className="mt-2 min-h-11 text-xs text-link underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-focus" onClick={() => { setOpen(false); manageRef.current?.focus() }}>Close invoice details</button>
    </div>
  </article>
}
