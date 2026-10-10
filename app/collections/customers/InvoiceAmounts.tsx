import type { InvoiceDisputeView } from '@/lib/collections/invoice-dispute-view'
import { compareDecimalValues } from '@/lib/money/currency'
import { promiseMoney } from '@/lib/collections/promise-presentation'

/** Display server-derived amounts. No adjustment arithmetic belongs in React. */
export default function InvoiceAmounts({ invoice }: { invoice: InvoiceDisputeView }) {
  const disputed = compareDecimalValues(invoice.effectiveDisputedAmountNative, '0') === 1
  const promised = compareDecimalValues(invoice.activePromisedCoverageAmountNative, '0') === 1
  const entries: Array<[string, string | null]> = [['Outstanding', invoice.currentAmountDueNative]]
  if (disputed) entries.push(['Disputed', invoice.effectiveDisputedAmountNative])
  if (promised) entries.push(['Promised', invoice.activePromisedCoverageAmountNative ?? null])
  return <dl className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-1 sm:max-w-md" aria-label="Invoice amounts">
    {entries.map(([label, value]) => <div key={label} className="contents text-text-primary">
      <dt>{label}</dt><dd className="break-words text-right tabular-nums [overflow-wrap:anywhere]">{promiseMoney(value, invoice.currencyCode)}</dd>
    </div>)}
  </dl>
}
