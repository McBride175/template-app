'use client'

import { useEffect, useRef, useState } from 'react'
import { queueCustomerId } from '@/app/collections/actions/queue-navigation-context'
import type { CustomerHistoryEvent } from '@/lib/collections/customer-history'
import CustomerHistoryView from '@/app/collections/customers/CustomerHistoryView'

interface HistoryResponse {
  ok?: boolean
  events?: CustomerHistoryEvent[]
  nextCursor?: string | null
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
  const [originQueueCustomer, setOriginQueueCustomer] = useState<string | null>(null)
  useEffect(() => { setOriginQueueCustomer(queueCustomerId(new URL(window.location.href).searchParams.get('queueCustomerSourceId'))) }, [])
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

  return <CustomerHistoryView originQueueCustomer={originQueueCustomer} tenantId={tenantId} customerSourceId={customerSourceId} customerName={customerName}
    events={events} busy={busy} feedback={feedback} error={error} hasMore={Boolean(nextCursor)}
    onDelete={event => void deleteAction(event)} onMore={() => void loadMore()} />
}
