import type { InvoiceDisputeView } from '@/lib/collections/invoice-dispute-view'
import { compareDecimalValues, normalizeDecimalValue } from '@/lib/money/currency'
import { promiseDate, promiseMoney, promiseOutcome, type PromiseView } from '@/lib/collections/promise-presentation'

export default function PromiseCommitment({ invoice, current, editing = false }: { invoice: InvoiceDisputeView; current: PromiseView | null; editing?: boolean }) {
  const active = current?.status === 'active' ? current : null
  return <>
    {active && <div>
      <p className="break-words font-semibold text-text-primary [overflow-wrap:anywhere]">{promiseMoney(active.promisedAmountNative, invoice.currencyCode)} promised by {promiseDate(active.promisedDate)} <span className="ml-2 text-xs font-normal text-text-secondary">Active</span></p>
      {compareDecimalValues(active.qualifyingPaidAmountNative, '0') === 1 && <p className="mt-1 text-text-secondary">{promiseMoney(active.qualifyingPaidAmountNative, invoice.currencyCode)} received against this promise</p>}
      {invoice.activePromisedCoverageAmountNative != null && normalizeDecimalValue(invoice.activePromisedCoverageAmountNative) !== normalizeDecimalValue(active.promisedAmountNative) && <p className="mt-1 text-text-secondary">{promiseMoney(invoice.activePromisedCoverageAmountNative, invoice.currencyCode)} currently promised against outstanding debt</p>}
      {active.note && !editing && <p className="mt-1 break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-text-secondary">{active.note}</p>}
    </div>}
    {current && !active && <p className="text-text-secondary">{promiseOutcome[current.status]} · {promiseMoney(current.promisedAmountNative, current.currencyCode ?? invoice.currencyCode)} by {promiseDate(current.promisedDate)}</p>}
  </>
}
