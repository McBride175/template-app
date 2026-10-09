'use client'
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/app/components/ui/Button'
import { useAccountingRefresh } from '@/app/components/accounting-refresh-client'
import { accountingFirstValueReady } from '@/lib/accounting/product-refresh'
import { accountingStatusPresentation } from '@/lib/accounting/status-presentation'
import { buildXeroConnectPath } from '@/lib/xero/oauth-return'
import type { XeroConnectionStatus } from '@/lib/xero/account-status'
export default function FirstValuePreparation({tenantId,initialStatus}:{tenantId:string;initialStatus:XeroConnectionStatus}) {
 const router=useRouter(),refresh=useAccountingRefresh(tenantId),requested=useRef<string|null>(null)
 const request=refresh.request
 useEffect(()=>{
  if(requested.current===tenantId)return
  requested.current=tenantId
  void request('onboarding','start')
 },[tenantId,request])
 useEffect(()=>{
  if(accountingFirstValueReady(refresh.status))router.replace(`/start/result?tenantId=${encodeURIComponent(tenantId)}`)
 },[refresh.status,router,tenantId])
 const view=refresh.status?accountingStatusPresentation(refresh.status,refresh.outcome):null
 return <div className="min-h-[calc(100vh-10rem)] py-8 sm:py-12"><section className="mx-auto max-w-xl rounded-3xl border border-gray-200 bg-white p-7 shadow-sm sm:p-10">
  <p className="text-sm font-medium text-teal-800">{initialStatus.tenantName?'Connected — '+initialStatus.tenantName:'Accounting connected'}</p>
  <h1 className="mt-4 text-3xl font-semibold tracking-tight text-gray-900">Preparing your chase priorities</h1>
  <p className="mt-4 text-gray-600" aria-live="polite">{view?.label??'Connecting to your saved accounting state…'}</p>
  {view?.message && <p className="mt-3 text-sm text-gray-600">{view.message}</p>}
  {view?.retryAt && <p className="mt-3 text-sm text-gray-600">We’ll retry at {new Date(view.retryAt).toLocaleTimeString()}.</p>}
  {view?.reconnect?<a className="mt-6 inline-block font-semibold text-teal-800 underline" href={buildXeroConnectPath(`/start?tenantId=${encodeURIComponent(tenantId)}`)}>Reconnect {refresh.status?.connection.displayName}</a>:null}
  {refresh.error && <p className="mt-4 text-sm text-gray-600">{refresh.error}</p>}
  <Button variant="secondary" className="mt-6" onClick={refresh.check}>Check status</Button>
  <p className="mt-7 text-sm text-gray-500">You can leave this page. Accounting refresh and preparation continue in the background. Returning will check the saved progress.</p>
 </section></div>
}
