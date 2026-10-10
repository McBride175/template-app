'use client'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { subscribeAccountingUpdates } from '@/lib/accounting/product-events'
import { subscribePromiseActionability } from '@/lib/collections/promise-refresh'
import { promiseWorklistUrl, type PromiseWorklistQuery, type PromiseWorklistResponse } from '@/lib/collections/promise-worklist'
import PromiseWorklist from './PromiseWorklist'
export default function PromisesClient({ tenantId, query }: { tenantId: string | null; query: PromiseWorklistQuery }) {
  const router = useRouter(), url = promiseWorklistUrl(query, tenantId)
  const [state, setState] = useState<{ url: string; data: PromiseWorklistResponse | null; loading: boolean; error: string | null }>({ url, data: null, loading: true, error: null })
  const current = useRef(url), sequence = useRef(0), pending = useRef<AbortController | null>(null)
  current.current = url
  const reload = useCallback(async () => {
    if (current.current !== url) return
    pending.current?.abort()
    const controller = new AbortController(), id = ++sequence.current
    pending.current = controller
    setState({ url, data: null, loading: true, error: null })
    try {
      const response = await fetch(url.replace('/promises?', '/api/collections/promises?'), { credentials: 'include', cache: 'no-store', signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (!response.ok || !body?.ok) throw new Error(body?.error || 'Could not load promises.')
      if (controller.signal.aborted || id !== sequence.current || current.current !== url) return
      setState({ url, data: body, loading: false, error: null })
    } catch (error) {
      if (controller.signal.aborted || id !== sequence.current || current.current !== url) return
      setState({ url, data: null, loading: false, error: error instanceof Error ? error.message : 'Could not load promises.' })
    }
  }, [url])
  const cancelPending = useCallback(() => pending.current?.abort(), [])
  useEffect(() => { void reload(); return cancelPending }, [reload, cancelPending])
  const resolvedTenant = state.url === url ? state.data?.tenantId ?? tenantId : tenantId
  useEffect(() => {
    const updated = () => { void reload() }
    const accounting = subscribeAccountingUpdates(updated), financial = subscribePromiseActionability(resolvedTenant, updated)
    return () => { accounting(); financial() }
  }, [reload, resolvedTenant])
  const active = state.url === url ? state : { data: null, loading: true, error: null }
  return <PromiseWorklist query={query} {...active} onRetry={() => void reload()}
    onNavigate={next => router.push(promiseWorklistUrl(next, resolvedTenant))} />
}
