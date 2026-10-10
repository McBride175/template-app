import type { InvoiceDisputeView } from '@/lib/collections/invoice-dispute-view'
import PromiseCommitment from './PromiseCommitment'
import EmptyState from '@/app/components/ui/EmptyState'

/** Current/latest commitments from the existing invoice batch, without another read. */
export default function CustomerPromises({ invoices }: { invoices: InvoiceDisputeView[] }) {
  const commitments = invoices.filter(invoice => invoice.activePromise || invoice.latestPromise)
  return <section id="customer-promises" tabIndex={-1} aria-label="Customer promises" className="min-w-0 scroll-mt-4 space-y-3 border-t border-border-default pt-4">
    <h3 className="text-base font-semibold">Promises</h3>
    <p className="text-xs text-text-secondary">Current and latest invoice commitments. Earlier commitments remain in each invoice’s promise history.</p>
    {!commitments.length ? <EmptyState title="No current or latest promises" description="Record a promise against an eligible invoice." />
      : <ul className="divide-y divide-border-default">
        {commitments.map(invoice => <li key={invoice.invoiceSourceId} className="min-w-0 space-y-2 py-3 text-sm">
          <p className="break-words font-semibold text-text-primary">Invoice {invoice.invoiceNumber || invoice.reference || invoice.invoiceSourceId}</p>
          <PromiseCommitment invoice={invoice} current={invoice.activePromise ?? invoice.latestPromise ?? null} />
          <a href={`#invoice-${encodeURIComponent(invoice.invoiceSourceId)}`} className="inline-flex min-h-11 items-center text-link underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-focus">Manage promise with invoice</a>
        </li>)}
      </ul>}
  </section>
}
