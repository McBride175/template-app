import assert from 'node:assert/strict'
import test, { before, after, beforeEach } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as db from './test-helpers/dependency-database-fixture.mjs'
const enabled=process.env.RUN_SUPABASE_INTEGRATION==='1'
const check=(name,fn)=>test(name,{skip:!enabled},fn)
const q=db.quote
const owner=db.user, other=db.other, org='tenant-a'
const scope=c=>`${q(c.connectionId)},${q(c.ownerId)},${q(c.provider)},${q(c.providerOrganisationId)},${c.epoch}`
const jobScope=j=>`${q(j.id)},${q(j.connection.ownerId)},${q(j.connection.provider)},${q(j.connection.providerOrganisationId)},${j.connection.epoch}`
const scalar=sql=>JSON.parse(db.rpc(sql))
const register=(user=owner,provider='xero',organisation=org)=>scalar(`select public.register_accounting_refresh_connection(${q(user)},${q(provider)},${q(organisation)},${q(organisation)},${provider==='xero'?"(select grant_id::text from public.xero_connections_public where user_id="+q(user)+" and tenant_id="+q(organisation)+")":q('verified-fixture')});`)
const accept=(c,trigger='scheduled',key=null,notBefore=null)=>scalar(`select public.accept_accounting_refresh(${scope(c)},${q(trigger)},${key===null?'null':q(key)},${notBefore===null?'null':q(notBefore)});`)
const reserve=(job,deliveryOwner=randomUUID())=>scalar(`select public.reserve_accounting_refresh_delivery(${jobScope(job)},${q(deliveryOwner)},60);`)
const claim=(job,worker=randomUUID(),delivery=job.deliveryId)=>scalar(`select public.claim_accounting_refresh_attempt(${jobScope(job)},${q(delivery)},${q(worker)},300);`)
const running=()=>{const c=register();const j=accept(c).job;const r=reserve(j);return claim(r.job).job}
const attempt=j=>`${jobScope(j)},${q(j.attemptId)},${q(j.workerId)},${j.attemptNumber}`
const update=(j,operation,opts={})=>scalar(`select public.update_accounting_refresh_attempt(${attempt(j)},${q(operation)},${opts.failureClass?q(opts.failureClass):'null'},${opts.failureCode?q(opts.failureCode):'null'},${opts.retryAt?q(opts.retryAt):'null'},${opts.providerNotBefore?q(opts.providerNotBefore):'null'},${q(opts.retrySource??'none')},${opts.generationRunId?q(opts.generationRunId):'null'});`)
const control=c=>scalar(`select public.read_accounting_refresh_control(${q(c.ownerId)},${q(c.provider)},${q(c.providerOrganisationId)});`)
const advance=(c,reason)=>scalar(`select public.advance_accounting_refresh_epoch(${scope(c)},${q(reason)});`)
const due=j=>db.psql(`update public.accounting_refresh_connections set cooldown_until=null,provider_not_before=null where id=${q(j.connection.connectionId)};update public.accounting_refresh_jobs set next_eligible_at=clock_timestamp()-interval '1 second',provider_not_before=null where id=${q(j.id)};`)
const businessCounts=()=>db.psql(`select jsonb_object_agg(name,n) from (
 select 'raw' name,count(*) n from public.xero_raw union all select 'runs',count(*) from public.xero_sync_runs
 union all select 'state',count(*) from public.xero_sync_tenant_state union all select 'customers',count(*) from public.canonical_customers
 union all select 'invoices',count(*) from public.canonical_invoices union all select 'payments',count(*) from public.canonical_payments
 union all select 'promises',count(*) from public.invoice_promises union all select 'disputes',count(*) from public.invoice_disputes
 union all select 'actions',count(*) from public.collection_actions union all select 'usage',count(*) from public.billing_usage_days
 union all select 'dependencies',count(*) from public.collection_dependency_heads) s;`)
before(()=>{if(enabled)db.setup()})
after(()=>{if(enabled)db.cleanup()})
beforeEach(()=>{if(enabled)db.reset()})
check('first request is queued with server clock and no business/billing writes',()=>{
 const before=businessCounts(),c=register(),result=accept(c,'manual','first')
 assert.equal(result.resultCode,'accepted');assert.equal(result.job.phase,'queued');assert.equal(result.job.attemptNumber,0)
 assert.equal(result.job.retryCount,0);assert.equal(result.job.connection.epoch,'1');assert.equal(result.job.generationRunId,null)
 assert.equal(businessCounts(),before)
})
check('duplicate and concurrent signals coalesce under the connection lock',async()=>{
 const c=register()
 const sql=trigger=>`set role service_role;begin;select public.accept_accounting_refresh(${scope(c)},${q(trigger)});select pg_sleep(0.05);commit;`
 const results=await Promise.all(['scheduled','manual','onboarding','opportunistic','internal','reconnect'].map(t=>db.psqlAsync(sql(t))))
 const jobs=results.map(r=>JSON.parse(r.split('\n')[0]).job)
 assert.equal(new Set(jobs.map(j=>j.id)).size,1)
 const j=control(c).job;assert.equal(j.requestCount,'6');assert.equal(j.trigger,'onboarding');assert.equal(j.priority,60)
})
check('same idempotency key is replayed concurrently without incrementing request count',async()=>{
 const c=register();const sql=`set role service_role;select public.accept_accounting_refresh(${scope(c)},'manual','stable-key');`
 const results=await Promise.all(Array.from({length:5},()=>db.psqlAsync(sql)))
 const jobs=results.map(r=>JSON.parse(r).job);assert.equal(new Set(jobs.map(j=>j.id)).size,1);assert.equal(control(c).job.requestCount,'1')
 assert.equal(db.psql(`select octet_length(key_hash) from public.accounting_refresh_request_keys;`),'32')
})
check('key identity is scoped by owner, organisation and provider',()=>{
 const a=register(owner,'fixture_provider','same-id'),b=register(other,'fixture_provider','same-id'),c=register(owner,'another_fixture','same-id'),d=register(owner,'fixture_provider','different-id')
 const jobs=[a,b,c,d].map(x=>accept(x,'manual','same-key').job.id);assert.equal(new Set(jobs).size,4)
 assert.equal(db.psql('select count(*) from public.accounting_refresh_request_keys;'),'4')
})
check('one-active-job partial index also rejects bypass through direct postgres insertion',()=>{
 const c=register();accept(c)
 assert.throws(()=>db.psql(`insert into public.accounting_refresh_jobs(connection_id,user_id,provider,provider_organisation_id,connection_epoch,trigger,latest_trigger)
 values(${scope(c)},'manual','manual');`),/accounting_refresh_one_active_job/)
})
check('terminal completion permits a new job but an old key remains a read-only replay',()=>{
 const j=running();const c=j.connection;const linked=accept(c,'manual','old-key');assert.equal(linked.job.id,j.id)
 update(j,'complete');const next=accept(c,'manual','new-key').job
 assert.notEqual(next.id,j.id);assert.equal(next.phase,'queued');assert.ok(Date.parse(next.nextEligibleAt)>Date.now()+290000)
 assert.equal(accept(c,'manual','old-key').job.id,j.id);assert.equal(control(c).job.id,next.id)
})
check('cancelled terminal permits new work and cancel is idempotent',()=>{
 const c=register(),j=accept(c).job
 assert.equal(scalar(`select public.cancel_accounting_refresh(${jobScope(j)});`).phase,'cancelled')
 assert.equal(scalar(`select public.cancel_accounting_refresh(${jobScope(j)});`).phase,'cancelled')
 assert.notEqual(accept(c).job.id,j.id)
})
check('cancelling a started attempt cannot bypass minimum attempt spacing',()=>{
 const j=running()
 scalar(`select public.cancel_accounting_refresh(${jobScope(j)});`)
 const next=accept(j.connection,'manual').job
 assert.ok(Date.parse(next.nextEligibleAt)>Date.now()+290000)
 assert.equal(reserve(next).reserved,false)
})
check('priority never downgrades; latest trigger and earliest queued due are preserved',()=>{
 const c=register();const future=new Date(Date.now()+3600000).toISOString()
 const first=accept(c,'scheduled',null,future).job;const manual=accept(c,'manual').job;const low=accept(c,'scheduled').job
 assert.equal(manual.id,first.id);assert.equal(low.trigger,'manual');assert.equal(low.latestTrigger,'scheduled')
 assert.ok(Date.parse(low.nextEligibleAt)<Date.parse(future));assert.equal(low.requestCount,'3')
 const high=accept(c,'onboarding').job;assert.equal(high.priority,60)
})
check('manual signal cannot shorten retry/provider cooldown or bypass blocked work',()=>{
 const j=running(),retryAt=new Date(Date.now()+900000).toISOString(),providerNotBefore=new Date(Date.now()+3600000).toISOString()
 const failed=update(j,'fail',{failureClass:'rate_limited',failureCode:'provider_rate_limited',retryAt,providerNotBefore,retrySource:'provider'})
 const joined=accept(j.connection,'onboarding').job
 assert.equal(joined.id,j.id);assert.equal(joined.phase,'retry_wait');assert.equal(joined.nextEligibleAt,failed.nextEligibleAt)
 assert.ok(Date.parse(joined.nextEligibleAt)>=Date.parse(providerNotBefore));assert.equal(joined.retryCount,1)
 assert.equal(db.rpc('select count(*) from public.list_accounting_refresh_work();'),'0')
})
check('eligible listing orders priority, then due/age, with a bounded starvation escape',()=>{
 const scheduled=accept(register(owner,'fixture_provider','a'),'scheduled').job
 const manual=accept(register(owner,'fixture_provider','b'),'manual').job
 let ids=scalar('select coalesce(jsonb_agg(j),\'[]\') from public.list_accounting_refresh_work(25) j;').map(j=>j.id)
 assert.deepEqual(ids,[manual.id,scheduled.id])
 // requested_at is immutable even to ordinary writes; use a fixture insert for an old request.
 const c=register(owner,'fixture_provider','old')
 db.psql(`insert into public.accounting_refresh_jobs(connection_id,user_id,provider,provider_organisation_id,connection_epoch,trigger,latest_trigger,requested_at)
 values(${scope(c)},'scheduled','scheduled',clock_timestamp()-interval '31 minutes');`)
 ids=scalar('select coalesce(jsonb_agg(j),\'[]\') from public.list_accounting_refresh_work(25) j;').map(j=>j.id)
 assert.equal(ids[0],control(c).job.id)
 assert.equal(db.rpc('select count(*) from public.list_accounting_refresh_work(1);'),'1')
})
check('reservation is exclusive and same-reserver retry is a no-op',async()=>{
 const c=register(),j=accept(c).job,a=randomUUID(),b=randomUUID()
 const results=await Promise.all([a,b].map(id=>db.psqlAsync(`set role service_role;select public.reserve_accounting_refresh_delivery(${jobScope(j)},${q(id)},60);`)))
 assert.equal(results.map(JSON.parse).filter(r=>r.reserved).length,1)
 const held=control(c).job;assert.equal(reserve(held,held.deliveryOwner).resultCode,'already_reserved')
 assert.equal(reserve(held,held.deliveryOwner).job.deliveryId,held.deliveryId)
})
check('one worker claims; duplicate same worker is idempotent; competing worker loses',async()=>{
 const c=register(),reserved=reserve(accept(c).job).job;const workers=[randomUUID(),randomUUID()]
 const results=await Promise.all(workers.map(id=>db.psqlAsync(`set role service_role;select public.claim_accounting_refresh_attempt(${jobScope(reserved)},${q(reserved.deliveryId)},${q(id)},300);`)))
 assert.equal(results.map(JSON.parse).filter(r=>r.claimed).length,1)
 const held=control(c).job;assert.equal(held.attemptNumber,1)
 const replay=claim(held,held.workerId,held.deliveryId);assert.equal(replay.resultCode,'already_claimed');assert.equal(replay.job.attemptId,held.attemptId)
})
check('claim rejects wrong/expired reservation and reservation can be released safely',()=>{
 const c=register(),j=reserve(accept(c).job).job
 assert.equal(claim(j,randomUUID(),randomUUID()).claimed,false)
 assert.equal(db.rpc(`select public.release_accounting_refresh_delivery(${jobScope(j)},${q(j.deliveryId)},${q(randomUUID())});`),'f')
 assert.equal(db.rpc(`select public.release_accounting_refresh_delivery(${jobScope(j)},${q(j.deliveryId)},${q(j.deliveryOwner)});`),'t')
 assert.equal(claim(j).claimed,false)
 const fresh=reserve(control(c).job).job
 db.psql(`update public.accounting_refresh_jobs set delivery_expires_at=clock_timestamp()-interval '1 second' where id=${q(j.id)};`)
 assert.equal(claim(fresh).claimed,false);assert.equal(db.rpc('select public.recover_accounting_refresh_work();'),'1')
 const next=reserve(control(c).job).job;assert.notEqual(next.deliveryId,fresh.deliveryId)
})
check('heartbeat is fenced by worker/attempt/epoch and does not acquire generation authority',()=>{
 const j=running(),before=businessCounts()
 const heartbeat=scalar(`select public.heartbeat_accounting_refresh_attempt(${attempt(j)},300);`)
 assert.equal(heartbeat.attemptId,j.attemptId);assert.ok(Date.parse(heartbeat.attemptExpiresAt)>=Date.parse(j.attemptExpiresAt))
 assert.throws(()=>scalar(`select public.heartbeat_accounting_refresh_attempt(${attempt({...j,workerId:randomUUID()})},300);`),/stale_attempt/)
 assert.throws(()=>scalar(`select public.heartbeat_accounting_refresh_attempt(${attempt({...j,attemptNumber:2})},300);`),/stale_attempt/)
 assert.equal(businessCounts(),before)
})
check('expired attempt recovers into cooldown and stale heartbeat/update fails',()=>{
 const j=running();db.psql(`update public.accounting_refresh_jobs set attempt_expires_at=clock_timestamp()-interval '1 second' where id=${q(j.id)};`)
 assert.throws(()=>scalar(`select public.heartbeat_accounting_refresh_attempt(${attempt(j)},300);`),/stale_attempt/)
 assert.equal(db.rpc('select public.recover_accounting_refresh_work();'),'1')
 const recovered=control(j.connection).job;assert.equal(recovered.phase,'retry_wait');assert.equal(recovered.failureCode,'attempt_lease_expired');assert.equal(recovered.retryCount,1)
 assert.ok(Date.parse(recovered.nextEligibleAt)>Date.now()+290000)
 due(recovered);const newer=claim(reserve(control(j.connection).job).job).job;assert.equal(newer.attemptNumber,2);assert.notEqual(newer.attemptId,j.attemptId)
 assert.throws(()=>update(j,'complete'),/stale_attempt/)
})
check('durable retry count increments exactly once per failed attempt',()=>{
 let j=running()
 for(const [minutes,source] of [[5,'local'],[15,'local'],[60,'local'],[360,'probe']]) {
   const failed=update(j,'fail',{failureClass:'transient',failureCode:'provider_timeout',retryAt:new Date(Date.now()+minutes*60000).toISOString(),retrySource:source})
   assert.equal(failed.retryCount,j.retryCount+1);assert.equal(failed.retrySource,source)
   assert.throws(()=>update(j,'fail',{failureClass:'transient',failureCode:'provider_timeout',retryAt:new Date().toISOString(),retrySource:'local'}),/stale_attempt/)
   due(failed);j=claim(reserve(control(j.connection).job).job).job
 }
 assert.equal(j.retryCount,4)
})
for(const failureClass of ['reconnect_required','deterministic_failure','unknown']) check(`${failureClass} pauses without a new parallel job`,()=>{
 const j=running();const failed=update(j,'fail',{failureClass,failureCode:'certified_failure'})
 assert.equal(failed.phase,failureClass==='reconnect_required'?'reconnect_required':'attention_required')
 assert.equal(accept(j.connection,'onboarding').job.id,j.id);assert.equal(db.rpc('select count(*) from public.list_accounting_refresh_work();'),'0')
})
check('permanent retry override and raw failure descriptions are rejected',()=>{
 const j=running()
 assert.throws(()=>update(j,'fail',{failureClass:'deterministic_failure',failureCode:'mapping_invalid',retryAt:new Date().toISOString(),retrySource:'local'}),/permanent_retry/)
 assert.throws(()=>update(j,'fail',{failureClass:'transient',failureCode:'secret raw error',retryAt:new Date().toISOString(),retrySource:'local'}),/invalid_failure/)
 assert.throws(()=>update(j,'fail',{failureClass:'preparation_failure',failureCode:'prepare_failed'}),/invalid_preparation/)
})
check('epoch invalidation cancels pending/running work; old references and workers are stale',()=>{
 const j=running(),before=businessCounts();const next=advance(j.connection,'disconnect')
 assert.equal(next.epoch,'2');assert.equal(next.invalidated,true);assert.equal(control(next).job.phase,'cancelled')
 assert.throws(()=>accept(j.connection,'manual'),/stale_epoch/)
 assert.throws(()=>accept(next,'manual'),/connection_unavailable/)
 assert.throws(()=>scalar(`select public.heartbeat_accounting_refresh_attempt(${attempt(j)},300);`),/stale_epoch/)
 assert.equal(businessCounts(),before)
 const reconnected=advance(next,'reconnect');assert.equal(reconnected.epoch,'3');assert.equal(reconnected.invalidated,false)
 assert.notEqual(accept(reconnected,'reconnect').job.id,j.id)
})
check('relink is scoped; changed grant binding rotates epoch without touching history',()=>{
 const c=register(),j=accept(c).job
 const newGrant=randomUUID()
 db.psql(`insert into public.xero_oauth_grants(id,user_id,xero_user_id,scopes,refresh_token_encrypted) values(${q(newGrant)},${q(owner)},'new-fixture',array['offline_access'],'synthetic');
 update public.xero_connections_public set grant_id=${q(newGrant)} where user_id=${q(owner)} and tenant_id=${q(org)};`)
 const before=businessCounts(),relinked=register();assert.equal(relinked.epoch,'2');assert.equal(control(relinked).job.phase,'cancelled')
 assert.equal(businessCounts(),before);assert.notEqual(accept(relinked).job.id,j.id)
})
check('organisation change invalidates old scope and never transfers jobs/history',()=>{
 const a=register(owner,'fixture_provider','old'),b=register(owner,'fixture_provider','new');const j=accept(a).job
 advance(a,'organisation_changed');const n=accept(b).job;assert.notEqual(n.id,j.id);assert.equal(n.connection.epoch,'1')
 assert.equal(control(a).job.phase,'cancelled')
})
check('foreign owner/provider/organisation and forged connection ID are rejected',()=>{
 const c=register(),j=accept(c).job
 for(const invalid of [{...c,ownerId:other},{...c,provider:'fixture_provider'},{...c,providerOrganisationId:'other-org'},{...c,connectionId:randomUUID()}]) assert.throws(()=>accept(invalid),/invalid_scope/)
 assert.throws(()=>reserve({...j,connection:{...j.connection,ownerId:other}}),/invalid_scope/)
 assert.throws(()=>scalar(`select public.register_accounting_refresh_connection(${q(other)},'xero','tenant-a','tenant-a','unlinked');`),/invalid_connection/)
 assert.throws(()=>scalar(`select public.register_accounting_refresh_connection(${q(owner)},'xero','missing','missing','unlinked');`),/invalid_connection/)
})
check('actual Xero disconnect invalidates eligibility even before epoch wiring',()=>{
 const c=register(),j=accept(c).job
 db.psql(`update public.xero_connections_public set auth_state='disconnected',grant_id=null where user_id=${q(owner)};`)
 assert.equal(db.rpc('select count(*) from public.list_accounting_refresh_work();'),'0')
 assert.throws(()=>reserve(j),/connection_unavailable/)
 const observed=scalar(`select public.register_accounting_refresh_connection(${q(owner)},'xero','tenant-a','tenant-a','unlinked');`)
 assert.equal(observed.epoch,'2');assert.equal(control(observed).job.phase,'cancelled')
})
check('schedule accepts only meaningful activity and never claims usage',()=>{
 const c=register(),before=businessCounts()
 const result=scalar(`select public.set_accounting_refresh_schedule(${scope(c)},'dashboard',clock_timestamp()+interval '1 hour');`)
 assert.ok(result.lastProductActivityAt);assert.ok(result.nextScheduledDueAt)
 for(const kind of ['status','scheduler','background_refresh','provider_callback','login']) assert.throws(()=>scalar(`select public.set_accounting_refresh_schedule(${scope(c)},${q(kind)},null);`),/invalid_activity/)
 assert.equal(businessCounts(),before)
})
check('service-only function grants, RLS, no browser tables and no direct service writes',()=>{
 const tables=['accounting_refresh_connections','accounting_refresh_jobs','accounting_refresh_request_keys']
 for(const role of ['anon','authenticated']) {
   for(const table of tables) for(const permission of ['SELECT','INSERT','UPDATE','DELETE']) assert.equal(db.psql(`select has_table_privilege(${q(role)},${q('public.'+table)},${q(permission)});`),'f')
   assert.throws(()=>db.psql(`set role ${role};select * from public.list_accounting_refresh_work();`),/permission denied/)
   assert.throws(()=>db.psql(`set role ${role};select * from public.accounting_refresh_jobs;`),/permission denied/)
 }
 assert.equal(db.psql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
   and p.proname in('register_accounting_refresh_connection','accept_accounting_refresh','read_accounting_refresh_control','list_accounting_refresh_work',
   'reserve_accounting_refresh_delivery','release_accounting_refresh_delivery','claim_accounting_refresh_attempt','heartbeat_accounting_refresh_attempt',
   'update_accounting_refresh_attempt','advance_accounting_refresh_epoch','cancel_accounting_refresh','recover_accounting_refresh_work','set_accounting_refresh_schedule')
   and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or not has_function_privilege('service_role',p.oid,'execute')
     or not p.prosecdef or p.proconfig is distinct from array['search_path=pg_catalog']);`),'0')
 for(const table of tables) assert.equal(db.psql(`select has_table_privilege('service_role',${q('public.'+table)},'UPDATE');`),'f')
 assert.equal(db.psql(`select count(*) from pg_class where oid in(${tables.map(t=>q('public.'+t)+'::regclass').join(',')}) and relrowsecurity;`),'3')
 assert.equal(db.psql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='accounting_refresh_private' and has_function_privilege('service_role',p.oid,'execute');`),'0')
})
check('malformed request/reservation/claim bounds are rejected',()=>{
 const c=register(),j=accept(c).job
 assert.throws(()=>accept(c,'invalid'),/invalid_request/);assert.throws(()=>accept(c,'manual',' x '),/invalid_request/)
 assert.throws(()=>scalar(`select public.reserve_accounting_refresh_delivery(${jobScope(j)},${q(randomUUID())},-1);`),/invalid_reservation/)
 const r=reserve(j).job;assert.throws(()=>scalar(`select public.claim_accounting_refresh_attempt(${jobScope(r)},${q(r.deliveryId)},${q(randomUUID())},99999);`),/invalid_claim/)
})
check('generation association rejects a foreign or absent Xero generation; no generation is created',()=>{
 const j=running(),before=businessCounts()
 assert.throws(()=>update(j,'bind_generation',{generationRunId:randomUUID()}),/generation_scope/)
 assert.throws(()=>update(j,'preparing'),/generation_not_promoted/)
 assert.equal(businessCounts(),before)
})
check('derivative continuation is separate metadata and is never demoted to provider work',()=>{
 const c=register(owner,'fixture_provider','prepare'),j=claim(reserve(accept(c).job).job).job
 const prepared=update(j,'preparing',{generationRunId:randomUUID()});assert.equal(prepared.stage,'derivatives')
 const failed=update(prepared,'fail',{failureClass:'preparation_failure',failureCode:'prepare_failed',retryAt:new Date(Date.now()+60000).toISOString(),retrySource:'local'})
 due(failed);const next=claim(reserve(control(c).job).job).job;assert.equal(next.phase,'preparing');assert.equal(next.stage,'derivatives')
 assert.equal(update(next,'complete').phase,'complete')
})
check('owner deletion cascades only owned control state',()=>{
 const c=register(),j=accept(c,'manual','erase').job,b=register(other,'fixture_provider','other');accept(b)
 db.psql(`delete from auth.users where id=${q(owner)};`)
 assert.equal(db.psql(`select count(*) from public.accounting_refresh_jobs where id=${q(j.id)};`),'0')
 assert.equal(db.psql('select count(*) from public.accounting_refresh_request_keys;'),'0')
 assert.ok(control(b).job)
})
check('new migration installs no scheduling extensions or cron jobs',()=>{
 assert.equal(db.psql("select count(*) from pg_extension where extname in('pg_cron','pg_net','pgmq');"),'0')
 assert.equal(db.psql("select count(*) from pg_trigger where not tgisinternal and tgname like 'accounting_refresh%' and tgrelid<>'public.accounting_refresh_jobs'::regclass;"),'0')
})
check('rollback-only hosted certification passes on the clean local replay',()=>{
 const before=businessCounts()
 const sql=readFileSync(new URL('./accounting-refresh-hosted-certification.sql',import.meta.url),'utf8')
 assert.equal(db.psql(sql),'phase_7_1_hosted_control_certified_rollback_only')
 assert.equal(businessCounts(),before)
 assert.equal(db.psql("select count(*) from public.accounting_refresh_connections where provider='foundation_certification';"),'0')
})
