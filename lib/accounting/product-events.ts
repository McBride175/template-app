/** Optional browser observations must never turn a successful product read into
 * a failed read. They carry owned scope only, never accounting or worker authority. */
export function notifyAccountingScope(organisationId: string | null | undefined) {
 if(typeof window==='undefined'||!organisationId||typeof window.CustomEvent!=='function')return
 window.dispatchEvent(new window.CustomEvent('accounting-scope',{detail:{organisationId}}))
}
export function subscribeAccountingUpdates(updated:()=>void) {
 if(typeof window==='undefined'||!window?.addEventListener)return ()=>{}
 window.addEventListener('accounting-updated',updated)
 return ()=>window.removeEventListener('accounting-updated',updated)
}
