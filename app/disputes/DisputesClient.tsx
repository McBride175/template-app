'use client'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { subscribeAccountingUpdates } from '@/lib/accounting/product-events'
import { subscribePromiseActionability } from '@/lib/collections/promise-refresh'
import { disputeWorklistUrl, type DisputeWorklistQuery, type DisputeWorklistResponse, type DisputeWorklistRow } from '@/lib/collections/dispute-worklist'
import DisputeWorklist from './DisputeWorklist'
import DisputeManagement from './DisputeManagement'

export default function DisputesClient({ tenantId, query }: { tenantId: string | null; query: DisputeWorklistQuery }) {
 const router = useRouter(), url = disputeWorklistUrl(query, tenantId)
 const [state, setState] = useState<{ url: string; data: DisputeWorklistResponse | null; loading: boolean; error: string | null }>({ url, data: null, loading: true, error: null })
 const [target, setTarget] = useState<{ row: DisputeWorklistRow; tenantId: string; url: string } | null>(null)
 const pending = useRef<AbortController | null>(null), sequence = useRef(0), current = useRef(url), busy = useRef(false)
 current.current = url
 const onBusy = useCallback((value: boolean) => { busy.current = value }, [])
 const reload = useCallback(async (): Promise<DisputeWorklistResponse | null> => {
  if (current.current !== url) return null
  pending.current?.abort(); const controller = new AbortController(), version = ++sequence.current; pending.current = controller
  setState(previous => ({ url, data: previous.url === url ? previous.data : null, loading: true, error: null }))
  try {
   const response = await fetch(url.replace('/disputes?', '/api/collections/disputes?'), { credentials: 'include', cache: 'no-store', signal: controller.signal })
   const body = await response.json()
   if (!response.ok || !body.ok || (tenantId && body.tenantId !== tenantId)) throw new Error(body.error || 'Could not load disputes.')
   if (controller.signal.aborted || version !== sequence.current || current.current !== url) return null
   setState({ url, data: body, loading: false, error: null }); return body
  } catch (error) {
   if (controller.signal.aborted || version !== sequence.current || current.current !== url) return null
   setState(previous => ({ url, data: previous.url === url ? previous.data : null, loading: false, error: error instanceof Error ? error.message : 'Could not load disputes.' })); return null
  }
 }, [url, tenantId])
 useEffect(() => { void reload(); return () => { pending.current?.abort() } }, [reload])
 const active = state.url === url ? state : { data: null, loading: true, error: null }
 const resolvedTenant = active.data?.tenantId ?? tenantId
 useEffect(() => {
  const updated = () => { if (!busy.current) void reload() }
  const accounting = subscribeAccountingUpdates(updated), financial = subscribePromiseActionability(resolvedTenant, updated)
  return () => { accounting(); financial() }
 }, [reload, resolvedTenant])
 return <><DisputeWorklist query={query} tenantId={resolvedTenant} {...active} onRetry={() => void reload()}
  onNavigate={next => router.push(disputeWorklistUrl(next, resolvedTenant))} onManage={row => { if (resolvedTenant) setTarget({ row, tenantId: resolvedTenant, url }) }} />
  {target && target.url === url && target.tenantId === resolvedTenant && <DisputeManagement key={`${target.tenantId}:${target.row.disputeId}`} row={target.row} tenantId={target.tenantId}
   returnHref={disputeWorklistUrl(active.data?.query ?? query, resolvedTenant)} onReload={reload} onBusy={onBusy} onClose={() => { setTarget(null); busy.current = false }} />}
 </>
}
