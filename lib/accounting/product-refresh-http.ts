import 'server-only'
import { NextResponse } from 'next/server'
import { AccountingControlError } from './control-server'
import { productRefreshTrigger, readProductAccountingStatus, requestProductAccountingRefresh } from '@/lib/accounting/product-refresh-server'
import type { ProductRefreshTrigger } from './product-refresh'
export function accountingProductError(error: unknown) {
 const code = error instanceof AccountingControlError ? error.code : 'unavailable'
 const status = code==='unauthorized'?401:code==='not_found'?404:code==='invalid_input'||code==='unsupported_provider'?400:code==='conflict'?409:503
 return NextResponse.json({error:status===401?'Sign in to check accounting.':status===404?'Accounting connection not found.':status===409?'Choose an accounting organisation.':'Accounting refresh is temporarily unavailable.'},{status,headers:{'Cache-Control':'no-store'}})
}
export async function accountingRefreshPost(request: Request, compatibility?: ProductRefreshTrigger) {
 try {
  const origin=request.headers.get('origin')
  if (!origin || new URL(origin).origin!==new URL(request.url).origin || !request.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({error:'Invalid request origin'},{status:403})
  const payload=await request.json()
  if (!payload || typeof payload!=='object' || Array.isArray(payload)) throw new AccountingControlError('invalid_input')
  const allowed=compatibility?['tenantId','surface','retry']:['provider','providerOrganisationId','trigger','idempotencyKey','surface']
  if(Object.keys(payload).some(key=>!allowed.includes(key))) throw new AccountingControlError('invalid_input')
  const provider=compatibility?'xero':payload.provider
  const org=compatibility?payload.tenantId:payload.providerOrganisationId
  if(provider!==undefined && typeof provider!=='string' || org!=null && typeof org!=='string' || payload.idempotencyKey!==undefined && typeof payload.idempotencyKey!=='string') throw new AccountingControlError('invalid_input')
  const trigger=compatibility??productRefreshTrigger(payload.trigger)
  const surface=['dashboard','priorities','customers','disputes','account','start'].includes(payload.surface)?payload.surface:undefined
  const result=await requestProductAccountingRefresh({provider,providerOrganisationId:org??undefined},trigger,payload.idempotencyKey,surface)
  return NextResponse.json({ok:true,...result},{status:result.outcome==='started'?202:200,headers:{'Cache-Control':'no-store'}})
 }catch(error){return accountingProductError(error)}
}
export async function accountingRefreshStatusGet(request: Request) {
 try {
  const params=new URL(request.url).searchParams
  if([...params.keys()].some(key=>!['provider','providerOrganisationId'].includes(key))) throw new AccountingControlError('invalid_input')
  const status=await readProductAccountingStatus({provider:params.get('provider')??undefined,providerOrganisationId:params.get('providerOrganisationId')??undefined})
  return NextResponse.json({ok:true,status},{headers:{'Cache-Control':'no-store'}})
 }catch(error){return accountingProductError(error)}
}
