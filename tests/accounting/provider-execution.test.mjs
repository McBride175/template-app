import assert from 'node:assert/strict'
import test from 'node:test'
import {loadTypeScriptModule} from '../xero/test-helpers/ts-module-loader.mjs'
const {AccountingAttemptController}=loadTypeScriptModule('lib/accounting/attempt-controller.ts')
test('one heartbeat serializes attempt then independent generation renewal through publication preparation',async()=>{
 const calls=[];let active=0,max=0
 const c=new AccountingAttemptController(async()=>{active++;max=Math.max(max,active);calls.push('attempt');await new Promise(r=>setTimeout(r,5));active--},10)
 c.attachProvider(async()=>{calls.push('generation')});c.start()
 await Promise.all([c.renewNow(),c.renewNow(),c.renewNow()]);await c.stop()
 assert.equal(max,1);assert.deepEqual(calls,['attempt','generation'])
})
for(const lost of ['attempt','generation'])test('loss of '+lost+' authority aborts outstanding work and prevents further renewal',async()=>{
 const calls=[],c=new AccountingAttemptController(async()=>{calls.push('attempt');if(lost==='attempt')throw new Error('lost')})
 c.attachProvider(async()=>{calls.push('generation');if(lost==='generation')throw new Error('lost')})
 await assert.rejects(c.renewNow());assert.equal(c.signal.aborted,true);assert.throws(()=>c.assertOwned())
 await assert.rejects(c.renewNow());assert.deepEqual(calls,lost==='attempt'?['attempt']:['attempt','generation']);await c.stop()
})
const ref={connectionId:'connection',ownerId:'owner',provider:'xero',providerOrganisationId:'org',epoch:'1'}
const job={id:'job',connection:ref,attemptId:'attempt',workerId:'worker',attemptNumber:1}
function harness(options={}) {
 const calls=[];let inspections=0
 const admin={rpc:async(name,args)=>{calls.push({name,args});if(name==='inspect_accounting_xero_result') {
   inspections++;if(options.lost) return {data:null,error:{code:'40001'}}
   return {data:{resultCode:options.committed||options.commitThenThrow&&inspections>1?'promoted':'unbound',runId:options.committed||inspections>1?'run':null},error:null}
 }if(name==='record_accounting_xero_diagnostics')return {data:true,error:null};throw new Error('unexpected RPC')}}
 const api=loadTypeScriptModule('lib/xero/accounting-refresh-execution.ts',{mocks:{
   '@sentry/nextjs':{captureMessage:()=>{}},
   '@/lib/accounting/connection-server':{resolveAccountingConnection:async()=>({connection:{...ref,...options.connection},health:options.health??'healthy'})},
   './generation-sync':{executeXeroAccountingGeneration:async p=>{
     calls.push({engine:true,p});if(options.commitThenThrow)throw new Error('response lost')
     if(options.lost){p.execution.importOptions.externalLease.cancel();throw new Error('authority lost')}
     return Response.json({code:options.code??'XERO_PROVIDER_UNAVAILABLE',retryAfterSeconds:options.retryAfterSeconds})
   }},
 }})
 const authority=new AccountingAttemptController(async()=>{calls.push({heartbeat:true})})
 return {api,calls,admin,authority,execute:()=>api.executeXeroAccountingRefresh({admin,job,authority,deadlineAtMs:Date.now()+10000,bookkeepingAtMs:Date.now()+20000})}
}
test('already committed exact run resumes preparing without another importer or provider fetch',async()=>{
 const h=harness({committed:true}),r=await h.execute();assert.equal(r.kind,'promoted');assert.equal(r.recovered,true);assert.ok(!h.calls.some(c=>c.engine));await h.authority.stop()
})
test('publication response loss inspects exact run instead of declaring failure or refetching',async()=>{
 const h=harness({commitThenThrow:true}),r=await h.execute();assert.equal(r.kind,'promoted');assert.equal(h.calls.filter(c=>c.engine).length,1);assert.equal(h.calls.filter(c=>c.name==='inspect_accounting_xero_result').length,2);await h.authority.stop()
})
test('foreign/stale connection fails before engine execution',async()=>{
 for(const connection of [{epoch:'2'},{connectionId:'foreign'}]){const h=harness({connection});assert.equal((await h.execute()).kind,'authority_lost');assert.ok(!h.calls.some(c=>c.engine));await h.authority.stop()}
})
test('known connection health prevents provider execution',async()=>{
 const h=harness({health:'reconnect_required'});assert.equal((await h.execute()).failureClass,'reconnect_required');assert.ok(!h.calls.some(c=>c.engine));await h.authority.stop()
})
const categories={XERO_REAUTH_REQUIRED:'reconnect_required',XERO_PERMISSION_UPGRADE_REQUIRED:'reconnect_required',XERO_RATE_LIMITED:'rate_limited',XERO_DAILY_LIMIT_REACHED:'quota_limited',XERO_PROVIDER_TIMEOUT:'transient',XERO_PROVIDER_UNAVAILABLE:'transient',XERO_SYNC_DEADLINE:'transient',XERO_PROVIDER_DATA_INVALID:'deterministic_failure',XERO_GENERATION_VALIDATION_FAILED:'deterministic_failure',XERO_GENERATION_PROMOTION_FAILED:'unknown',XERO_INTERNAL_FAILURE:'unknown'}
for(const [code,category] of Object.entries(categories))test('Xero failure '+code+' classifies as '+category,()=>{
 const h=harness();const r=h.api.classifyXeroRefreshFailure(code,7200);assert.equal(r.failureClass,category);assert.equal(r.retryAfterSeconds,7200);assert.equal(r.code,code.toLowerCase())
})
test('unsupported provider delegates no Xero engine work',async()=>{
 let called=false
 const api=loadTypeScriptModule('lib/accounting/provider-execution.ts',{mocks:{'@/lib/xero/accounting-refresh-execution':{executeXeroAccountingRefresh:async()=>{called=true}}}})
 const r=await api.executeAccountingProvider({job:{...job,connection:{...ref,provider:'future_provider'}}});assert.equal(r.failureClass,'deterministic_failure');assert.equal(called,false)
})
