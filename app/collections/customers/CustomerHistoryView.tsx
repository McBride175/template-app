import { disputesReturnHref, withDisputesOrigin } from '@/lib/collections/dispute-worklist'
import { promisesReturnHref, withPromisesOrigin } from '@/lib/collections/promise-worklist'
import type { CustomerHistoryEvent } from '@/lib/collections/customer-history'
import Link from 'next/link'
import { prioritiesReturnHref, withQueueOrigin } from '../actions/queue-navigation-context'
import CustomerTimeline from './CustomerTimeline'
import Button from '@/app/components/ui/Button'
import Alert from '@/app/components/ui/Alert'
import { actionStyles } from '@/app/components/ui/actionStyles'

export interface CustomerHistoryViewProps {
  tenantId: string; customerSourceId: string; customerName: string; events: CustomerHistoryEvent[]
  busy: boolean; feedback: string | null; error: string | null; hasMore: boolean
  originDisputes?: string | null
  originPromises?: string | null
  originQueueCustomer?: string | null
  onDelete: (event: CustomerHistoryEvent) => void; onMore: () => void
}

/** History layout only. Reads, cursor handling and permissions stay in the client. */
export default function CustomerHistoryView({ tenantId, customerSourceId, customerName, events, busy, feedback, error, hasMore, onDelete, onMore, originQueueCustomer, originPromises, originDisputes }: CustomerHistoryViewProps) {
  const customerHref = withDisputesOrigin(withPromisesOrigin(withQueueOrigin(`/customers?tenantId=${encodeURIComponent(tenantId)}&customerSourceId=${encodeURIComponent(customerSourceId)}`, originQueueCustomer), originPromises ?? null, tenantId), originDisputes ?? null, tenantId)
  const promisesHref = promisesReturnHref(originPromises, tenantId)
  return <main className="mx-auto min-w-0 max-w-5xl space-y-4 sm:space-y-6">
    <nav aria-label="Customer history navigation" className="flex flex-wrap gap-x-5">
      {disputesReturnHref(originDisputes, tenantId) && <Link href={disputesReturnHref(originDisputes, tenantId)!} className={actionStyles({ variant: 'ghost', className: 'min-h-11 px-0' })}>Back to Disputes</Link>}
      {promisesHref && <Link href={promisesHref} className={actionStyles({ variant: 'ghost', className: 'min-h-11 px-0' })}>Back to Promises</Link>}
      <Link href={customerHref} className={actionStyles({ variant: 'ghost', className: 'min-h-11 px-0' })}>Back to Customers</Link>
      <Link href={prioritiesReturnHref(tenantId, originQueueCustomer)} className={actionStyles({ variant: 'ghost', className: 'min-h-11 px-0' })}>Back to Priorities</Link>
    </nav>
    <header className="min-w-0 border-b border-border-default pb-4">
      <p className="text-sm text-text-secondary">Customer history</p>
      <h1 className="mt-1 break-words text-xl font-semibold [overflow-wrap:anywhere] sm:text-2xl">{customerName}</h1>
      <p className="mt-2 hidden text-sm text-text-secondary sm:block">Collection outcomes, promise changes and recorded dispute milestones.</p>
    </header>
    {feedback && <Alert variant="success">{feedback}</Alert>}
    {error && <Alert variant="error">{error}</Alert>}
    <CustomerTimeline events={events} busy={busy} onDelete={onDelete} customerHref={customerHref} />
    {hasMore && <Button variant="secondary" className="min-h-11" disabled={busy} onClick={onMore}>{busy ? 'Loading…' : 'Load more history'}</Button>}
  </main>
}
