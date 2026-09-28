import type { InvoiceDisputeView } from '@/lib/collections/invoice-dispute-view'
import { compareDecimalValues } from '@/lib/money/currency'
import { promiseMoney } from '@/lib/collections/promise-presentation'

/** Display server-derived amounts. No adjustment arithmetic belongs in React. */
export default function InvoiceAmounts({ invoice }: { invoice: InvoiceDisputeView }) {
  const disputed = compareDecimalValues(invoice.effectiveDisputedAmountNative, '0') === 1
  const promised = compareDecimalValues(invoice.activePromisedCoverageAmountNative, '0') === 1
  const adjusted = disputed || promised || Boolean(invoice.activePromise || invoice.latestPromise)
  const entries: Array<[string, string | null]> = [['Outstanding', invoice.currentAmountDueNative]]
  if (disputed) entries.push(['Disputed', invoice.effectiveDisputedAmountNative])
  if (promised) entries.push(['Promised', invoice.activePromisedCoverageAmountNative ?? null])
  if (adjusted) entries.push(['To chase', invoice.toChaseAmountNative ?? invoice.collectibleAmountNative])
  return <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 sm:max-w-md" aria-label="Invoice amounts">
    {entries.map(([label, value]) => <div key={label} className={`contents ${label === 'To chase' ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
      <dt>{label}</dt><dd className="text-right tabular-nums">{promiseMoney(value, invoice.currencyCode)}</dd>
    </div>)}
  </dl>
}
