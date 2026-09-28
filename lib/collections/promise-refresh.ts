/** Financial Promise changes require a fresh portfolio ranking, never a local score patch. */
const EVENT = 'yuohme:promise-actionability-changed'
const STORAGE = 'yuohme:promise-actionability'
export function notifyPromiseActionabilityChanged(tenantId: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: tenantId }))
  try { window.localStorage.setItem(STORAGE, JSON.stringify({ tenantId, nonce: crypto.randomUUID() })) }
  catch { /* Same-window refresh and the normal queue mount fetch still work without storage. */ }
}
export function subscribePromiseActionability(tenantId: string | null | undefined, refresh: () => void) {
  let pending = false
  function changed(changedTenant: unknown) {
    if (tenantId && changedTenant !== tenantId) return
    if (document.visibilityState === 'hidden') pending = true
    else refresh()
  }
  const local = (event: Event) => changed((event as CustomEvent).detail)
  const remote = (event: StorageEvent) => {
    if (event.key !== STORAGE || !event.newValue) return
    try { changed(JSON.parse(event.newValue).tenantId) } catch { /* Ignore malformed storage. */ }
  }
  const visible = () => { if (pending && document.visibilityState !== 'hidden') { pending = false; refresh() } }
  window.addEventListener(EVENT, local)
  window.addEventListener('storage', remote)
  document.addEventListener('visibilitychange', visible)
  return () => {
    window.removeEventListener(EVENT, local); window.removeEventListener('storage', remote)
    document.removeEventListener('visibilitychange', visible)
  }
}
