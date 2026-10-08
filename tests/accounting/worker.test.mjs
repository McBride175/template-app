import assert from 'node:assert/strict'
import test from 'node:test'
import {createHmac} from 'node:crypto'
import {loadTypeScriptModule} from '../xero/test-helpers/ts-module-loader.mjs'
const {handleAccountingRefreshWorker:handle}=loadTypeScriptModule('lib/accounting/worker-server.ts')
const {signalAccountingRefresh}=loadTypeScriptModule('lib/accounting/dispatch-server.ts')
const id='00000000-0000-4000-8000-000000000001',token='00000000-0000-4000-8000-000000000002'
const ref={connectionId:id,ownerId:id,provider:'foundation_certification',providerOrganisationId:'fixture',epoch:'1'}
const base={id,connection:ref,phase:'queued',stage:'accounting',trigger:'internal',latestTrigger:'internal',priority:30,requestCount:'1',requestedAt:'2026-10-08T00:00:00Z',lastRequestedAt:'2026-10-08T00:00:00Z',nextEligibleAt:'2026-10-08T00:00:00Z',attemptNumber:0,retryCount:0,deliveryId:token,attemptId:null,workerId:null}
const project='rbmxegyiwntomhpbepnu',secret='test-only-not-production-'.repeat(3)
const env={ACCOUNTING_REFRESH_INTERNAL_SECRET:secret,ACCOUNTING_REFRESH_SYNTHETIC_ENABLED:'1',VERCEL_ENV:'preview',NEXT_PUBLIC_SUPABASE_URL:`https://${project}.supabase.co`}
function request(options={}){const b=options.body??{jobId:id,deliveryId:token};const mac=createHmac('sha256',options.secret??secret).update(`${options.project??project}:${b.jobId}:${b.deliveryId}`).digest('hex');return new Request('https://fixture.vercel.app/api/internal/accounting/refresh-worker',{method:options.method??'POST',headers:{authorization:'Bearer '+mac,'content-type':'application/json','x-accounting-project-ref':options.project??project},...(options.method==='GET'?{}:{body:JSON.stringify(b)})})}
function fixture(options={}){let job={...base,...(options.prep?{connection:{...ref,provider:'xero'},stage:'derivatives',generationRunId:id}:options.real?{connection:{...ref,provider:'xero'}}:{})},active=0,maxActive=0;const calls=[]
 const admin={rpc:async(name,args)=>{calls.push({name,args})
 if(name==='load_accounting_refresh_delivery')return {data:options.missing?null:{projectRef:options.project??project,job:{...job,...options.job},...(options.prep?{mode:'preparation'}:options.real?{mode:'xero'}:{mode:'synthetic',synthetic:{scenario:options.scenario??'complete',delaySeconds:options.delay??0}})},error:null}
 if(name==='claim_accounting_refresh_attempt'){job={...job,phase:options.prep?'preparing':'running',attemptNumber:1,attemptId:id,workerId:args.p_worker_id};return {data:{claimed:!options.duplicate,resultCode:options.duplicate?'attempt_held':'claimed',job},error:null}}
 if(name==='heartbeat_accounting_refresh_attempt'){active++;maxActive=Math.max(active,maxActive);await new Promise(r=>setTimeout(r,options.hbDelay??1));active--;return {data:job,error:options.lost?{code:'40001'}:null}}
 if(name==='record_accounting_refresh_worker_event')return {data:{},error:null}
 if(name==='update_accounting_refresh_attempt'){job={...job,phase:args.p_operation==='complete'?'complete':args.p_failure_class==='transient'?'retry_wait':'attention_required'};return {data:job,error:null}}
 if(name==='dispatch_accounting_refresh')return {data:{resultCode:'idle',submitted:0},error:null}
 throw new Error('unexpected RPC '+name)}}
 return {admin,calls,get maxActive(){return maxActive}}
}
test('GET rejects before accessing database',async()=>{const f=fixture();assert.equal((await handle(request({method:'GET'}),{admin:f.admin,environment:env})).status,405);assert.equal(f.calls.length,0)})
for(const bad of ['', 'wrong'])test('wrong/missing internal auth rejects '+JSON.stringify(bad),async()=>{const f=fixture();assert.equal((await handle(request({secret:bad}),{admin:f.admin,environment:env})).status,401);assert.equal(f.calls.length,0)})
for(const changes of [{VERCEL_ENV:'production'},{ACCOUNTING_REFRESH_SYNTHETIC_ENABLED:'0'},{NEXT_PUBLIC_SUPABASE_URL:'https://sswyxbugbdoadktyaows.supabase.co'},{NEXT_PUBLIC_SUPABASE_URL:`https://${project}.evil.example`}])test('environment fence rejects '+JSON.stringify(changes),async()=>{const f=fixture();assert.equal((await handle(request(),{admin:f.admin,environment:{...env,...changes}})).status,403);assert.equal(f.calls.length,0)})
test('wrong project header rejects',async()=>{const f=fixture();assert.equal((await handle(request({project:'foreign'}),{admin:f.admin,environment:env})).status,403)})
for(const body of [{jobId:id,deliveryId:'bad'},{jobId:id,deliveryId:token,ownerId:id}])test('invalid body rejects '+JSON.stringify(body),async()=>{const f=fixture();assert.equal((await handle(request({body}),{admin:f.admin,environment:env})).status,400)})
for(const options of [{missing:true},{project:'foreign'},{job:{id:token}},{job:{connection:{...ref,provider:'xero'}}},{delay:41}])test('invalid/foreign/unmarked delivery rejects '+JSON.stringify(options),async()=>{const f=fixture(options);assert.equal((await handle(request(),{admin:f.admin,environment:env})).status,409);assert.ok(!f.calls.some(c=>c.name==='claim_accounting_refresh_attempt'))})
test('success claims once, completes and signals dispatcher without provider work',async()=>{const f=fixture();assert.equal((await handle(request(),{admin:f.admin,environment:env})).status,200);assert.equal(f.calls.filter(c=>c.name==='claim_accounting_refresh_attempt').length,1);assert.ok(f.calls.some(c=>c.name==='update_accounting_refresh_attempt'&&c.args.p_operation==='complete'));assert.ok(f.calls.some(c=>c.name==='dispatch_accounting_refresh'))})
test('duplicate delivery executes nothing',async()=>{const f=fixture({duplicate:true});assert.equal((await handle(request(),{admin:f.admin,environment:env})).status,202);assert.ok(!f.calls.some(c=>c.name.includes('update_')||c.name.includes('heartbeat_')))})
test('retryable failure uses shared persisted policy; deterministic failure pauses',async()=>{for(const scenario of ['retry_once','attention']){const f=fixture({scenario});assert.equal((await handle(request(),{admin:f.admin,environment:env})).status,200);const failure=f.calls.find(c=>c.name==='update_accounting_refresh_attempt');assert.equal(failure.args.p_failure_class,scenario==='attention'?'deterministic_failure':'transient');assert.equal(failure.args.p_retry_at===null,scenario==='attention')}})
test('disappearance retains lease without outcome transition',async()=>{const f=fixture({scenario:'disappear'});assert.equal((await handle(request(),{admin:f.admin,environment:env})).status,202);assert.ok(!f.calls.some(c=>c.name==='update_accounting_refresh_attempt'))})
test('heartbeat does not overlap; lost authority never completes',async()=>{
 const f=fixture({delay:1,hbDelay:40});assert.equal((await handle(request(),{admin:f.admin,environment:env,heartbeatMs:10})).status,200);assert.equal(f.maxActive,1);assert.ok(f.calls.some(c=>c.name==='heartbeat_accounting_refresh_attempt'))
 const lost=fixture({delay:1,lost:true});assert.equal((await handle(request(),{admin:lost.admin,environment:env,heartbeatMs:10})).status,409);assert.ok(!lost.calls.some(c=>c.name==='update_accounting_refresh_attempt'))
})
test('immediate signalling follows acceptance commit; failure preserves accepted result',async()=>{
 for(const fail of [false,true]){const calls=[];const admin={rpc:async(name)=>{calls.push(name);return name==='accept_accounting_refresh'?{data:{resultCode:'accepted',job:base},error:null}:fail?{data:null,error:{code:'XX000'}}:{data:{resultCode:'submitted',submitted:1},error:null}}}
 const r=await signalAccountingRefresh({admin,connection:ref,request:{provider:ref.provider,providerOrganisationId:ref.providerOrganisationId,trigger:'internal'}});assert.equal(r.jobId,id);assert.deepEqual(calls,['accept_accounting_refresh','dispatch_accounting_refresh']);assert.equal(r.dispatch,fail?'deferred':'submitted')}
})

test('real mode requires its own enablement and authoritative stored provider',async()=>{
 const f=fixture({real:true});assert.equal((await handle(request(),{admin:f.admin,environment:env})).status,409)
 assert.ok(!f.calls.some(c=>c.name==='claim_accounting_refresh_attempt'))
 const mismatch=fixture({real:true,job:{connection:ref}});assert.equal((await handle(request(),{admin:mismatch.admin,environment:{...env,ACCOUNTING_REFRESH_XERO_ENABLED:'1'}})).status,409)
})
test('promoted real result never prematurely completes derivative lifecycle or calls synthetic instrumentation',async()=>{
 const f=fixture({real:true});let calls=0
 const response=await handle(request(),{admin:f.admin,environment:{...env,ACCOUNTING_REFRESH_XERO_ENABLED:'1'},executeProvider:async p=>{
   calls++;assert.equal(p.job.connection.provider,'xero');await p.authority.renewNow();return {kind:'promoted',runId:id,recovered:false}
 }})
 assert.equal(response.status,200);assert.equal((await response.json()).code,'ACCOUNTING_PREPARING');assert.equal(calls,1)
 assert.ok(!f.calls.some(c=>c.name==='record_accounting_refresh_worker_event'||c.name==='update_accounting_refresh_attempt'))
})
for(const category of ['transient','rate_limited','quota_limited','reconnect_required','deterministic_failure','preparation_failure','unknown'])test('real failure persists shared policy '+category,async()=>{
 const f=fixture({real:true});await handle(request(),{admin:f.admin,environment:{...env,ACCOUNTING_REFRESH_XERO_ENABLED:'1'},executeProvider:async()=>({kind:'failure',failureClass:category,code:'xero_test_failure',retryAfterSeconds:category==='rate_limited'?7200:null})})
 const update=f.calls.find(c=>c.name==='update_accounting_refresh_attempt');assert.equal(update.args.p_failure_class,category)
 if(category==='rate_limited')assert.equal(update.args.p_retry_source,'provider')
 assert.equal(update.args.p_operation,'fail')
})
test('real lost authority records no success/failure over stale state',async()=>{
 const f=fixture({real:true});assert.equal((await handle(request(),{admin:f.admin,environment:{...env,ACCOUNTING_REFRESH_XERO_ENABLED:'1'},executeProvider:async()=>({kind:'authority_lost'})})).status,409)
 assert.ok(!f.calls.some(c=>c.name==='update_accounting_refresh_attempt'))
})

test('authoritative derivative delivery executes preparation only, never the provider branch',async()=>{
 const f=fixture({prep:true});let prepared=0,provider=0
 const result=await handle(request(),{admin:f.admin,environment:{...env,ACCOUNTING_REFRESH_PREPARATION_ENABLED:'1'},executeProvider:async()=>{provider++;throw new Error('must not fetch')},executePreparation:async p=>{prepared++;assert.equal(p.job.stage,'derivatives');assert.equal(p.job.phase,'preparing');return {kind:'complete'}}})
 assert.equal(result.status,200);assert.equal((await result.json()).code,'ACCOUNTING_REFRESH_COMPLETE');assert.equal(prepared,1);assert.equal(provider,0)
})
test('preparation remains separately environment gated and rejects wrong stage',async()=>{
 const f=fixture({prep:true});assert.equal((await handle(request(),{admin:f.admin,environment:env})).status,409)
 const wrong=fixture({prep:true,job:{stage:'accounting'}});assert.equal((await handle(request(),{admin:wrong.admin,environment:{...env,ACCOUNTING_REFRESH_PREPARATION_ENABLED:'1'}})).status,409)
})
test('duplicate preparation delivery creates no further preparation or provider work',async()=>{
 const f=fixture({prep:true,duplicate:true});let calls=0
 assert.equal((await handle(request(),{admin:f.admin,environment:{...env,ACCOUNTING_REFRESH_PREPARATION_ENABLED:'1'},executePreparation:async()=>{calls++;return {kind:'complete'}}})).status,202)
 assert.equal(calls,0)
})
