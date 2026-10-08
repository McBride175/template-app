import assert from 'node:assert/strict'
import test,{before,after,beforeEach} from 'node:test'
import {randomUUID} from 'node:crypto'
import * as db from './test-helpers/dependency-database-fixture.mjs'
import {cert} from './test-helpers/materialization-client.mjs'
import {client} from './test-helpers/portfolio-client.mjs'
import {loadTypeScriptModule} from '../xero/test-helpers/ts-module-loader.mjs'
const {prepareAccountingRefresh}=loadTypeScriptModule('lib/accounting/preparation-server.ts',{mocks:{'@sentry/nextjs':{captureMessage:()=>{}}}})
const {AccountingAttemptController}=loadTypeScriptModule('lib/accounting/attempt-controller.ts')
const {heartbeatAccountingRefreshAttempt}=loadTypeScriptModule('lib/accounting/control-server.ts')
const enabled=process.env.RUN_SUPABASE_INTEGRATION==='1',check=(n,f)=>test(n,{skip:!enabled},f)
const parse=s=>JSON.parse(db.rpc(s))
const args=j=>`'${j.id}','${j.attemptId}','${j.workerId}',${j.attemptNumber},${j.connection.epoch}`
const control=()=>parse(`select public.read_accounting_refresh_control('${db.user}','xero','tenant-a');`).job
before(()=>{if(enabled)db.setup()});after(()=>{if(enabled)db.cleanup()})
beforeEach(()=>{if(enabled){db.reset();db.psql(`create or replace function accounting_refresh_private.utc_date() returns date language sql volatile set search_path=pg_catalog as $$select (clock_timestamp() at time zone 'UTC')::date$$;`)}})
function promoted(){const r=db.ready({extraInvoices:[{source_id:'i2',customer_source_id:'c2',amount_due_native:'500',amount_due_base:'500'}],invoiceChanges:{due_date:'2026-09-01'}});cert(db,r.run);return r}
function parked(r){
 const c=parse(`select public.register_accounting_refresh_connection('${db.user}','xero','tenant-a','tenant-a',(select grant_id::text from public.xero_connections_public where user_id='${db.user}' and tenant_id='tenant-a'));`)
 const j=parse(`select public.accept_accounting_refresh('${c.connectionId}','${db.user}','xero','tenant-a',${c.epoch},'internal');`).job
 const reserved=parse(`select public.reserve_accounting_refresh_delivery('${j.id}','${db.user}','xero','tenant-a',${c.epoch},'${randomUUID()}',60);`).job
 const claimed=parse(`select public.claim_accounting_refresh_attempt('${j.id}','${db.user}','xero','tenant-a',${c.epoch},'${reserved.deliveryId}','${randomUUID()}',300);`).job
 const scope=`'${j.id}','${db.user}','xero','tenant-a',${c.epoch},'${claimed.attemptId}','${claimed.workerId}',${claimed.attemptNumber}`
 db.rpc(`select public.update_accounting_refresh_attempt(${scope},'bind_generation',null,null,null,null,'none','${r.run}');
 select public.update_accounting_refresh_attempt(${scope},'preparing');`)
 db.psql(`update public.accounting_refresh_jobs set worker_id=null,attempt_expires_at=null where id='${j.id}';`)
 return control()
}
function claim(j){const r=parse(`select public.reserve_accounting_refresh_delivery('${j.id}','${db.user}','xero','tenant-a',${j.connection.epoch},'${randomUUID()}',60);`).job
 return parse(`select public.claim_accounting_refresh_attempt('${j.id}','${db.user}','xero','tenant-a',${j.connection.epoch},'${r.deliveryId}','${randomUUID()}',300);`).job}
async function execute(j,hook,options={}) {
 const admin=client(db,hook),authority=new AccountingAttemptController(()=>heartbeatAccountingRefreshAttempt(admin,j),30000)
 const before=db.psql('select count(*) from public.xero_sync_runs;')
 try{const result=await prepareAccountingRefresh({admin,job:j,authority,deadlineAtMs:(options.now?.()??Date.now())+120000,bookkeepingAtMs:(options.now?.()??Date.now())+150000},options)
 assert.equal(db.psql('select count(*) from public.xero_sync_runs;'),before);assert.ok(!admin.calls.some(c=>/xero.*(acquire|token)|acquire.*xero|promote_xero/.test(c.name)));return {result,calls:admin.calls}}
 finally{await authority.stop()}
}
const audit=j=>JSON.parse(db.psql(`select jsonb_build_object('kind',completion_kind,'identity',completion_identity,'metrics',preparation_diagnostics,'retry',preparation_retry_count) from public.accounting_refresh_jobs where id='${j.id}';`))
check('promoted -> full features -> two standard portfolios -> exact complete; warm hits reuse derivatives',async()=>{
 const r=promoted(),j=claim(parked(r)),before=db.head()
 const first=await execute(j);assert.equal(first.result.kind,'complete');assert.equal(control().phase,'complete');assert.equal(audit(j).kind,'prepared')
 assert.equal(audit(j).identity.generationId,r.run);assert.equal(audit(j).identity.financialEpoch,before.financialEpoch)
 assert.equal(audit(j).metrics.featureMisses,3);assert.equal(audit(j).metrics.portfolioMisses,2)
 assert.equal(db.psql('select count(*) from public.collection_portfolio_calculations;'),'2')
 // A new refresh intent observing the same already-published G is a cache hit.
 db.psql(`update public.accounting_refresh_connections set cooldown_until=null;`)
 const next=claim(parked(r)),warm=await execute(next)
 assert.equal(warm.result.kind,'complete');assert.equal(audit(next).metrics.featureMisses,0);assert.equal(audit(next).metrics.basisBuilds,0);assert.equal(audit(next).metrics.portfolioHits,2)
 assert.equal(db.head().financialEpoch,before.financialEpoch);assert.equal(db.psql('select count(*) from public.billing_usage_days;'),'0')
})
check('P-only priority/Action History changes do not invalidate financial completion',async()=>{
 const j=claim(parked(promoted())),before=db.head();let changed=false
 await execute(j,name=>{if(name==='complete_accounting_preparation'&&!changed){changed=true;db.psql(db.override()+db.action())}})
 assert.equal(control().phase,'complete');assert.equal(audit(j).metrics.drifts,0);assert.equal(audit(j).metrics.portfolioMisses,2)
 assert.equal(db.head().financialEpoch,before.financialEpoch);assert.notEqual(db.head().projectionRevision,before.projectionRevision)
})
for(const mutation of ['promise','dispute'])check(`${mutation} F/rCustomer race rejects stale completion and rebuilds the affected feature`,async()=>{
 const r=promoted();let promise;if(mutation==='promise')promise=db.createPromise({amount:'100'}).promise
 const j=claim(parked(r)),before=db.head();let changed=false
 await execute(j,name=>{if(name==='complete_accounting_preparation'&&!changed){changed=true;if(mutation==='promise')db.promiseRequest({operation:'edit',promiseId:promise.id,amount:'200'});else db.dispute('i1',100)}})
 assert.equal(control().phase,'complete');assert.equal(audit(j).metrics.drifts,1);assert.equal(audit(j).identity.financialEpoch,db.head().financialEpoch)
 assert.notEqual(db.head().financialEpoch,before.financialEpoch);assert.equal(audit(j).metrics.featuresRebuilt,4)
 assert.equal(audit(j).metrics.basisBuilds,1)
})
check('UTC rollover mid-preparation cannot close yesterday; retries current date without provider work',async()=>{
 const j=claim(parked(promoted())),day=new Date().toISOString().slice(0,10),next=new Date(Date.now()+86400000).toISOString().slice(0,10);let rolled=false
 const result=await execute(j,name=>{if(name==='complete_accounting_preparation'&&!rolled){rolled=true;db.psql(`create or replace function accounting_refresh_private.utc_date() returns date language sql volatile set search_path=pg_catalog as $$select '${next}'::date$$;`)}},{now:()=>rolled?Date.parse(next+'T00:00:01Z'):Date.parse(day+'T23:59:59Z')})
 // Controlled clock must share the same absolute worker budget too; a rollover
 // beyond its supplied budget is safely retryable, never yesterday-complete.
 assert.equal(result.result.kind,'complete');assert.equal(audit(j).identity.evaluationDate,next);assert.equal(audit(j).metrics.drifts,1);assert.equal(audit(j).metrics.basisBuilds,1)
})
check('new authoritative G supersedes an old job without preparing obsolete work',async()=>{
 const old=promoted(),j=claim(parked(old)),newer=promoted();const r=await execute(j)
 assert.equal(r.result.kind,'superseded');assert.equal(audit(j).kind,'superseded');assert.equal(audit(j).identity.authoritativeGenerationId,newer.run)
 assert.ok(!r.calls.some(c=>/build_collection|publish_collection/.test(c.name)));assert.equal(db.head().generationId,newer.run)
})
check('derivative-only failure waits ~one minute independent of provider cooldown then reuses features',async()=>{
 const j=claim(parked(promoted()))
 db.psql(`insert into accounting_refresh_private.preparation_test_controls(job_id,scenario) values('${j.id}','fail_after_features_once');
 update accounting_refresh_private.dispatch_config set project_ref='rbmxegyiwntomhpbepnu';`)
 const started=Date.now(),first=await execute(j)
 assert.equal(first.result.kind,'retry_wait');assert.equal(control().stage,'derivatives');assert.equal(control().preparationRetryCount,1)
 assert.ok(Date.parse(control().nextEligibleAt)-started<90000)
 db.psql(`update public.accounting_refresh_jobs set next_eligible_at=now()-interval '1 second' where id='${j.id}';`)
 const second=await execute(claim(control()))
 assert.equal(second.result.kind,'complete');assert.equal(audit(j).metrics.featureMisses,0);assert.equal(audit(j).metrics.basisBuilds,0)
})
check('expired preparation attempt recovers with independent counter, rejects stale worker and skips provider',async()=>{
 const j=claim(parked(promoted()));db.psql(`update public.accounting_refresh_jobs set attempt_expires_at=now()-interval '1 second' where id='${j.id}';`)
 db.rpc('select public.recover_accounting_refresh_work(25);');assert.equal(control().phase,'retry_wait');assert.equal(control().preparationRetryCount,1)
 assert.throws(()=>db.rpc(`select public.complete_accounting_preparation(${args(j)},current_date,null,null);`),/stale_attempt/)
 db.psql(`update public.accounting_refresh_jobs set next_eligible_at=now()-interval '1 second' where id='${j.id}';`)
 assert.equal((await execute(claim(control()))).result.kind,'complete')
})
check('uncertain completion response inspects terminal job; no recalculation/provider retrieval',async()=>{
 const j=claim(parked(promoted()));db.psql(`insert into accounting_refresh_private.preparation_test_controls(job_id,scenario) values('${j.id}','lose_completion_response_once');
 update accounting_refresh_private.dispatch_config set project_ref='rbmxegyiwntomhpbepnu';`)
 const result=await execute(j);assert.equal(result.result.kind,'complete');assert.equal(result.result.recovered,true);assert.equal(control().phase,'complete')
 assert.equal(audit(j).metrics.portfolioMisses,2)
})
check('already-published calculation with lost response is observed rather than blindly rebuilt',async()=>{
 const j=claim(parked(promoted())),admin=client(db);let lost=false
 const original=admin.rpc.bind(admin);admin.rpc=async(name,args)=>{const r=await original(name,args);if(name==='publish_collection_portfolio_calculation'&&!lost&&!r.error){lost=true;return {data:null,error:{message:'controlled response loss'}}}return r}
 const authority=new AccountingAttemptController(()=>heartbeatAccountingRefreshAttempt(admin,j))
 try{const first=await prepareAccountingRefresh({admin,job:j,authority,deadlineAtMs:Date.now()+120000,bookkeepingAtMs:Date.now()+150000});assert.equal(first.kind,'retry_wait')}finally{await authority.stop()}
 db.psql(`update public.accounting_refresh_jobs set next_eligible_at=now()-interval '1 second' where id='${j.id}';`)
 await execute(claim(control()));assert.equal(control().phase,'complete');assert.equal(audit(j).metrics.portfolioHits,1);assert.equal(audit(j).metrics.portfolioMisses,1)
})
check('browser roles, forged calculations, stale epoch and premature complete are denied',()=>{
 const j=claim(parked(promoted()))
 for(const role of ['anon','authenticated'])assert.throws(()=>db.psql(`set role ${role};select public.complete_accounting_preparation(${args(j)},current_date,null,null);`),/permission denied/)
 assert.equal(parse(`select public.complete_accounting_preparation(${args(j)},current_date,'${randomUUID()}','${randomUUID()}');`).resultCode,'identity_changed')
 assert.throws(()=>db.rpc(`select public.update_accounting_refresh_attempt('${j.id}','${db.user}','xero','tenant-a',1,'${j.attemptId}','${j.workerId}',${j.attemptNumber},'complete');`),/proof_required/)
 db.rpc(`select public.advance_accounting_refresh_epoch('${j.connection.connectionId}','${db.user}','xero','tenant-a',${j.connection.epoch},'credential_relink');`)
 assert.throws(()=>db.rpc(`select public.complete_accounting_preparation(${args(j)},current_date,null,null);`),/stale_epoch/)
})
check('preparation retries exhaust independently after 1/5/15/60 minutes and never become accounting work',()=>{
 let j=claim(parked(promoted()))
 for(let n=0;n<5;n++){
  const before=Date.now();parse(`select public.fail_accounting_preparation(${args(j)},'controlled_failure',null);`)
  const next=control();assert.equal(next.preparationRetryCount,n+1);assert.equal(next.stage,'derivatives')
  if(n===4){assert.equal(next.phase,'attention_required');break}
  const expected=[60,300,900,3600][n]*1000;assert.ok(Date.parse(next.nextEligibleAt)-before>=expected*.89&&Date.parse(next.nextEligibleAt)-before<=expected*1.11)
  db.psql(`update public.accounting_refresh_jobs set next_eligible_at=now()-interval '1 second' where id='${j.id}';`);j=claim(control())
 }
})

check('preparing delivery is discoverable with provider gate closed and shares four-slot capacity',async()=>{
 const r=promoted(),park=parked(r)
 db.psql(`create table public.preparation_deliveries(job uuid,delivery uuid);
 create or replace function accounting_refresh_private.delivery_settings() returns jsonb language sql stable set search_path=pg_catalog as $$select '{}'::jsonb$$;
 create or replace function accounting_refresh_private.submit_delivery(p_settings jsonb,p_project text,p_job uuid,p_delivery uuid) returns bigint language plpgsql set search_path=pg_catalog as $$begin insert into public.preparation_deliveries values(p_job,p_delivery);return 1;end$$;
 update accounting_refresh_private.dispatch_config set enabled=true,project_ref='rbmxegyiwntomhpbepnu',preparation_enabled=true,xero_enabled=false;`)
 for(let n=0;n<4;n++){
  const c=parse(`select public.register_accounting_refresh_connection('${db.user}','foundation_certification','slot-${n}','slot-${n}','fixture');`)
  const j=parse(`select public.accept_accounting_refresh('${c.connectionId}','${db.user}','foundation_certification','slot-${n}',1,'onboarding');`).job
  db.psql(`insert into accounting_refresh_private.synthetic_jobs(job_id,scenario) values('${j.id}','complete');`)
 }
 const tick=parse("select public.dispatch_accounting_refresh('cron');");assert.equal(tick.submitted,4)
 assert.equal(control().phase,'preparing');assert.equal(parse("select public.dispatch_accounting_refresh('cron');").submitted,0)
 db.psql(`update public.accounting_refresh_jobs set delivery_expires_at=now()-interval '1 second' where provider='foundation_certification';
 update accounting_refresh_private.dispatch_config set enabled=true;delete from accounting_refresh_private.synthetic_jobs;`)
 assert.equal(parse("select public.dispatch_accounting_refresh('cron');").submitted,1)
 const delivery=control();assert.equal(delivery.stage,'derivatives');assert.equal(delivery.phase,'queued')
 const loaded=parse(`select public.load_accounting_refresh_delivery('${park.id}','${delivery.deliveryId}');`)
 assert.equal(loaded.mode,'preparation');assert.equal(loaded.job.generationRunId,r.run)
 const next=parse(`select public.claim_accounting_refresh_attempt('${delivery.id}','${db.user}','xero','tenant-a',${delivery.connection.epoch},'${delivery.deliveryId}','${randomUUID()}',300);`).job
 assert.equal(next.phase,'preparing');await execute(next);assert.equal(control().phase,'complete')
 db.psql('drop table public.preparation_deliveries;')
})
check('committed-run inspection never clears a live preparation attempt or bypasses retry cooldown',async()=>{
 const j=claim(parked(promoted()))
 parse(`select public.inspect_accounting_xero_result('${j.id}',${j.connection.epoch});`)
 assert.equal(control().workerId,j.workerId);assert.equal(control().phase,'preparing')
 parse(`select public.fail_accounting_preparation(${args(j)},'controlled_failure',null);`)
 const due=control().nextEligibleAt
 db.rpc('select public.recover_accounting_refresh_work(25);')
 assert.equal(control().phase,'retry_wait');assert.equal(control().nextEligibleAt,due)
})
