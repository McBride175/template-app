import type { ReadyFinancialMutation } from '@/lib/collections/financial-mutation-response'

/** Financial Promise changes require a fresh portfolio ranking, never a local score patch. */
const EVENT = 'yuohme:promise-actionability-changed'
const STORAGE = 'yuohme:promise-actionability'
const mountedQueues = new Map<symbol, { tenantId: string | null | undefined; overdueOnly: boolean; limit: number }>()
export function mountedFinancialQueueWindow(tenantId: string) {
  const queue = [...mountedQueues.values()].find(queue => queue.tenantId === tenantId)
  return queue ? { overdueOnly: queue.overdueOnly, limit: queue.limit } : undefined
}
export function notifyPromiseActionabilityChanged(tenantId: string, reconciliation?: ReadyFinancialMutation) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: reconciliation ? { tenantId, reconciliation } : tenantId }))
  try { window.localStorage.setItem(STORAGE, JSON.stringify({ tenantId, nonce: crypto.randomUUID() })) }
  catch { /* Same-window refresh and the normal queue mount fetch still work without storage. */ }
}
export function subscribePromiseActionability(tenantId: string | null | undefined, refresh: (reconciliation?: ReadyFinancialMutation) => void, queueWindow?: { overdueOnly: boolean; limit: number }) {
  const token = Symbol()
  if (queueWindow) mountedQueues.set(token, { tenantId, ...queueWindow })
  let pending = false
  function changed(changedTenant: unknown) {
    if (tenantId && changedTenant !== tenantId) return
    if (document.visibilityState === 'hidden') pending = true
    else refresh()
  }
  const local = (event: Event) => {
    const detail = (event as CustomEvent).detail
    if (detail && typeof detail === 'object' && detail.reconciliation) {
      if (tenantId && detail.tenantId !== tenantId) return
      if (document.visibilityState === 'hidden') pending = true
      else refresh(detail.reconciliation)
    } else changed(detail)
  }
  const remote = (event: StorageEvent) => {
    if (event.key !== STORAGE || !event.newValue) return
    try { changed(JSON.parse(event.newValue).tenantId) } catch { /* Ignore malformed storage. */ }
  }
  const visible = () => { if (pending && document.visibilityState !== 'hidden') { pending = false; refresh() } }
  window.addEventListener(EVENT, local)
  window.addEventListener('storage', remote)
  document.addEventListener('visibilitychange', visible)
  return () => {
    mountedQueues.delete(token)
    window.removeEventListener(EVENT, local); window.removeEventListener('storage', remote)
    document.removeEventListener('visibilitychange', visible)
  }
}
