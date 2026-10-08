import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'
const user='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',conn='00000000-0000-4000-8000-000000000003',run='00000000-0000-4000-8000-000000000004'
const ref={connectionId:conn,ownerId:user,provider:'xero',providerOrganisationId:'tenant-a',epoch:'1'}
const time='2026-10-07T12:00:00Z'
const scopes=['offline_access','accounting.settings.read','accounting.contacts.read','accounting.invoices.read','accounting.payments.read']
const job={id:'00000000-0000-4000-8000-000000000005',connection:ref,phase:'queued',stage:'accounting',trigger:'manual',latestTrigger:'manual',priority:50,requestCount:'1',requestedAt:time,lastRequestedAt:time,nextEligibleAt:time,
 claimedAt:null,heartbeatAt:null,completedAt:null,failedAt:null,attemptNumber:0,retryCount:0,failureClass:null,failureCode:null,retrySource:'none',providerNotBefore:null,generationRunId:null,
 deliveryId:null,deliveryOwner:null,deliveryExpiresAt:null,lastReservedAt:null,attemptId:null,workerId:null,attemptExpiresAt:null}
function harness(options={}) {
 const calls=[];let resolverReads=0
 const tables={xero_connections_public:[{user_id:user,tenant_id:'tenant-a',grant_id:'grant-a',auth_state:'active',...options.connection}],
 xero_oauth_grants:[{id:'grant-a',user_id:user,scopes:options.scopes??scopes}],
 xero_sync_tenant_state:[{user_id:user,tenant_id:'tenant-a',active_sync_run_id:run,last_successful_sync_at:time,...options.state}],
 xero_sync_runs:[{id:run,user_id:user,tenant_id:'tenant-a',status:'succeeded',snapshot_as_of:'2026-10-07T11:55:00Z',...options.run}]}
 const admin={from(table) {calls.push({table});const filters={};return {select(columns){calls.push({columns});return this},eq(k,v){filters[k]=v;calls.push({eq:[k,v]});return this},
 async maybeSingle(){if(table==='xero_sync_tenant_state')resolverReads++
 if(options.tableError===table)return {data:null,error:{message:'sensitive database error'}}
 if(options.promoteRace&&table==='xero_sync_tenant_state'&&resolverReads>1)return {data:{active_sync_run_id:'newer',last_successful_sync_at:time},error:null}
 return {data:tables[table]?.find(row=>Object.entries(filters).every(([k,v])=>row[k]===v))??null,error:null}}}},
 async rpc(name,args){calls.push({rpc:name,args});if(options.rpcError===name)return {data:null,error:{code:options.errorCode??'XX000',message:'secret raw provider error SQL detail'}}
 if(name==='register_accounting_refresh_connection')return {data:{...ref,invalidated:options.invalidated??false},error:null}
 if(name==='accept_accounting_refresh')return {data:{resultCode:'accepted',job:options.job??job},error:null}
 if(name==='read_accounting_refresh_control')return {data:{connection:ref,invalidated:options.invalidated??false,job:options.job??job},error:null}
 if(name==='read_accounting_preparation_readiness') {
 if(options.rpcError==='read_collection_portfolio_calculation')return {data:null,error:{code:'XX000'}}
 const context={generationId:run,financialEpoch:'5',evidenceIdentity:'proof'}
 const head=options.ready?{identity:{...context,evaluationDate:'2026-10-07',...options.head}}:null
 return {data:{context,evaluationDate:'2026-10-07',ready:!!head&&head.identity.generationId===context.generationId&&head.identity.financialEpoch===context.financialEpoch&&head.identity.evaluationDate==='2026-10-07'&&head.identity.evidenceIdentity===context.evidenceIdentity},error:null}
 }
 throw new Error('unexpected RPC '+name)}}
 const session={auth:{getUser:async()=>({data:{user:options.signedOut?null:{id:options.owner??user}},error:null})}}
 const api=loadTypeScriptModule('lib/accounting/refresh-server.ts',{mocks:{'@/lib/supabase-admin':{createSupabaseAdminClient:()=>admin},'@/lib/supabase-server':{createServerSupabaseClient:async()=>session}}})
 const facade=loadTypeScriptModule('lib/accounting/connection-server.ts')
 const control=loadTypeScriptModule('lib/accounting/control-server.ts')
 return {api,facade,control,admin,session,calls}
}
const request={provider:'xero',providerOrganisationId:'tenant-a',trigger:'manual',idempotencyKey:'stable'}
test('authenticated acceptance derives owner, resolves Xero and calls only control RPCs',async()=>{
 const h=harness();const result=await h.api.requestAccountingRefresh({...request,userId:other},{admin:h.admin,session:h.session})
 assert.equal(result.job.id,job.id)
 const accept=h.calls.find(c=>c.rpc==='accept_accounting_refresh');assert.equal(accept.args.p_user_id,user);assert.equal(accept.args.p_connection_epoch,'1')
 assert.deepEqual(h.calls.filter(c=>c.rpc).map(c=>c.rpc),['register_accounting_refresh_connection','accept_accounting_refresh'])
 assert.ok(h.calls.some(c=>c.eq?.[0]==='user_id'&&c.eq[1]===user))
 assert.ok(!h.calls.some(c=>c.columns?.includes('token')))
})
test('signed-out owner rejects before database access',async()=>{
 const h=harness({signedOut:true});await assert.rejects(h.api.requestAccountingRefresh(request,{admin:h.admin,session:h.session}),e=>e.code==='unauthorized');assert.equal(h.calls.length,0)
})
test('foreign owner cannot accept or read the same tenant through the authenticated boundary',async()=>{
 const h=harness({owner:other})
 await assert.rejects(h.api.requestAccountingRefresh(request,{admin:h.admin,session:h.session}),e=>e.code==='not_found')
 await assert.rejects(h.api.readAccountingRefreshStatus(request,{admin:h.admin,session:h.session}),e=>e.code==='not_found')
 assert.ok(!h.calls.some(c=>c.rpc))
})
test('unknown organisation is never silently replaced by a different owned connection',async()=>{
 const h=harness();await assert.rejects(h.api.requestAccountingRefresh({...request,providerOrganisationId:'missing'},{admin:h.admin,session:h.session}),e=>e.code==='not_found')
 assert.ok(!h.calls.some(c=>c.rpc))
})
test('future provider identity is supported by domain, without a fake installed connector',async()=>{
 const h=harness();await assert.rejects(h.api.requestAccountingRefresh({...request,provider:'fixture_provider'},{admin:h.admin,session:h.session}),e=>e.code==='unsupported_provider');assert.equal(h.calls.length,0)
})
for(const [connection,expected] of [[{auth_state:'disconnected'},'disconnected'],[{auth_state:'reauth_required'},'reconnect_required'],[{auth_state:'error'},'attention_required'],[{grant_id:null},'reconnect_required']])test(`health ${expected} is derived without refreshing credentials`,async()=>{
 const h=harness({connection});const result=await h.facade.resolveAccountingConnection({admin:h.admin,authenticatedOwnerId:user,provider:'xero',providerOrganisationId:'tenant-a'})
 assert.equal(result.health,expected)
 await assert.rejects(h.api.requestAccountingRefresh(request,{admin:h.admin,session:h.session}),e=>e.code==='connection_unavailable')
 assert.ok(!h.calls.some(c=>c.rpc==='accept_accounting_refresh'))
})
test('missing permissions or invalidated connection cannot accept new work',async()=>{
 for(const options of [{scopes:['offline_access']},{invalidated:true}]){
 const h=harness(options);await assert.rejects(h.api.requestAccountingRefresh(request,{admin:h.admin,session:h.session}),e=>e.code==='connection_unavailable')
 }
})
test('connection and RPC failures never expose internal messages',async()=>{
 for(const options of [{tableError:'xero_connections_public'},{rpcError:'register_accounting_refresh_connection'},{rpcError:'accept_accounting_refresh',errorCode:'40001'}]){
 const h=harness(options);await assert.rejects(h.api.requestAccountingRefresh(request,{admin:h.admin,session:h.session}),e=>!/secret|SQL|sensitive/.test(e.message))
 }
})
test('RPC response with wrong owner/provider/connection fails closed',async()=>{
 for(const changes of [{ownerId:other},{provider:'fixture_provider'},{connectionId:'00000000-0000-4000-8000-000000000099'}]){
 const h=harness({job:{...job,connection:{...ref,...changes}}});await assert.rejects(h.api.requestAccountingRefresh(request,{admin:h.admin,session:h.session}),e=>e.code==='unavailable')
 }
})
test('control rejects mismatched request provider and unsafe input before acceptance',async()=>{
 const h=harness();for(const changes of [{provider:'fixture_provider'},{providerOrganisationId:'missing'},{idempotencyKey:' x '},{notBefore:'bad'}]){
 await assert.rejects(h.control.acceptAccountingRefresh({admin:h.admin,connection:ref,request:{...request,...changes}}))
 }assert.ok(!h.calls.some(c=>c.rpc==='accept_accounting_refresh'))
})
test('status uses source observation, not successful publication time, and never ensures derivatives',async()=>{
 const h=harness({ready:true});const status=await h.api.readAccountingRefreshStatus(request,{admin:h.admin,session:h.session,now:new Date(time)})
 assert.equal(status.accounting.activeGenerationId,run);assert.equal(status.accounting.ageSeconds,300);assert.equal(status.accounting.derivatives.state,'ready')
 assert.equal(status.work.phase,'queued');assert.ok(!h.calls.some(c=>/ensure|build|publish|claim_billing|accept_accounting/.test(c.rpc??'')))
 assert.doesNotMatch(JSON.stringify(status),/grant-a|workerId|authority_key|SQL|ownerId/)
})
test('missing, wrong-generation or stale derivative head does not become ready from job state',async()=>{
 for(const options of [{ready:false},{ready:true,head:{generationId:'wrong'}},{ready:true,head:{financialEpoch:'4'}},{ready:true,head:{evaluationDate:'2026-10-06'}},{ready:true,head:{evidenceIdentity:'wrong'}}]){
 const h=harness(options);const status=await h.api.readAccountingRefreshStatus(request,{admin:h.admin,session:h.session,now:new Date(time)})
 assert.equal(status.accounting.derivatives.state,'preparing')
 }
})
test('invalid pointer, missing observation or mid-read promotion cannot look fresh',async()=>{
 for(const options of [{state:{active_sync_run_id:'missing'}},{run:{snapshot_as_of:null}},{promoteRace:true}]){
 const h=harness(options);const result=await h.facade.getAccountingAuthority({admin:h.admin,authenticatedOwnerId:user,provider:'xero',providerOrganisationId:'tenant-a',now:new Date(time)})
 assert.equal(result.state,'unavailable')
 }
})
test('legacy mode is not invented as a successful immutable generation',async()=>{
 const h=harness({state:{active_sync_run_id:null,last_successful_sync_at:null}})
 const result=await h.facade.getAccountingAuthority({admin:h.admin,authenticatedOwnerId:user,provider:'xero',providerOrganisationId:'tenant-a',now:new Date(time)})
 assert.equal(result.state,'missing');assert.equal(result.activeGenerationId,null);assert.equal(result.accountingObservedAt,null)
})
test('derivative read failure preserves valid accounting with unavailable preparation',async()=>{
 const h=harness({rpcError:'read_collection_portfolio_calculation'})
 const result=await h.facade.getAccountingAuthority({admin:h.admin,authenticatedOwnerId:user,provider:'xero',providerOrganisationId:'tenant-a',now:new Date(time)})
 assert.equal(result.state,'valid');assert.equal(result.derivatives.state,'unavailable')
})
test('claim/reservation primitives only call service RPCs, not providers',async()=>{
 const h=harness();const names=[];const admin={rpc:async(name)=>{names.push(name);return {data:name.startsWith('list_')?[]:name.startsWith('recover_')?0:name.startsWith('release_')?false:{reserved:false,claimed:false,resultCode:'not_eligible'},error:null}}}
 await h.control.listAccountingRefreshWork(admin)
 await h.control.reserveAccountingRefreshDelivery({admin,job,deliveryOwner:conn})
 await h.control.claimAccountingRefreshAttempt({admin,job,deliveryId:conn,workerId:conn})
 await h.control.releaseAccountingRefreshDelivery({admin,job,deliveryId:conn,deliveryOwner:conn})
 await h.control.recoverAccountingRefreshWork(admin)
 assert.deepEqual(names,['list_accounting_refresh_work','reserve_accounting_refresh_delivery','claim_accounting_refresh_attempt','release_accounting_refresh_delivery','recover_accounting_refresh_work'])
})
test('epoch and activity wrappers preserve full scope; worker updates use captured attempt',async()=>{
 const h=harness(),calls=[]
 const live={...job,phase:'running',attemptId:conn,workerId:conn,attemptNumber:1}
 const admin={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='advance_accounting_refresh_epoch'?{...ref,epoch:'2'}:name==='set_accounting_refresh_schedule'?{}:live,error:null}}}
 await h.control.advanceAccountingRefreshEpoch({admin,connection:ref,reason:'disconnect'})
 await h.control.setAccountingRefreshSchedule({admin,connection:ref,activityKind:'dashboard',nextDueAt:null})
 await h.control.heartbeatAccountingRefreshAttempt(admin,live)
 await h.control.updateAccountingRefreshAttempt({admin,job:live,operation:'fail',failureClass:'transient',failureCode:'raw secret',retryAt:time,retrySource:'local'})
 for(const call of calls){assert.equal(call.args.p_user_id,user);assert.equal(call.args.p_provider,'xero');assert.equal(call.args.p_provider_organisation_id,'tenant-a')}
 assert.equal(calls[0].args.p_expected_epoch,'1');assert.equal(calls[2].args.p_attempt_id,conn);assert.equal(calls[3].args.p_failure_code,'unknown_failure')
})
test('Phase 7.4 preserves compatibility triggers, billing, collections and configuration',()=>{
 const base='4d72baa9d25e897622daff04b876d6c9f530d06e'
 const adapted=new Set()
 const files=execFileSync('git',['ls-tree','-r','--name-only',base],{encoding:'utf8'}).trim().split('\n')
 for(const file of files.filter(f=>f.startsWith('app/')||f.startsWith('lib/xero/')||f.startsWith('lib/collections/')||f.startsWith('lib/billing/')||f==='vercel.json'||f==='proxy.ts')) {
   if(adapted.has(file))continue
   assert.equal(readFileSync(file,'utf8'),execFileSync('git',['show',`${base}:${file}`],{encoding:'utf8'}),file)
 }
 const sqlFile=readdirSync('supabase/migrations').find(f=>f.endsWith('_accounting_refresh_foundation.sql'))
 const sql=readFileSync('supabase/migrations/'+sqlFile,'utf8')
 assert.doesNotMatch(sql,/\b(create extension|cron\.schedule|net\.http|claim_billing_usage_day|update public\.xero_sync|insert into public\.canonical_|delete from public\.canonical_)/i)
 for(const file of readdirSync('lib/accounting'))assert.doesNotMatch(readFileSync('lib/accounting/'+file,'utf8'),/\bfetch\(|syncXeroAuthoritatively|importXeroGeneration|claimActionsEntitlementStatus|claim_billing_usage_day/)
})
