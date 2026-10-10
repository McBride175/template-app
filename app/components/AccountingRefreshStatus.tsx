'use client'
import Button from './ui/Button'
import { accountingStatusPresentation } from '@/lib/accounting/status-presentation'
import { accountingWorkActive, type ProductAccountingStatus, type ProductRefreshResponse } from '@/lib/accounting/product-refresh'
export default function AccountingRefreshStatus({status,outcome,busy,error,onRefresh,onCheck,returnTo}:{
 status:ProductAccountingStatus|null;outcome?:ProductRefreshResponse|null;busy:boolean;error:string|null;onRefresh:()=>void;onCheck:()=>void;returnTo:string
}) {
 if(!status)return error?<p className="mb-4 text-sm text-gray-600">{error} <button onClick={onCheck} className="inline-flex min-h-11 items-center underline sm:min-h-0">Check status</button></p>:null
 const view=accountingStatusPresentation(status,outcome)
 const reconnectHref=`/api/${status.connection.provider}/connect?returnTo=${encodeURIComponent(returnTo+'?tenantId='+encodeURIComponent(status.connection.providerOrganisationId))}`
 return <section aria-label="Accounting status" aria-live="polite" className={view.warning
  ? 'mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3'
  : 'mb-3 border-b border-border-default py-1 sm:mb-5 sm:rounded-xl sm:border sm:border-gray-200 sm:bg-white sm:px-4 sm:py-3'}>
  <div className="flex flex-wrap items-center justify-between gap-3">
   <p className="text-sm font-medium text-gray-700">{busy?'Requesting refresh…':view.label}</p>
   {view.reconnect?<a className="inline-flex min-h-11 items-center text-sm font-semibold text-teal-800 underline sm:min-h-0" href={reconnectHref}>Reconnect {status.connection.displayName}</a>:<Button variant="secondary" size="sm" className="min-h-11 sm:min-h-0" disabled={busy} onClick={onRefresh}>{accountingWorkActive(status)?'Refreshing…':'Refresh'}</Button>}
  </div>
  {view.message && (view.warning ? <p className="mt-2 text-sm text-gray-600">{view.message}</p> : <>
   <p className="mt-2 hidden text-sm text-gray-600 sm:block">{view.message}</p>
   <details className="sm:hidden"><summary className="flex min-h-11 cursor-pointer items-center text-sm text-text-secondary focus-visible:outline-2 focus-visible:outline-focus">Refresh details</summary><p className="pb-2 text-sm text-text-secondary">{view.message}</p></details>
  </>)}
  {view.retryAt && <p className="mt-1 text-sm text-gray-600">Next retry: {new Date(view.retryAt).toLocaleTimeString()}</p>}
  {error && <p className="mt-2 text-sm text-gray-600">{error} <button onClick={onCheck} className="inline-flex min-h-11 items-center underline sm:min-h-0">Check status</button></p>}
 </section>
}
