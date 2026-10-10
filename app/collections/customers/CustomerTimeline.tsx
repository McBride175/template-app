import type { CustomerHistoryEvent } from '@/lib/collections/customer-history'
import Button from '@/app/components/ui/Button'
import Badge from '@/app/components/ui/Badge'
import EmptyState from '@/app/components/ui/EmptyState'
import Link from 'next/link'

function eventTime(timestamp: string) {
  const date = new Date(timestamp)
  return Number.isFinite(date.getTime())
    ? `${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(date)} UTC`
    : timestamp
}
function followUpDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
    : value
}


/** Keeps the server's chronology and deletion permissions; no event synthesis. */
export default function CustomerTimeline({ events, busy, onDelete, customerHref }: {
  events: CustomerHistoryEvent[]; busy: boolean; onDelete: (event: CustomerHistoryEvent) => void; customerHref?: string
}) {
  if (!events.length) return <EmptyState title="No collection activity" description="No collection activity recorded for this customer." />
  return <ol className="divide-y divide-border-default" aria-label="Customer collection history">
    {events.map(event => <li key={event.id} className="min-w-0 py-4 sm:py-5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge>{event.kind === 'promise' ? 'Promise' : event.kind === 'dispute' ? 'Dispute' : event.kind === 'legacy' ? 'Legacy · read only' : 'Collection action'}</Badge>
          <time dateTime={event.timestamp} className="text-xs text-text-secondary">{eventTime(event.timestamp)}</time>
        </div>
        {event.deletable && <Button variant="ghost" className="min-h-11 text-feedback-error" disabled={busy} onClick={() => onDelete(event)}>Delete</Button>}
      </div>
      <h2 className="mt-2 break-words text-base font-semibold [overflow-wrap:anywhere]">{event.label}</h2>
      {event.invoiceSourceId && <p className="mt-1 text-sm text-text-secondary">
        {customerHref ? <Link href={`${customerHref}#invoice-${encodeURIComponent(event.invoiceSourceId)}`} className="inline-flex min-h-11 items-center text-link underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-focus">Invoice {event.invoiceReference || event.invoiceSourceId}</Link> : <>Invoice {event.invoiceReference || event.invoiceSourceId}</>}
      </p>}
      {event.detail && <p className="mt-1 break-words whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{event.detail}</p>}
      {event.note && <p className="mt-1 break-words whitespace-pre-wrap text-sm text-text-secondary [overflow-wrap:anywhere]">{event.note}</p>}
      {event.followUpDate && <p className="mt-2 text-sm text-text-secondary">Follow up {followUpDate(event.followUpDate)}</p>}
    </li>)}
  </ol>
}
