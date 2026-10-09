'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { accountingWorkActive, type ProductAccountingStatus, type ProductRefreshResponse, type ProductRefreshTrigger } from '@/lib/accounting/product-refresh'
const activityAt=new Map<string,number>(), activityFlights=new Map<string,Promise<ProductRefreshResponse|null>>()
export async function postAccountingRefresh(trigger: ProductRefreshTrigger, organisation?: string | null, surface?: string, idempotencyKey?: string) {
 const response=await fetch('/api/accounting/refresh',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({trigger,provider:'xero',providerOrganisationId:organisation??undefined,surface,idempotencyKey})})
 const payload=await response.json()
 if(!response.ok || !payload.ok) throw new Error('Accounting refresh is temporarily unavailable.')
 return payload as ProductRefreshResponse
}
/** Browser traffic reduction only. Database policy/coalescing remain authoritative. */
export function signalProductAccountingActivity(organisation: string | null, surface: string, now=Date.now()) {
 const key=organisation??'selected'
 if(activityFlights.has(key)) return activityFlights.get(key)!
 if(now-(activityAt.get(key)??-Infinity)<30_000) return Promise.resolve(null)
 activityAt.set(key,now)
 const flight=postAccountingRefresh('opportunistic',organisation,surface).finally(()=>activityFlights.delete(key))
 activityFlights.set(key,flight)
 return flight
}
export function useAccountingRefresh(organisation?: string | null) {
 const [status,setStatus]=useState<ProductAccountingStatus|null>(null),[outcome,setOutcome]=useState<ProductRefreshResponse|null>(null)
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
 const live=useRef<{controller:AbortController;timer:ReturnType<typeof setTimeout>|null;until:number;generation:string|null}|null>(null)
 const loadRef=useRef<()=>Promise<void>>(async()=>{})
 useEffect(()=>{
  const held={controller:new AbortController(),timer:null as ReturnType<typeof setTimeout>|null,until:Date.now()+300_000,generation:null as string|null}
  live.current=held;setStatus(null);setOutcome(null);setError(null)
  let sequence=0
  const load=async()=>{
   const requestSequence=++sequence,observedAt=performance.now()
   if(held.timer)clearTimeout(held.timer)
   try {
    const query=new URLSearchParams({provider:'xero'});if(organisation)query.set('providerOrganisationId',organisation)
    const response=await fetch('/api/accounting/refresh-status?'+query,{credentials:'include',cache:'no-store',signal:held.controller.signal})
    if([401,404].includes(response.status))return
    if(response.status===409){setError('Choose an accounting organisation in Account.');return}
    const payload=await response.json()
    if(!response.ok || !payload.ok)throw new Error('Could not check accounting status.')
    if(held.controller.signal.aborted || requestSequence!==sequence)return
    const next=payload.status as ProductAccountingStatus
    console.info('[accounting.refresh.client]',{event:'status_observed',phase:next.work.phase,freshness:next.accounting.freshness,durationMs:Math.round(performance.now()-observedAt)})
    const generation=next.accounting.activeGenerationId
    if(next.work.phase==='complete' && held.generation && generation!==held.generation)window.dispatchEvent(new Event('accounting-updated'))
    if(!held.generation || next.work.phase==='complete')held.generation=generation
    setStatus(next);setError(null)
    if((accountingWorkActive(next)||next.work.phase==='retry_wait') && Date.now()<held.until && document.visibilityState==='visible')held.timer=setTimeout(()=>void load(),5000)
   }catch{if(!held.controller.signal.aborted&&requestSequence===sequence){setError('Could not check accounting status. Your saved data is unchanged.');if(Date.now()<held.until && document.visibilityState==='visible')held.timer=setTimeout(()=>void load(),5000)}}
  }
  loadRef.current=load;void load()
  const visible=()=>{if(document.visibilityState==='visible'){held.until=Date.now()+300_000;void load()}else if(held.timer)clearTimeout(held.timer)}
  const check=()=>{held.until=Date.now()+300_000;void load()}
  window.addEventListener('accounting-check',check);document.addEventListener('visibilitychange',visible)
  return()=>{held.controller.abort();if(held.timer)clearTimeout(held.timer);window.removeEventListener('accounting-check',check);document.removeEventListener('visibilitychange',visible);if(live.current===held)live.current=null}
 },[organisation])
 const request=useCallback(async(trigger:ProductRefreshTrigger,surface?:string)=>{
  if(busy)return null
  setBusy(true);setError(null)
  const held=live.current
  try {
   const acceptedAt=performance.now()
   const result=await postAccountingRefresh(trigger,organisation,surface,crypto.randomUUID())
   console.info('[accounting.refresh.client]',{event:'accepted',trigger,outcome:result.outcome,jobId:result.jobId,durationMs:Math.round(performance.now()-acceptedAt)})
   if(held!==live.current || held?.controller.signal.aborted)return null
   setOutcome(result)
   if(['queued','running','preparing','retry_wait'].includes(result.phase))setStatus(current=>current?{...current,work:{...current.work,phase:result.phase,jobId:result.jobId,stage:result.phase==='preparing'?'derivatives':result.outcome==='started'?'accounting':current.work.stage}}:current)
   if(held){held.until=Date.now()+300_000;if(held.timer)clearTimeout(held.timer);held.timer=setTimeout(()=>void loadRef.current(),2000)}
   return result
  }catch{if(held===live.current)setError('Refresh is temporarily unavailable. Try checking the status again.');return null}
  finally{if(held===live.current)setBusy(false)}
 },[busy,organisation])
 return {status,outcome,busy,error,request,check:()=>void loadRef.current()}
}
