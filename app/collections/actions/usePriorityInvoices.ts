'use client'
import { useEffect, useRef, useState } from 'react'
import type { InvoiceDisputeView } from '@/lib/collections/invoice-dispute-view'
import { subscribeAccountingUpdates } from '@/lib/accounting/product-events'
import { subscribePromiseActionability } from '@/lib/collections/promise-refresh'

export type PriorityInvoiceState = { status: 'loading' | 'ready' | 'error'; invoices: InvoiceDisputeView[]; error?: string }
type Entry = { key: string; expires: number; invoices: InvoiceDisputeView[] }
const EMPTY: PriorityInvoiceState = { status: 'loading', invoices: [] }

/** Mounted-queue-only cache: four customer batches, 60s maximum; no global/persistent financial state. */
export default function usePriorityInvoices(tenantId: string | null, customerSourceId: string | null, financialVersion: string) {
  const cache = useRef(new Map<string, Entry>())
  const sequence = useRef(0)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ key: string; state: PriorityInvoiceState } | null>(null)
  const key = JSON.stringify([tenantId, customerSourceId, financialVersion, revision])
  useEffect(() => {
    const invalidate = () => { cache.current.clear(); setRevision(value => value + 1) }
    const accounting = subscribeAccountingUpdates(invalidate)
    const financial = subscribePromiseActionability(tenantId, invalidate)
    return () => { accounting(); financial() }
  }, [tenantId])
  useEffect(() => {
    const request = ++sequence.current
    if (!tenantId || !customerSourceId) return
    const controller = new AbortController()
    const scope = JSON.stringify([tenantId, customerSourceId])
    const cached = cache.current.get(scope)
    if (cached?.key === key && cached.expires > Date.now()) {
      setResult({ key, state: { status: 'ready', invoices: cached.invoices } })
      return
    }
    setResult({ key, state: EMPTY })
    const params = new URLSearchParams({ tenantId, customerSourceId })
    void (async () => {
      try {
        const response = await fetch(`/api/collections/invoice-disputes?${params}`, { cache: 'no-store', credentials: 'include', signal: controller.signal })
        const payload = await response.json()
        if (controller.signal.aborted || sequence.current !== request) return
        if (!response.ok || !payload?.ok || !Array.isArray(payload.invoices)) throw new Error(
          response.status === 401 ? 'Your session has expired. Sign in again to view invoices.' : payload?.error || 'Invoice context is unavailable. Your collection actions are still available.')
        const invoices = payload.invoices as InvoiceDisputeView[]
        cache.current.delete(scope)
        cache.current.set(scope, { key, expires: Date.now() + 60_000, invoices })
        while (cache.current.size > 4) cache.current.delete(cache.current.keys().next().value!)
        setResult({ key, state: { status: 'ready', invoices } })
      } catch (error) {
        if (!controller.signal.aborted && sequence.current === request) setResult({ key, state: {
          status: 'error', invoices: [], error: error instanceof Error ? error.message : 'Invoice context is unavailable.',
        } })
      }
    })()
    return () => controller.abort()
  }, [key, tenantId, customerSourceId])
  return { state: result?.key === key ? result.state : EMPTY,
    retry: () => { cache.current.clear(); setRevision(value => value + 1) } }
}
