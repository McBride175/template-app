'use client'
import Link from 'next/link'
import { useId, useMemo, useState, useSyncExternalStore } from 'react'
import Button from '@/app/components/ui/Button'
import Alert from '@/app/components/ui/Alert'
import Spinner from '@/app/components/ui/Spinner'
import { promiseDate, promiseMoney } from '@/lib/collections/promise-presentation'
import { priorityInvoiceContext } from './priority-invoices'
import type { PriorityInvoiceState } from './usePriorityInvoices'

function subscribeViewport(changed: () => void) {
  const media = window.matchMedia?.('(min-width: 640px)')
  media?.addEventListener?.('change', changed)
  return () => media?.removeEventListener?.('change', changed)
}
const desktopSnapshot = () => window.matchMedia?.('(min-width: 640px)').matches ?? false
const serverSnapshot = () => false

export default function QueueInvoices({ state, evaluationDate, href, onRetry }: {
  state: PriorityInvoiceState; evaluationDate: string | null; href: string; onRetry: () => void
}) {
  const id = useId()
  const desktop = useSyncExternalStore(subscribeViewport, desktopSnapshot, serverSnapshot)
  const [disclosure, setDisclosure] = useState<boolean | null>(null)
  const expanded = disclosure ?? desktop
  const { overdue, uncertain, dateKnown, reviews } = useMemo(() => ({
    ...priorityInvoiceContext(state.invoices, evaluationDate),
    reviews: state.invoices.filter(invoice => invoice.needsReview).length,
  }), [state.invoices, evaluationDate])
  return <section aria-label="Invoices requiring attention" className="min-w-0 border-y border-border-default md:py-2">
    <div className="flex flex-wrap items-center justify-between gap-x-3">
      <Button variant="ghost" size="sm" className="min-h-11 px-0 text-left" aria-label="Invoices requiring attention" aria-expanded={expanded} aria-controls={id} onClick={() => setDisclosure(!expanded)}>
        <span><span className="sm:hidden">Invoices</span><span className="hidden sm:inline">Invoices requiring attention</span>{state.status === 'ready' && dateKnown ? ` · ${overdue.length}` : ''} <svg aria-hidden="true" className={`ml-1 inline h-3 w-3 ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 16 16" fill="none"><path d="m3 6 5 5 5-5" stroke="currentColor" strokeWidth="1.5" /></svg></span>
      </Button>
      <Link href={href} className="inline-flex min-h-11 items-center text-sm font-semibold text-link underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-focus">View all invoices</Link>
    </div>
    {/* Material warnings and errors stay visible even when supporting rows are folded. */}
    {state.status === 'error' && <Alert variant="error"><p>{state.error}</p><Button variant="ghost" size="sm" className="min-h-11" onClick={onRetry}>Retry invoices</Button></Alert>}
    {state.status === 'ready' && uncertain.length > 0 && <p role="status" className="py-1 text-xs text-feedback-warning">{uncertain.length} invoice record{uncertain.length === 1 ? '' : 's'} with unavailable accounting, date or currency information. Review all invoices before relying on this list.</p>}
    {state.status === 'ready' && reviews > 0 && <p role="status" className="py-1 text-xs text-feedback-warning">{reviews} dispute balance{reviews === 1 ? '' : 's'} need review. View all invoices to check the changed balance.</p>}
    {state.status === 'loading' && <p role="status" className="flex min-h-6 items-center gap-2 text-xs text-text-secondary"><Spinner label={null} />Loading invoice context…</p>}
    <div id={id} hidden={!expanded} className="pb-2">
      {state.status === 'loading' && <div aria-hidden="true" className="space-y-3 py-2 sm:min-h-32"><div className="h-8 rounded-control bg-surface-subtle" /><div className="h-8 rounded-control bg-surface-subtle" /><div className="h-8 rounded-control bg-surface-subtle" /></div>}
      {state.status === 'ready' && <>
        {!dateKnown ? <p className="py-2 text-sm text-text-secondary">The queue evaluation date is unavailable. View all invoices to check due dates; this does not mean the debt is settled.</p>
          : overdue.length === 0 ? <p className="py-2 text-sm text-text-secondary">No open overdue invoices with a known positive outstanding amount are available as of {promiseDate(evaluationDate)}. Other debt or commitments may remain.</p>
            : <ul className="divide-y divide-border-default">
              {overdue.slice(0, 3).map(invoice => <li key={invoice.invoiceSourceId} className="grid min-w-0 gap-x-3 gap-y-1 py-2 text-sm lg:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0"><p className="break-words font-semibold [overflow-wrap:anywhere]">{invoice.invoiceNumber || invoice.reference || invoice.invoiceSourceId}</p><p className="text-xs text-text-secondary">Due {promiseDate(invoice.dueDate)}</p></div>
                <p className="min-w-0 break-words tabular-nums [overflow-wrap:anywhere] lg:text-right"><span className="text-xs text-text-secondary">Outstanding </span>{promiseMoney(invoice.currentAmountDueNative, invoice.currencyCode)}{!invoice.currencyCode && <span className="text-xs text-feedback-warning"> · Currency unavailable</span>}</p>
                {(invoice.isActive || invoice.activePromise) && <p className="break-words text-xs text-text-secondary lg:col-span-2">
                  {invoice.isActive && <span>{invoice.disputeMode === 'full' ? 'Full dispute' : 'Partial dispute'} · {promiseMoney(invoice.effectiveDisputedAmountNative, invoice.currencyCode)} disputed{invoice.needsReview ? ' · Balance needs review' : ''}</span>}
                  {invoice.isActive && invoice.activePromise && ' · '}
                  {invoice.activePromise && <span>Active promise · {promiseMoney(invoice.activePromisedCoverageAmountNative, invoice.currencyCode)} currently covered{invoice.activePromise.promisedDate ? ` · promised by ${promiseDate(invoice.activePromise.promisedDate)}` : ''}</span>}
                </p>}
              </li>)}
            </ul>}
        {overdue.length > 3 && <p className="mt-1 text-xs text-text-secondary">Showing the first 3 of {overdue.length} overdue invoices. View all invoices for the rest.</p>}
        <p className="mt-2 text-xs text-text-secondary">Invoice outstanding amounts support the conversation; they do not sum to customer To chase. Credits apply at customer level.</p>
      </>}
    </div>
  </section>
}
