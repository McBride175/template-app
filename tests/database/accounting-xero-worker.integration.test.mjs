import assert from 'node:assert/strict'
import test, { before, after, beforeEach } from 'node:test'
import { randomUUID } from 'node:crypto'
import * as db from './test-helpers/dependency-database-fixture.mjs'
const enabled=process.env.RUN_SUPABASE_INTEGRATION==='1', check=(n,f)=>test(n,{skip:!enabled},f)
const parse=s=>JSON.parse(db.rpc(s))
before(()=>{if(enabled)db.setup()});after(()=>{if(enabled)db.cleanup()});beforeEach(()=>{if(enabled)db.reset()})
function work() {
 const c=parse(`select public.register_accounting_refresh_connection('${db.user}','xero','tenant-a','tenant-a',(select grant_id::text from public.xero_connections_public where user_id='${db.user}' and tenant_id='tenant-a'));`)
 db.psql(`update public.accounting_refresh_connections set cooldown_until=null where id='${c.connectionId}';`)
 const j=parse(`select public.accept_accounting_refresh('${c.connectionId}','${db.user}','xero','tenant-a',${c.epoch},'internal');`).job
 const r=parse(`select public.reserve_accounting_refresh_delivery('${j.id}','${db.user}','xero','tenant-a',${c.epoch},'${randomUUID()}',60);`).job
 return parse(`select public.claim_accounting_refresh_attempt('${j.id}','${db.user}','xero','tenant-a',${c.epoch},'${r.deliveryId}','${randomUUID()}',300);`).job
}
const acquire=j=>parse(`select to_jsonb(r) from public.acquire_accounting_xero_run('${j.id}','${j.attemptId}','${j.workerId}',${j.attemptNumber},${j.connection.epoch},'${db.owner}') r;`)
const job=()=>parse(`select public.read_accounting_refresh_control('${db.user}','xero','tenant-a');`).job
const inspect=j=>parse(`select public.inspect_accounting_xero_result('${j.id}',${j.connection.epoch});`)
function boundCandidate(j,options={}) { const a=acquire(j);assert.equal(a.acquired,true);const r=db.candidate(options);assert.equal(r.run,a.sync_run_id);return r }
check('atomic acquisition binds a distinct job attempt, connection epoch and generation fence',()=>{
 const j=work(),r=boundCandidate(j)
 assert.equal(job(j).generationRunId,r.run);assert.notEqual(j.workerId,db.owner)
 assert.equal(db.psql(`select connection_epoch||'|'||fencing_token from accounting_refresh_private.xero_runs where sync_run_id='${r.run}';`),`${j.connection.epoch}|${r.fence}`)
 assert.equal(acquire(j).result_code,'already_owned')
})
check('successful accounting/Promise publication parks the same job at preparing and advances G/F/P',()=>{
 const old=db.ready(),before=db.head(),j=work(),r=boundCandidate(j)
 assert.equal(db.promote(r).promoted,true);const current=job(j)
 assert.equal(current.phase,'preparing');assert.equal(current.stage,'derivatives');assert.equal(current.workerId,null)
 assert.equal(current.attemptExpiresAt,null);assert.equal(current.generationRunId,r.run)
 assert.notEqual(db.head().generationId,old.run);assert.equal(BigInt(db.head().financialEpoch),BigInt(before.financialEpoch)+BigInt(1))
 assert.equal(db.head().customerRevision,before.customerRevision)
 assert.equal(inspect(j).runId,r.run);assert.equal(inspect(j).resultCode,'promoted')
 assert.equal(db.psql(`select (handoff_at is not null)::text from accounting_refresh_private.xero_runs where sync_run_id='${r.run}';`),'true')
})
check('candidate validation refusal leaves old accounting and job unpublished',()=>{
 const old=db.ready(),j=work(),r=boundCandidate(j)
 db.psql(`delete from public.xero_sync_run_validations where sync_run_id='${r.run}';`)
 assert.equal(db.promote(r).promoted,false);assert.equal(db.head().generationId,old.run);assert.equal(job(j).phase,'running')
})
check('captured epoch cannot publish, heartbeat or complete after authority advances',()=>{
 const old=db.ready(),j=work(),r=boundCandidate(j)
 db.rpc(`select public.advance_accounting_refresh_epoch('${j.connection.connectionId}','${db.user}','xero','tenant-a',${j.connection.epoch},'credential_relink');`)
 assert.throws(()=>db.promote(r),/stale_epoch/);assert.equal(db.head().generationId,old.run);assert.equal(job(j).phase,'cancelled')
 assert.throws(()=>inspect(j),/stale_epoch/)
 assert.throws(()=>db.rpc(`select public.heartbeat_accounting_refresh_attempt('${j.id}','${db.user}','xero','tenant-a',${j.connection.epoch},'${j.attemptId}','${j.workerId}',1);`),/stale_epoch/)
})
check('actual disconnect update atomically advances epoch and preserves history/current accounting',()=>{
 const old=db.ready(),p=db.createPromise().promise,j=work(),r=boundCandidate(j),f=db.head()
 db.psql(`update public.xero_connections_public set auth_state='disconnected',grant_id=null where user_id='${db.user}' and tenant_id='tenant-a';`)
 assert.equal(job(j).phase,'cancelled');assert.equal(db.promiseState(p.id).id,p.id)
 assert.equal(db.head().generationId,old.run);assert.equal(db.head().financialEpoch,f.financialEpoch)
 assert.equal(db.promote(r).result_code,'connection_authority_lost')
})
check('same verified organisation reconnect retains accounting/operational scope and grants fresh authority',()=>{
 const old=db.ready(),p=db.createPromise().promise,j=work()
 db.psql(`update public.xero_connections_public set auth_state='disconnected' where user_id='${db.user}' and tenant_id='tenant-a';
 update public.xero_connections_public set auth_state='active' where user_id='${db.user}' and tenant_id='tenant-a';`)
 const fresh=work();assert.equal(fresh.connection.connectionId,j.connection.connectionId)
 assert.equal(BigInt(fresh.connection.epoch),BigInt(j.connection.epoch)+BigInt(2));assert.equal(db.head().generationId,old.run);assert.equal(db.promiseState(p.id).id,p.id)
})
check('OAuth relink advances only affected grant authority; normal token rotation does not',()=>{
 const j=work(),g=db.psql(`select grant_id from public.xero_connections_public where user_id='${db.user}' and tenant_id='tenant-a';`),otherGrant=randomUUID()
 db.psql(`insert into public.xero_oauth_grants(id,user_id,xero_user_id,refresh_token_encrypted) values('${otherGrant}','${db.user}','other-grant','fixture');
 insert into public.xero_connections_public(user_id,tenant_id,grant_id,auth_state) values('${db.user}','other-org','${otherGrant}','active');`)
 const other=parse(`select public.register_accounting_refresh_connection('${db.user}','xero','other-org','other-org','${otherGrant}');`)
 db.psql(`update public.xero_oauth_grants set refresh_token_encrypted='rotated' where id='${g}';`)
 assert.equal(job(j).phase,'running')
 db.psql(`update public.xero_oauth_grants set authorization_revision=gen_random_uuid() where id='${g}';`)
 assert.equal(job(j).phase,'cancelled')
 assert.equal(parse(`select public.read_accounting_refresh_control('${db.user}','xero','other-org');`).connection.epoch,other.epoch)
})
check('expired worker cannot publish despite a live generation lease',()=>{
 const old=db.ready(),j=work(),r=boundCandidate(j)
 db.psql(`update public.accounting_refresh_jobs set attempt_expires_at=now()-interval '1 second' where id='${j.id}';`)
 assert.throws(()=>db.promote(r),/stale_attempt/);assert.equal(db.head().generationId,old.run)
})
check('expired generation cannot publish despite a live worker lease',()=>{
 const old=db.ready(),j=work(),r=boundCandidate(j),proposal=db.proposalFor(r)
 db.psql(`update public.xero_sync_runs set lease_expires_at=now()-interval '1 second' where id='${r.run}';`)
 assert.equal(db.promote(r,proposal).promoted,false);assert.equal(db.head().generationId,old.run)
})
check('worker death before publication recovers job, abandons old generation and fences replacement',()=>{
 const old=db.ready(),j=work(),r=boundCandidate(j)
 db.psql(`update public.accounting_refresh_jobs set attempt_expires_at=now()-interval '1 second' where id='${j.id}';
 update public.xero_sync_runs set lease_expires_at=now()-interval '1 second' where id='${r.run}';`)
 db.rpc('select public.recover_accounting_refresh_work(25);');assert.equal(job(j).phase,'retry_wait');assert.equal(db.head().generationId,old.run)
 const next=db.candidate();assert.notEqual(next.run,r.run);assert.equal(db.psql(`select status from public.xero_sync_runs where id='${r.run}';`),'abandoned')
 assert.throws(()=>db.promote(r,null),/stale_attempt/)
})
check('committed engine result with omitted job update recovers exact run without acquisition/refetch',()=>{
 db.ready();const j=work(),r=boundCandidate(j),proposal=db.proposalFor(r)
 // Privileged test barrier simulates pre-handoff bookkeeping loss. The mature
 // engine is deliberately unavailable to service_role/browser callers.
 const committed=JSON.parse(db.psql(`select to_jsonb(p) from public.promote_xero_sync_run_with_promises_engine('${r.run}','${db.owner}',${r.fence},null,${proposal?db.json(proposal):'null'}) p;`))
 assert.equal(committed.promoted,true);assert.equal(job(j).phase,'running')
 const runs=db.psql('select count(*) from public.xero_sync_runs;')
 db.psql(`update public.accounting_refresh_jobs set attempt_expires_at=now()-interval '1 second' where id='${j.id}';`)
 db.rpc('select public.recover_accounting_refresh_work(25);')
 assert.equal(job(j).phase,'preparing');assert.equal(db.head().generationId,r.run);assert.equal(db.psql('select count(*) from public.xero_sync_runs;'),runs)
})
check('Promise edit while candidate builds invalidates old proposal and reuses certified recomputation',()=>{
 db.ready();const p=db.createPromise().promise,j=work(),r=boundCandidate(j),proposal=db.proposalFor(r)
 db.promiseRequest({operation:'edit',promiseId:p.id,amount:'3500'})
 assert.equal(db.promote(r,proposal).result_code,'promise_state_changed');assert.equal(job(j).phase,'running')
 assert.equal(db.promote(r,db.proposalFor(r)).promoted,true);assert.equal(db.promiseState(p.id).promised_amount_native,'3500')
})
check('priority/actions/dispute may change during candidate build without losing publication or history',()=>{
 db.ready();const j=work(),r=boundCandidate(j)
 db.psql(db.override());db.psql(db.action());const dispute=db.dispute()
 assert.equal(db.promote(r).promoted,true);assert.equal(db.psql(`select count(*) from public.invoice_disputes where id='${dispute}';`),'1')
 assert.equal(db.psql(`select count(*) from public.collection_actions where user_id='${db.user}';`),'1')
})
check('foreign attempt, provider, stale epoch and privileged engine are denied',()=>{
 const j=work()
 for(const changes of [{attempt:randomUUID(),epoch:j.connection.epoch},{attempt:j.attemptId,epoch:'999'}]) assert.throws(()=>db.rpc(`select * from public.acquire_accounting_xero_run('${j.id}','${changes.attempt}','${j.workerId}',1,${changes.epoch},'${db.owner}');`),/stale_/)
 for(const role of ['anon','authenticated'])assert.throws(()=>db.psql(`set role ${role};select public.inspect_accounting_xero_result('${j.id}',1);`),/permission denied/)
 assert.throws(()=>db.rpc(`select * from public.promote_xero_sync_run_with_promises_engine('${randomUUID()}','${db.owner}',1,null,null);`),/permission denied/)
 assert.equal(db.psql("select count(*) from pg_proc p where proname in('acquire_accounting_xero_run','inspect_accounting_xero_result','record_accounting_xero_diagnostics','accept_test_xero_accounting_refresh','record_xero_grant_auth_failure') and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'));"),'0')
})

check('real execution seam reuses importer, canonical/evidence mapping and atomic SQL then preparing',async()=>{
 const {loadTypeScriptModule}=await import('../xero/test-helpers/ts-module-loader.mjs')
 const {workerClient}=await import('./test-helpers/xero-worker-client.mjs')
 const {organisationResult,contact,invoice}=await import('../xero/test-helpers/xero-generation-import-harness.mjs')
 db.psql(`update public.xero_oauth_grants set scopes=array['offline_access','accounting.settings.read','accounting.contacts.read','accounting.transactions.read'] where user_id='${db.user}';`)
 const j=work(),admin=workerClient(db),grant=db.psql(`select grant_id from public.xero_connections_public where user_id='${db.user}' and tenant_id='tenant-a';`)
 const api=loadTypeScriptModule('lib/xero/accounting-refresh-execution.ts',{mocks:{
  '@sentry/nextjs':{captureMessage:()=>{}},
  '@/lib/xero/sync':{getValidXeroAccessTokenForTenant:async()=>({ok:true,accessToken:'local-only',grantId:grant,scopes:['offline_access','accounting.settings.read','accounting.contacts.read','accounting.transactions.read'],connection:{tenant_id:'tenant-a'}})},
 }})
 const {AccountingAttemptController}=loadTypeScriptModule('lib/accounting/attempt-controller.ts')
 const {heartbeatAccountingRefreshAttempt}=loadTypeScriptModule('lib/accounting/control-server.ts')
 const authority=new AccountingAttemptController(()=>heartbeatAccountingRefreshAttempt(admin,j),30000)
 const saved=globalThis.fetch;let requests=0
 globalThis.fetch=async(url)=>{
   requests++;const u=new URL(url),type=u.pathname.split('/').at(-1)
   const records=type==='Organisation'?organisationResult('tenant-a',{Timezone:'Europe/London'}).records:type==='Contacts'?[contact('c1')]:type==='Invoices'&&!(u.searchParams.get('where')??'').includes('Status=="PAID"')?[invoice('i1','c1','AUTHORISED')]:[]
   const key={Organisation:'Organisations',Contacts:'Contacts',Invoices:'Invoices',Payments:'Payments',Overpayments:'Overpayments',Prepayments:'Prepayments',CreditNotes:'CreditNotes'}[type]
   // Each nonempty collection ends at the second page.
   return Response.json({[key]:Number(u.searchParams.get('page')??1)>1?[]:records})
 }
 try {
  const r=await api.executeXeroAccountingRefresh({admin,job:j,authority,deadlineAtMs:Date.now()+60000,bookkeepingAtMs:Date.now()+90000})
  assert.equal(r.kind,'promoted');assert.equal(job(j).phase,'preparing');assert.equal(db.head().generationId,r.runId)
  assert.ok(requests>10);assert.ok(admin.calls.some(c=>c.name==='record_xero_customer_credit_stability_validation'))
  assert.ok(admin.calls.some(c=>c.name==='promote_xero_sync_run_with_promises'));assert.ok(!admin.calls.some(c=>/billing|usage_day/.test(c.name)))
 }finally{globalThis.fetch=saved;await authority.stop()}
})

check('compatibility generation owns single-flight even without the shorter admission lock',()=>{
 const r=db.candidate(),j=work(),a=parse(`select to_jsonb(r) from public.acquire_accounting_xero_run('${j.id}','${j.attemptId}','${j.workerId}',1,${j.connection.epoch},'${randomUUID()}') r;`)
 assert.equal(a.acquired,false);assert.equal(a.result_code,'lease_held');assert.equal(a.sync_run_id,r.run)
 assert.equal(job(j).generationRunId,r.run);assert.equal(db.psql('select count(*) from public.xero_sync_runs;'),'1')
 assert.equal(db.promote(r).promoted,true);assert.equal(inspect(j).resultCode,'promoted');assert.equal(job(j).phase,'preparing')
})
check('compatibility publication also rejects relinked authority and cannot bypass through legacy alias',()=>{
 const old=db.ready(),r=db.candidate(),proposal=db.proposalFor(r)
 db.psql(`update public.xero_oauth_grants set authorization_revision=gen_random_uuid() where user_id='${db.user}';`)
 assert.throws(()=>db.promote(r,proposal),/stale_epoch/)
 assert.throws(()=>db.rpc(`select * from public.promote_xero_sync_run('${r.run}','${db.owner}',${r.fence},null);`),/stale_epoch/)
 assert.equal(db.head().generationId,old.run)
})

check('rollback-only hosted epoch certificate validates a copied candidate then rejects stale publication',async()=>{
 const {readFileSync}=await import('node:fs');const old=db.ready()
 db.psql(`begin;select set_config('yuohme.cert_owner','${db.user}',true);select set_config('yuohme.cert_tenant','tenant-a',true);${readFileSync('tests/database/accounting-xero-hosted-epoch.sql','utf8')}rollback;`)
 assert.equal(db.head().generationId,old.run);assert.equal(db.psql('select count(*) from public.accounting_refresh_jobs;'),'0')
})

check('old authorization/lock cannot mark a relinked grant unhealthy or clear new credentials',()=>{
 const j=work(),g=db.psql(`select grant_id from public.xero_connections_public where user_id='${db.user}' and tenant_id='tenant-a';`),lock=randomUUID()
 const revision=db.psql(`select authorization_revision from public.xero_oauth_grants where id='${g}';`)
 db.psql(`update public.xero_oauth_grants set refresh_lock_id='${lock}',refresh_lock_expires_at=now()+interval '45 seconds',access_token_encrypted='new-credential',authorization_revision=gen_random_uuid() where id='${g}';`)
 assert.equal(db.rpc(`select public.record_xero_grant_auth_failure('${db.user}','${g}','${lock}','${revision}');`),'f')
 assert.equal(db.psql(`select auth_state from public.xero_connections_public where user_id='${db.user}' and tenant_id='tenant-a';`),'active')
 assert.equal(db.psql(`select access_token_encrypted from public.xero_oauth_grants where id='${g}';`),'new-credential')
 assert.equal(job(j).phase,'cancelled')
})

check('superseded observed success hands off without pairing an old generation with current F',()=>{
 const r=db.candidate(),j=work()
 parse(`select to_jsonb(a) from public.acquire_accounting_xero_run('${j.id}','${j.attemptId}','${j.workerId}',1,${j.connection.epoch},'${randomUUID()}') a;`)
 assert.equal(db.promote(r).promoted,true);const newer=db.ready(),result=inspect(j)
 assert.equal(result.runId,r.run);assert.equal(result.financialEpoch,null);assert.equal(job(j).phase,'preparing');assert.equal(db.head().generationId,newer.run)
})
