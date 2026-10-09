import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'
const domain=loadTypeScriptModule('lib/accounting/product-refresh.ts')
const presentation=loadTypeScriptModule('lib/accounting/status-presentation.ts')
const scope={connectionId:'00000000-0000-4000-8000-000000000001',ownerId:'00000000-0000-4000-8000-000000000002',provider:'xero',providerOrganisationId:'org',epoch:'1'}
const job={id:'00000000-0000-4000-8000-000000000003',connection:scope,phase:'queued',stage:'accounting',trigger:'manual',latestTrigger:'manual',requestCount:'1',requestedAt:'2026-10-08T12:00:00Z',lastRequestedAt:'2026-10-08T12:00:00Z',nextEligibleAt:'2026-10-08T12:00:00Z',attemptNumber:0,retryCount:0}
function service({health='healthy',outcome='started',provider='xero',foreign=false,dispatchFails=false}={}) {
 const calls=[]
 const admin={from(){return {select(){return this},eq(){return this},limit:async()=>({data:[{tenant_id:'org'}],error:null})}},rpc:async(name,args)=>{calls.push({name,args});return {data:{outcome,job:{...job,connection:{...scope,ownerId:foreign?'00000000-0000-4000-8000-000000000009':scope.ownerId}},nextEligibleAt:null},error:null}}}
 const api=loadTypeScriptModule('lib/accounting/product-refresh-server.ts',{mocks:{
 '@/lib/accounting/connection-server':{resolveAccountingConnection:async args=>{calls.push({resolve:args});return {connection:scope,health}}},
 '@/lib/accounting/dispatch-server':{dispatchAccountingRefresh:async()=>{calls.push({dispatch:true});if(dispatchFails)throw new Error('transport unavailable')},accountingTransportEvent(){}},
 '@/lib/supabase-admin':{createSupabaseAdminClient:()=>admin},'@/lib/supabase-server':{createServerSupabaseClient:async()=>({auth:{getUser:async()=>({data:{user:{id:scope.ownerId}},error:null})}})},
 '@/lib/accounting/refresh-server':{},
 }})
 return {api,admin,calls,provider}
}
for(const trigger of ['opportunistic','manual','onboarding','reconnect'])test(`${trigger}: owned acceptance is followed by optional dispatch, without billing/provider work`,async()=>{
 const h=service();const r=await h.api.requestProductAccountingRefresh({provider:'xero',providerOrganisationId:'org'},trigger,'stable')
 assert.equal(r.jobId,job.id);assert.equal(r.outcome,'started');assert.equal(h.calls.find(c=>c.name).args.p_user_id,scope.ownerId)
 assert.equal(h.calls.find(c=>c.name).name,'accept_product_accounting_refresh');assert.ok(h.calls.some(c=>c.dispatch))
 assert.doesNotMatch(JSON.stringify(r),/ownerId|epoch|worker|attempt|token|secret/)
})
for(const trigger of ['scheduled','internal','fake'])test(`browser trigger ${trigger} rejected before authority resolution`,()=>{
 const h=service();assert.throws(()=>h.api.productRefreshTrigger(trigger),e=>e.code==='invalid_input');assert.equal(h.calls.length,0)
})
for(const health of ['reconnect_required','disconnected','attention_required'])test(`${health} accepts no work`,async()=>{
 const h=service({health});const r=await h.api.requestProductAccountingRefresh({provider:'xero',providerOrganisationId:'org'},'manual');assert.equal(r.jobId,null);assert.ok(!h.calls.some(c=>c.name||c.dispatch))
})
test('missed immediate signal preserves acknowledged durable work',async()=>{const h=service({dispatchFails:true});assert.equal((await h.api.requestProductAccountingRefresh({provider:'xero',providerOrganisationId:'org'},'manual')).jobId,job.id)})
test('foreign returned scope fails closed',async()=>{const h=service({foreign:true});await assert.rejects(h.api.requestProductAccountingRefresh({provider:'xero',providerOrganisationId:'org'},'manual'),e=>e.code==='unavailable');assert.ok(!h.calls.some(c=>c.dispatch))})
test('different providers never masquerade as Xero',async()=>{const h=service();await assert.rejects(h.api.requestProductAccountingRefresh({provider:'quickbooks',providerOrganisationId:'org'},'manual'),e=>e.code==='unsupported_provider')})
const status=(phase='complete',band='fresh',health='healthy')=>({connection:{provider:'xero',providerOrganisationId:'org',epoch:'secret-epoch',health},accounting:{state:'valid',accountingObservedAt:'2026-10-08T12:00:00Z',ageSeconds:3600,freshness:band,derivatives:{state:'ready'}},work:{phase,stage:phase==='preparing'?'derivatives':'accounting',jobId:'job',attemptNumber:3,heartbeatAt:'private',retryCount:2,preparationRetryCount:1},failure:null})
test('public projection excludes internal attempt/epoch/heartbeat state',()=>{const r=domain.productAccountingStatus(status());assert.doesNotMatch(JSON.stringify(r),/epoch|attempt|heartbeat|retryCount|preparationRetryCount/);assert.equal(r.connection.displayName,'Xero')})
for(const band of ['fresh','aging_usable','materially_stale','very_stale','extended_stale'])test(`${band}: valid accounting remains usable, warning starts only at material staleness`,()=>{
 const s=domain.productAccountingStatus(status('complete',band));const v=presentation.accountingStatusPresentation(s)
 assert.equal(v.warning,['materially_stale','very_stale','extended_stale'].includes(band));assert.equal(domain.accountingFirstValueReady(s),true)
 if(v.warning)assert.match(v.message,/Payments made since then/)
})
for(const phase of ['queued','running','preparing','retry_wait','attention_required','reconnect_required'])test(`onboarding is not ready at ${phase} even if a generation exists`,()=>assert.equal(domain.accountingFirstValueReady(domain.productAccountingStatus(status(phase))),false))
test('onboarding waits for exact derivative readiness',()=>{const s=domain.productAccountingStatus(status());s.accounting.derivatives.state='preparing';assert.equal(domain.accountingFirstValueReady(s),false)})
test('provider display name comes from connection metadata',()=>{const s=domain.productAccountingStatus(status('idle','fresh','reconnect_required'));s.connection.displayName='Sage';assert.match(presentation.accountingStatusPresentation(s).label,/Reconnect Sage/)})
for(const [path,surface] of [['/dashboard','dashboard'],['/collections/actions','priorities'],['/customers','customers'],['/customers/customer/history','customers'],['/disputes','disputes'],['/account',null],['/start',null],['/api/accounting/refresh-status',null],['/pricing',null]])test(`activity surface ${path}`,()=>assert.equal(domain.accountingProductSurface(path),surface))
function http(trigger='manual',options={}) {
 const requests=[]
 const api=loadTypeScriptModule('lib/accounting/product-refresh-http.ts',{mocks:{
 'next/server':{NextResponse:{json:(body,init={})=>new Response(JSON.stringify(body),{status:init.status??200})}},
 '@/lib/accounting/product-refresh-server':{productRefreshTrigger:v=>{if(!['manual','opportunistic','onboarding','reconnect'].includes(v))throw Object.assign(new Error(),{code:'invalid_input'});return v},requestProductAccountingRefresh:async(...args)=>{requests.push(args);return {outcome:'started',phase:'queued',jobId:'opaque'}},readProductAccountingStatus:async()=>domain.productAccountingStatus(status())},
 }})
 const request=new Request('https://test.example/api/accounting/refresh',{method:'POST',headers:{origin:options.origin??'https://test.example','content-type':'application/json'},body:JSON.stringify({trigger,...options.body})})
 return {api,request,requests}
}
for(const key of ['ownerId','jobId','connectionEpoch','workerMode','generation','attemptId','secret'])test(`forged ${key} rejected by product HTTP parser`,async()=>{const h=http('manual',{body:{[key]:'forged'}});assert.equal((await h.api.accountingRefreshPost(h.request)).status,400);assert.equal(h.requests.length,0)})
test('cross-origin refresh denied',async()=>{const h=http('manual',{origin:'https://evil.example'});assert.equal((await h.api.accountingRefreshPost(h.request)).status,403)})
test('accepted HTTP request returns acknowledgement only',async()=>{const h=http();assert.equal((await h.api.accountingRefreshPost(h.request)).status,202);assert.equal(h.requests.length,1)})
test('product/compatibility endpoints contain no direct provider or billing calls',()=>{
 for(const p of ['app/api/accounting/refresh/route.ts','app/api/accounting/refresh-status/route.ts','app/api/xero/sync/route.ts','app/api/xero/sync/auto/route.ts','lib/accounting/product-refresh-server.ts'])assert.doesNotMatch(readFileSync(p,'utf8'),/syncXeroAuthoritatively|importXeroGeneration|claimActionsEntitlementStatus|claim_billing_usage_day/)
})
function ownedHttp({signedOut=false,foreign=false}={}) {
 let reads=0
 const admin={from(){reads++;return {select(){return this},eq(){return this},maybeSingle:async()=>({data:null,error:null})}}}
 const api=loadTypeScriptModule('lib/accounting/product-refresh-http.ts',{mocks:{
  'next/server':{NextResponse:{json:(body,init={})=>new Response(JSON.stringify(body),{status:init.status??200})}},
  '@/lib/supabase-server':{createServerSupabaseClient:async()=>({auth:{getUser:async()=>({data:{user:signedOut?null:{id:foreign?'00000000-0000-4000-8000-000000000009':scope.ownerId}},error:null})}})},
  '@/lib/supabase-admin':{createSupabaseAdminClient:()=>admin},
 }})
 return {api,get reads(){return reads}}
}
for(const method of ['post','status'])test(`${method}: unauthenticated cannot observe or accept accounting work`,async()=>{
 const h=ownedHttp({signedOut:true});const r=method==='post'?await h.api.accountingRefreshPost(new Request('https://test.example/api/accounting/refresh',{method:'POST',headers:{origin:'https://test.example','content-type':'application/json'},body:JSON.stringify({trigger:'manual',provider:'xero',providerOrganisationId:'org'})})):await h.api.accountingRefreshStatusGet(new Request('https://test.example/api/accounting/refresh-status?provider=xero&providerOrganisationId=org'))
 assert.equal(r.status,401);assert.equal(h.reads,0)
})
for(const method of ['post','status'])test(`${method}: foreign or missing organisation has no scope fallback`,async()=>{
 const h=ownedHttp({foreign:true});const r=method==='post'?await h.api.accountingRefreshPost(new Request('https://test.example/api/accounting/refresh',{method:'POST',headers:{origin:'https://test.example','content-type':'application/json'},body:JSON.stringify({trigger:'manual',provider:'xero',providerOrganisationId:'org'})})):await h.api.accountingRefreshStatusGet(new Request('https://test.example/api/accounting/refresh-status?provider=xero&providerOrganisationId=org'))
 assert.equal(r.status,404);assert.equal(h.reads,1)
})
test('fresh, materially stale and reconnect UI use the same status component without blocking valid content',async()=>{
 const React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server')
 const {default:Component}=loadTypeScriptModule('app/components/AccountingRefreshStatus.tsx')
 for(const [band,health] of [['fresh','healthy'],['materially_stale','healthy'],['very_stale','healthy'],['extended_stale','healthy'],['fresh','reconnect_required']]){
  const html=renderToStaticMarkup(React.createElement(Component,{status:domain.productAccountingStatus(status('complete',band,health)),busy:false,error:null,onRefresh(){},onCheck(){},returnTo:'/dashboard'}))
  assert.match(html,/aria-label="Accounting status"/)
  if(band==='fresh'&&health==='healthy'){assert.match(html,/Updated/);assert.doesNotMatch(html,/Payments made since then|bg-amber/)}
  if(band!=='fresh'){assert.match(html,/Payments made since then/);assert.doesNotMatch(html,/disabled=/)}
  if(health==='reconnect_required')assert.match(html,/Reconnect Xero/)
 }
})
