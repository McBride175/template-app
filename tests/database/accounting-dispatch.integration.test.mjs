import assert from 'node:assert/strict'
import test,{before,after,beforeEach} from 'node:test'
import * as db from './test-helpers/dependency-database-fixture.mjs'
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
const enabled=process.env.RUN_SUPABASE_INTEGRATION==='1',check=(n,f)=>test(n,{skip:!enabled},f),q=db.quote
const parse=s=>{const r=db.rpc(s);return r?JSON.parse(r):null}
before(()=>{if(enabled){db.setup();db.psql(`create table public.test_deliveries(id bigint generated always as identity,job uuid,delivery uuid);
 create or replace function accounting_refresh_private.delivery_settings() returns jsonb language sql stable set search_path=pg_catalog as $$select '{}'::jsonb$$;
 create or replace function accounting_refresh_private.submit_delivery(p_settings jsonb,p_project text,p_job uuid,p_delivery uuid) returns bigint language plpgsql set search_path=pg_catalog as $$declare i bigint;begin insert into public.test_deliveries(job,delivery) values(p_job,p_delivery) returning id into i;return i;end$$;`)}})
after(()=>{if(enabled)db.cleanup()})
beforeEach(()=>{if(enabled){db.reset();db.psql(`truncate public.test_deliveries;delete from accounting_refresh_private.dispatch_ticks;
 update accounting_refresh_private.dispatch_config set enabled=true,project_ref='rbmxegyiwntomhpbepnu';`)}})
function seed(trigger='manual',name=randomUUID(),allow=true){const c=parse(`select public.register_accounting_refresh_connection('${db.user}','foundation_certification',${q(name)},${q(name)},'fixture');`)
 const r=parse(`select public.accept_accounting_refresh('${c.connectionId}','${db.user}','foundation_certification',${q(name)},1,${q(trigger)});`).job
 if(allow)db.psql(`insert into accounting_refresh_private.synthetic_jobs(job_id,scenario) values('${r.id}','complete');`)
 return r}
const dispatch=(s='internal')=>parse(`select public.dispatch_accounting_refresh(${q(s)});`)
const claim=j=>parse(`select public.claim_accounting_refresh_attempt('${j.id}','${db.user}','foundation_certification',${q(j.connection.providerOrganisationId)},1,'${j.deliveryId}','${randomUUID()}',300);`).job
const latest=j=>parse(`select public.read_accounting_refresh_control('${db.user}','foundation_certification',${q(j.connection.providerOrganisationId)});`).job
check('idle and retained old connection produce zero deliveries and zero job intent',()=>{
 db.rpc(`select public.register_accounting_refresh_connection('${db.user}','foundation_certification','dormant','dormant','fixture');`)
 db.psql("update public.accounting_refresh_connections set next_scheduled_due_at=now()-interval '7 days';")
 const r=dispatch('cron');assert.equal(r.submitted,0);assert.equal(r.resultCode,'idle');assert.equal(db.psql('select count(*) from public.test_deliveries;'),'0');assert.equal(db.psql('select count(*) from public.accounting_refresh_jobs;'),'0')
})
check('disabled transport submits nothing; real/unmarked work is not executed by synthetic mode',()=>{
 seed('manual','unmarked',false);assert.equal(dispatch().submitted,0)
 db.psql('update accounting_refresh_private.dispatch_config set enabled=false;');assert.equal(dispatch().resultCode,'disabled')
})
check('dispatch reserves four by existing priority; full capacity submits zero',()=>{
 const s=seed('scheduled'),m=seed('manual'),o=seed('onboarding'),r=seed('reconnect'),i=seed('internal')
 assert.equal(dispatch().submitted,4);assert.equal(dispatch().submitted,0)
 const ids=db.psql('select job from public.test_deliveries order by id;').split('\n');assert.deepEqual(ids,[o.id,m.id,r.id,i.id]);assert.ok(!ids.includes(s.id))
})
check('live attempts and reservations jointly consume four slots',()=>{
 const a=seed(),b=seed(),c=seed(),d=seed(),e=seed()
 dispatch();claim(latest(a));claim(latest(b))
 assert.equal(dispatch().occupied,4);assert.equal(db.psql('select count(*) from public.test_deliveries;'),'4')
 assert.ok(latest(c).deliveryOwner);assert.ok(latest(d).deliveryOwner);assert.equal(latest(e).deliveryId,null)
})
check('overlapping dispatcher ticks cannot exceed capacity or duplicate delivery',async()=>{
 for(let i=0;i<8;i++)seed()
 await Promise.all(Array.from({length:5},()=>db.psqlAsync("set role service_role;select public.dispatch_accounting_refresh('cron');")))
 assert.equal(db.psql('select count(*) from public.test_deliveries;'),'4');assert.equal(db.psql('select count(distinct job) from public.test_deliveries;'),'4')
})
check('missed immediate signal is recovered by Cron using same logical job',()=>{
 const j=seed();assert.equal(latest(j).phase,'queued');assert.equal(dispatch('cron').submitted,1);assert.equal(latest(j).id,j.id)
})
check('lost delivery recovers after expiry with new nonce and no new job',()=>{
 const j=seed();dispatch();const old=latest(j)
 db.psql(`update public.accounting_refresh_jobs set delivery_expires_at=now()-interval '1 second' where id='${j.id}';`)
 const r=dispatch('cron');assert.equal(r.recoveredDeliveries,1);assert.equal(r.submitted,1);assert.notEqual(latest(j).deliveryId,old.deliveryId)
 assert.equal(parse(`select public.load_accounting_refresh_delivery('${j.id}','${old.deliveryId}');`),null)
})
check('duplicate delivery is loadable but cannot create another worker attempt',()=>{
 const j=seed();dispatch();const delivery=latest(j),first=claim(delivery)
 const second=parse(`select public.claim_accounting_refresh_attempt('${j.id}','${db.user}','foundation_certification',${q(j.connection.providerOrganisationId)},1,'${delivery.deliveryId}','${randomUUID()}',300);`)
 assert.equal(second.claimed,false);assert.equal(latest(j).attemptNumber,1);assert.equal(first.id,j.id)
})
check('lost worker is recovered with cooldown; stale heartbeat and completion reject',()=>{
 const j=seed();dispatch();const run=claim(latest(j))
 db.psql(`update public.accounting_refresh_jobs set attempt_expires_at=now()-interval '1 second' where id='${j.id}';`)
 const r=dispatch('cron');assert.equal(r.recoveredAttempts,1);assert.equal(r.submitted,0);assert.equal(latest(j).phase,'retry_wait')
 const args=`'${j.id}','${db.user}','foundation_certification',${q(j.connection.providerOrganisationId)},1,'${run.attemptId}','${run.workerId}',1`
 assert.throws(()=>db.rpc(`select public.heartbeat_accounting_refresh_attempt(${args});`),/stale_attempt/)
 assert.throws(()=>db.rpc(`select public.update_accounting_refresh_attempt(${args},'complete');`),/stale_attempt/)
 db.psql(`update public.accounting_refresh_jobs set next_eligible_at=now()-interval '1 second' where id='${j.id}';update public.accounting_refresh_connections set cooldown_until=null where id='${j.connection.connectionId}';`)
 assert.equal(dispatch().submitted,1);assert.equal(claim(latest(j)).attemptNumber,2)
})
check('epoch change invalidates delivery and stale attempt authority',()=>{
 const j=seed();dispatch();const r=claim(latest(j))
 db.rpc(`select public.advance_accounting_refresh_epoch('${j.connection.connectionId}','${db.user}','foundation_certification',${q(j.connection.providerOrganisationId)},1,'disconnect');`)
 assert.equal(parse(`select public.load_accounting_refresh_delivery('${j.id}','${r.deliveryId}');`),null)
 assert.throws(()=>db.rpc(`select public.heartbeat_accounting_refresh_attempt('${j.id}','${db.user}','foundation_certification',${q(j.connection.providerOrganisationId)},1,'${r.attemptId}','${r.workerId}',1);`),/stale_epoch/)
})
check('due retry dispatches; future retry does not; HTTP submit failure rolls reservation back',()=>{
 const j=seed();db.psql(`update public.accounting_refresh_jobs set next_eligible_at=now()+interval '1 hour' where id='${j.id}';`);assert.equal(dispatch().submitted,0)
 db.psql(`update public.accounting_refresh_jobs set next_eligible_at=now()-interval '1 second' where id='${j.id}';
 create or replace function accounting_refresh_private.submit_delivery(p_settings jsonb,p_project text,p_job uuid,p_delivery uuid) returns bigint language plpgsql set search_path=pg_catalog as $$begin raise exception 'test_submit_failure';end$$;`)
 assert.throws(()=>dispatch(),/test_submit_failure/);assert.equal(latest(j).deliveryId,null)
 db.psql(`create or replace function accounting_refresh_private.submit_delivery(p_settings jsonb,p_project text,p_job uuid,p_delivery uuid) returns bigint language plpgsql set search_path=pg_catalog as $$declare i bigint;begin insert into public.test_deliveries(job,delivery) values(p_job,p_delivery) returning id into i;return i;end$$;`)
 assert.equal(dispatch('cron').submitted,1)
})
check('transport RPCs are service-only; browser role cannot submit or claim',()=>{
 for(const role of ['anon','authenticated']) assert.throws(()=>db.psql(`set role ${role};select public.dispatch_accounting_refresh('internal');`),/permission denied/)
 assert.equal(db.psql("select count(*) from pg_proc p where proname in('dispatch_accounting_refresh','load_accounting_refresh_delivery','record_accounting_refresh_worker_event','set_accounting_refresh_cron') and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or p.proconfig is distinct from array['search_path=pg_catalog']);"),'0')
})
check('worker telemetry acknowledges heartbeat/result and deduplicates terminal observations',()=>{
 const j=seed();dispatch();const r=claim(latest(j))
 assert.equal(db.rpc(`select public.record_accounting_refresh_worker_event('${j.id}','${r.attemptId}','${r.workerId}','claimed');`),'t')
 assert.equal(db.rpc(`select public.record_accounting_refresh_worker_event('${j.id}','${r.attemptId}','${r.workerId}','heartbeat');`),'t')
 db.rpc(`select public.update_accounting_refresh_attempt('${j.id}','${db.user}','foundation_certification',${q(j.connection.providerOrganisationId)},1,'${r.attemptId}','${r.workerId}',1,'complete');`)
 for(let i=0;i<2;i++)assert.equal(db.rpc(`select public.record_accounting_refresh_worker_event('${j.id}','${r.attemptId}','${r.workerId}','result');`),'t')
 assert.equal(db.psql(`select claimed_count||'|'||heartbeat_count||'|'||completed_count from accounting_refresh_private.synthetic_jobs where job_id='${j.id}';`),'1|1|1')
})
check('idle queries use active-state indexes with substantial terminal history',()=>{
 const j=seed('internal','history',false)
 db.psql(`select public.cancel_accounting_refresh('${j.id}','${db.user}','foundation_certification','history',1);
 insert into public.accounting_refresh_jobs(connection_id,user_id,provider,provider_organisation_id,connection_epoch,trigger,latest_trigger,phase,completed_at)
 select '${j.connection.connectionId}','${db.user}','foundation_certification','history',1,'internal','internal','complete',now() from generate_series(1,5000);
 analyze public.accounting_refresh_jobs;`)
 const plan=JSON.parse(db.psql("explain(analyze,format json) select id from public.accounting_refresh_jobs where phase in('running','preparing') and attempt_expires_at>now();"))[0]
 assert.match(JSON.stringify(plan.Plan),/Index/);assert.equal(plan.Plan['Actual Rows'],0)
 assert.equal(dispatch('cron').submitted,0)
})
check('post-install hardening closes default net grants without disrupting the dispatcher owner',()=>{
 db.psql('create schema net;create function net.test_transport() returns boolean language sql as $$select true$$;grant usage on schema net to public,anon,authenticated,service_role;grant execute on function net.test_transport() to public,anon,authenticated,service_role;')
 const sql=readFileSync(new URL('../../supabase/migrations/20261008082615_accounting_transport_net_privileges.sql',import.meta.url),'utf8')
 db.psql(sql)
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(db.psql(`select has_schema_privilege('${role}','net','usage');`),'f')
  assert.equal(db.psql(`select has_function_privilege('${role}','net.test_transport()','execute');`),'f')
 }
 assert.equal(db.psql('select net.test_transport();'),'t')
})
