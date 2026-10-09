'use client'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { accountingProductSurface } from '@/lib/accounting/product-refresh'
import { signalProductAccountingActivity, useAccountingRefresh } from './accounting-refresh-client'
import AccountingRefreshStatus from './AccountingRefreshStatus'
export default function AccountingActivityBoundary() {
 const pathname=usePathname(), params=useSearchParams(),requestedOrganisation=params.get('tenantId')
 const [observedOrganisation,setObservedOrganisation]=useState<string|null>(null)
 useEffect(()=>{
  const ready=(event:Event)=>{const org=(event as CustomEvent<{organisationId?:string}>).detail?.organisationId;if(org)setObservedOrganisation(org)}
  window.addEventListener('accounting-scope',ready)
  return()=>window.removeEventListener('accounting-scope',ready)
 },[])
 const organisation=requestedOrganisation??observedOrganisation
 const surface=accountingProductSurface(pathname),enabled=Boolean(surface)||pathname==='/account'
 // Only mount the observer on product surfaces; public pages never signal.
 return enabled?<ActiveAccountingBoundary key={organisation??'default'} pathname={pathname} organisation={organisation} surface={surface} reconnect={params.get('xero')==='connected'&&Boolean(requestedOrganisation)}/>:null
}
function ActiveAccountingBoundary({pathname,organisation,surface,reconnect}:{pathname:string;organisation:string|null;surface:string|null;reconnect:boolean}) {
 const refresh=useAccountingRefresh(organisation),request=refresh.request,reconnectSignalled=useRef(false)
 useEffect(()=>{if(reconnect&&organisation&&!reconnectSignalled.current){reconnectSignalled.current=true;void request('reconnect')}},[reconnect,organisation,request])
 useEffect(()=>{
  if(!surface)return
  const signal=(event?:Event)=>{if(document.visibilityState!=='visible')return;const observed=(event as CustomEvent<{organisationId?:string}>|undefined)?.detail?.organisationId;void signalProductAccountingActivity(observed??organisation,surface).then(result=>{if(result)window.dispatchEvent(new Event('accounting-check'))}).catch(()=>{})}
  const interaction=(event:Event)=>{
   const target=event.target as Element|null
   if(event.isTrusted && target?.closest('main') && !target.closest('[aria-label="Accounting status"]'))signal()
  }
  document.addEventListener('click',interaction)
  // Dashboard explicitly signals after useful bootstrap content has rendered.
  if(surface==='dashboard'){window.addEventListener('accounting-product-ready',signal);return()=>{window.removeEventListener('accounting-product-ready',signal);document.removeEventListener('click',interaction)}}
  const timer=setTimeout(signal,0)
  return()=>{clearTimeout(timer);document.removeEventListener('click',interaction)}
 },[surface,organisation,pathname])
 return <AccountingRefreshStatus {...refresh} onRefresh={()=>void refresh.request('manual',surface??'account')} onCheck={refresh.check} returnTo={pathname}/>
}
