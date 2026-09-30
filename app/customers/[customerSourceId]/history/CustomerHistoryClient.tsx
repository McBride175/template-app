'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import type { CustomerHistoryEvent } from '@/lib/collections/customer-history'

interface HistoryResponse {
  ok?: boolean
  events?: CustomerHistoryEvent[]
  nextCursor?: string | null
}

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

export default function CustomerHistoryClient({ tenantId, customerSourceId, customerName,
  initialEvents, initialCursor }: {
  tenantId: string; customerSourceId: string; customerName: string;
  initialEvents: CustomerHistoryEvent[]; initialCursor: string | null
}) {
  const [events, setEvents] = useState(initialEvents)
  const [nextCursor, setNextCursor] = useState(initialCursor)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const requestInFlight = useRef(false)

  async function readPage(cursor: string | null) {
    const params = new URLSearchParams({ tenantId, sourceSystem: 'xero', customerSourceId })
    if (cursor) params.set('cursor', cursor)
    const response = await fetch(`/api/collections/customer-history?${params}`, {
      credentials: 'include', cache: 'no-store',
    })
    const body = (await response.json().catch(() => null)) as HistoryResponse | null
    if (!response.ok || !body?.ok || !Array.isArray(body.events)) {
      throw new Error('Could not load customer history. Try again.')
    }
    return body
  }

  async function loadMore() {
    if (!nextCursor || requestInFlight.current) return
    requestInFlight.current = true
    setBusy(true); setError(null)
    try {
      const page = await readPage(nextCursor)
      setEvents(previous => {
        const seen = new Set(previous.map(event => event.id))
        return [...previous, ...page.events!.filter(event => !seen.has(event.id))]
      })
      setNextCursor(page.nextCursor ?? null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load customer history.')
    } finally { requestInFlight.current = false; setBusy(false) }
  }

  async function deleteAction(event: CustomerHistoryEvent) {
    if (!event.deletable || !event.actionId || requestInFlight.current) return
    if (!window.confirm('Delete this recorded outcome? This may change when the customer returns to the priority queue.')) return
    requestInFlight.current = true
    setBusy(true); setError(null); setFeedback(null)
    let deleted = false
    try {
      const response = await fetch('/api/collections/action-history', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ action_id: event.actionId, tenant_id: tenantId,
          source_system: 'xero', customer_source_id: customerSourceId }),
      })
      const body = (await response.json().catch(() => null)) as { ok?: boolean } | null
      if (!response.ok || !body?.ok) throw new Error('Could not confirm deletion. Try again.')
      deleted = true
      setEvents(previous => previous.filter(item => item.id !== event.id))
      const page = await readPage(null)
      setEvents(page.events!)
      setNextCursor(page.nextCursor ?? null)
      setFeedback('Action deleted. Priority eligibility will follow the latest surviving action.')
    } catch {
      setError(deleted ? 'Action deleted, but history could not refresh. Reload this page.'
        : 'Could not confirm deletion. Try again.')
    } finally { requestInFlight.current = false; setBusy(false) }
  }

  return <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
    <Link href={`/customers?tenantId=${encodeURIComponent(tenantId)}&customerSourceId=${encodeURIComponent(customerSourceId)}`}
      className="inline-flex min-h-11 items-center text-sm text-gray-700 underline underline-offset-2">
      Back to Customers
    </Link>
    <header className="mt-4 border-b border-gray-200 pb-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Customer history</p>
      <h1 className="mt-2 text-3xl font-semibold text-gray-950">{customerName}</h1>
      <p className="mt-2 text-sm text-gray-600">Collection outcomes, Promise changes and recorded Dispute milestones.</p>
    </header>
    {feedback && <p role="status" className="mt-4 text-sm text-green-700">{feedback}</p>}
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    {events.length === 0 ? <p className="mt-8 text-sm text-gray-600">No collection activity recorded for this customer.</p>
      : <ol className="divide-y divide-gray-200" aria-label="Customer collection history">
        {events.map(event => <li key={event.id} className="flex gap-4 py-5">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-500">{eventTime(event.timestamp)}</p>
            <p className="mt-1 font-medium text-gray-950">{event.label}</p>
            {event.invoiceSourceId && <p className="mt-1 text-sm text-gray-600">
              Invoice {event.invoiceReference || event.invoiceSourceId}
            </p>}
            {event.detail && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{event.detail}</p>}
            {event.note && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{event.note}</p>}
            {event.followUpDate && <p className="mt-1 text-sm text-gray-600">
              Follow up {followUpDate(event.followUpDate)}
            </p>}
          </div>
          {event.deletable && <button type="button" disabled={busy}
            className="min-h-11 self-start rounded-md px-3 text-sm text-red-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 disabled:opacity-50"
            onClick={() => void deleteAction(event)}>Delete</button>}
        </li>)}
      </ol>}
    {nextCursor && <button type="button" disabled={busy} onClick={() => void loadMore()}
      className="mt-6 min-h-11 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-900 disabled:opacity-50">
      {busy ? 'Loading…' : 'Load more history'}
    </button>}
  </main>
}
