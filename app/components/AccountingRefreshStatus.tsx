'use client'
import Button from './ui/Button'
import { accountingStatusPresentation } from '@/lib/accounting/status-presentation'
import { accountingWorkActive, type ProductAccountingStatus, type ProductRefreshResponse } from '@/lib/accounting/product-refresh'
export default function AccountingRefreshStatus({status,outcome,busy,error,onRefresh,onCheck,returnTo}:{
 status:ProductAccountingStatus|null;outcome?:ProductRefreshResponse|null;busy:boolean;error:string|null;onRefresh:()=>void;onCheck:()=>void;returnTo:string
}) {
 if(!status)return error?<p className="mb-4 text-sm text-gray-600">{error} <button onClick={onCheck} className="underline">Check status</button></p>:null
 const view=accountingStatusPresentation(status,outcome)
 const reconnectHref=`/api/${status.connection.provider}/connect?returnTo=${encodeURIComponent(returnTo+'?tenantId='+encodeURIComponent(status.connection.providerOrganisationId))}`
 return <section aria-label="Accounting status" aria-live="polite" className={`mb-5 rounded-xl border px-4 py-3 ${view.warning?'border-amber-200 bg-amber-50':'border-gray-200 bg-white'}`}>
  <div className="flex flex-wrap items-center justify-between gap-3">
   <p className="text-sm font-medium text-gray-700">{busy?'Requesting refresh…':view.label}</p>
   {view.reconnect?<a className="text-sm font-semibold text-teal-800 underline" href={reconnectHref}>Reconnect {status.connection.displayName}</a>:<Button variant="secondary" size="sm" disabled={busy} onClick={onRefresh}>{accountingWorkActive(status)?'Refreshing…':'Refresh'}</Button>}
  </div>
  {view.message && <p className="mt-2 text-sm text-gray-600">{view.message}</p>}
  {view.retryAt && <p className="mt-1 text-sm text-gray-600">Next retry: {new Date(view.retryAt).toLocaleTimeString()}</p>}
  {error && <p className="mt-2 text-sm text-gray-600">{error} <button onClick={onCheck} className="underline">Check status</button></p>}
 </section>
}
