import assert from 'node:assert/strict'
import test,{before,after,beforeEach} from 'node:test'
import * as db from './test-helpers/dependency-database-fixture.mjs'
import { cert } from './test-helpers/materialization-client.mjs'
import { client,portfolio,parameters } from './test-helpers/portfolio-client.mjs'
import {loadTypeScriptModule} from '../xero/test-helpers/ts-module-loader.mjs'
const {readDashboardBootstrap}=loadTypeScriptModule('lib/dashboard/bootstrap-server.ts')
const {readCollectionQueueProjection}=loadTypeScriptModule('lib/collections/fast-queue-projection-server.ts')
const {DASHBOARD_CARD_FIELDS}=loadTypeScriptModule('lib/dashboard/collection-projection.ts')
const enabled=process.env.RUN_SUPABASE_INTEGRATION==='1',check=(name,fn)=>test(name,{skip:!enabled},fn)
const now=()=>new Date(),date=()=>now().toISOString().slice(0,10)
before(()=>{if(enabled)db.setup()});after(()=>{if(enabled)db.cleanup()})
beforeEach(()=>{if(enabled){db.reset(); db.psql(`delete from public.billing_usage_days; update public.xero_oauth_grants set scopes=array['offline_access','accounting.settings.read','accounting.contacts.read','accounting.invoices.read','accounting.payments.read'];`)}})
async function ready(){const run=db.ready({invoiceChanges:{due_date:'2026-09-01'}});cert(db,run.run);await portfolio.ensurePortfolioBaseCalculation(parameters(db,client(db),`${date()}T12:00:00Z`));return run}
const read=admin=>readDashboardBootstrap({admin:admin??client(db),userId:db.user,tenantId:'tenant-a'})
check('complete warm bootstrap performs five RPCs, claims one day and matches rich queue card fields',async()=>{
 await ready();const admin=client(db),r=await read(admin)
 assert.equal(r.collectionState,'ready');assert.equal(r.metrics.databaseCalls,5);assert.equal(r.metrics.calculationRebuilt,false)
 assert.equal(r.collection.entitlement.hasActionsAccess,true)
 const p=await readCollectionQueueProjection({admin,userId:db.user,tenantId:'tenant-a',evaluationInstant:now(),overdueOnly:true,limit:200,legacyTodayDateIso:date()})
 for(const [i,row] of r.collection.rows.entries()) for(const key of DASHBOARD_CARD_FIELDS) assert.deepEqual(row[key],p.rows[i][key],key)
 assert.deepEqual(r.collection.queue,p.queue)
 assert.equal(db.psql('select count(*) from public.billing_usage_days;'),'1')
 await read();assert.equal(db.psql('select count(*) from public.billing_usage_days;'),'1')
 assert.equal(admin.calls.some(c=>/canonical|materialization|publish/.test(c.name)),false)
})
check('paid access skips the free ledger and retains configured plan',async()=>{
 process.env.STRIPE_PRICE_ID_PRO='price_local_dashboard_pro'
 try{await ready();db.psql(`insert into public.subscriptions(user_id,stripe_customer_id,stripe_subscription_id,status,stripe_price_id,current_period_end,stripe_subscription_created_at) values('${db.user}','cus_local','sub_local','active','price_local_dashboard_pro',now()+interval '1 day',now());`)
 const r=await read();assert.equal(r.collection.entitlement.paidPlan,'pro');assert.equal(r.collection.entitlement.usageDaysRemaining,null)
 assert.equal(db.psql('select count(*) from public.billing_usage_days;'),'0')
 }finally{delete process.env.STRIPE_PRICE_ID_PRO}
})
check('free exhaustion blocks collections without reading financial projection',async()=>{
 await ready();db.psql(`insert into public.billing_usage_days(user_id,tenant_id,usage_date) select '${db.user}','tenant-a',current_date-s from generate_series(1,5) s;`)
 const admin=client(db),r=await read(admin);assert.equal(r.collectionState,'blocked');assert.equal(r.collection.code,'ACTION_USAGE_LIMIT_REACHED')
 assert.equal(admin.calls.length,3);assert.equal(db.psql('select count(*) from public.billing_usage_days;'),'5')
})
check('no connection and owner/tenant isolation return onboarding with no financial rows',async()=>{
 const r=await read();assert.equal(r.collectionState,'onboarding');assert.equal(r.status.lastSyncedAt,null)
 const foreign=await readDashboardBootstrap({admin:client(db),userId:db.other,tenantId:'tenant-a'});assert.equal(foreign.status.connected,false);assert.equal(foreign.collection,null)
 for(const role of ['anon','authenticated']) assert.throws(()=>db.psql(`set role ${role}; select public.read_collection_access_context('${db.user}','tenant-a',current_date,array[]::text[],now());`),/permission denied/)
 db.psql(`delete from auth.users where id='${db.user}';`)
 assert.equal((await read()).status.connected,false)
})
check('failed and running refreshes retain authoritative accounting recommendations',async()=>{
 const run=await ready()
 db.psql(`update public.xero_connections_public set last_refresh_error='refresh_failed';`)
 const failed=await read();assert.equal(failed.status.syncState,'temporary_sync_issue');assert.equal(failed.collectionState,'ready')
 const newer=db.candidate();const running=await read();assert.equal(running.status.syncState,'sync_in_progress')
 assert.equal(running.collection.version.accountingGenerationId,run.run);assert.equal(running.collection.rows.length,1)
 assert.notEqual(newer.run,run.run)
})
check('cold calculation uses existing ensure and subsequent read is a hit',async()=>{
 const run=db.ready({invoiceChanges:{due_date:'2026-09-01'}});cert(db,run.run)
 const cold=await read();assert.equal(cold.collectionState,'ready');assert.equal(cold.metrics.calculationRebuilt,true)
 const warm=await read();assert.equal(warm.metrics.calculationRebuilt,false);assert.equal(warm.metrics.databaseCalls,5)
 assert.equal(warm.collection.version.financialCalculationId,cold.collection.version.financialCalculationId)
})
check('P mutation during final context read retries and returns current priority',async()=>{
 await ready();let changed=false
 const admin=client(db,async(name)=>{if(name==='read_collection_access_context'&&admin.calls.filter(c=>c.name===name).length===2&&!changed){changed=true;db.psql(db.override())}})
 const r=await read(admin);assert.equal(changed,true);assert.equal(r.collection.rows[0].override_level,'priority')
 assert.equal(r.collection.version.projectionRevision,db.head().projectionRevision)
})
check('generation promotion during bootstrap cannot relabel old recommendations current',async()=>{
 await ready();let changed=false,newRun
 const admin=client(db,async(name)=>{if(name==='read_collection_access_context'&&admin.calls.filter(c=>c.name===name).length===2&&!changed){changed=true;newRun=db.ready({invoiceChanges:{due_date:'2026-09-01',amount_due_native:'5000',amount_due_base:'5000'}});cert(db,newRun.run)}})
 const r=await read(admin);assert.equal(r.collectionState,'ready');assert.equal(r.collection.version.accountingGenerationId,newRun.run)
 assert.equal(r.collection.rows[0].customer_to_chase_overdue_base,5000)
})
check('connection revocation during bootstrap discards financial payload',async()=>{
 await ready();let changed=false
 const admin=client(db,async(name)=>{if(name==='read_collection_access_context'&&admin.calls.filter(c=>c.name===name).length===2&&!changed){changed=true;db.psql(`update public.xero_connections_public set auth_state='reauth_required';`)}})
 const r=await read(admin);assert.equal(r.collectionState,'onboarding');assert.equal(r.status.needsReauth,true);assert.equal(r.collection,null)
})
check('inconsistent active generation fails closed without legacy accounting fallback',async()=>{
 await ready();db.psql(`set session_replication_role=replica; update public.xero_sync_tenant_state set active_sync_run_id=gen_random_uuid(); set session_replication_role=origin;`)
 const r=await read();assert.equal(r.collectionState,'unavailable');assert.equal(r.collection,null)
 assert.equal(r.status.canSync,false);assert.ok(r.statusError)
})

check('first-value onboarding and insufficient permissions do not claim a free day',async()=>{
 await read();assert.equal(db.psql('select count(*) from public.billing_usage_days;'),'0')
 await ready();db.psql("update public.xero_oauth_grants set scopes=array['offline_access'];")
 const r=await read();assert.equal(r.status.needsReauth,true);assert.equal(r.collectionState,'onboarding')
 assert.equal(db.psql('select count(*) from public.billing_usage_days;'),'0')
})

check('readiness observation reads one scoped context with no ledger or financial population',async()=>{
 const run=await ready();const admin=client(db)
 const {readDashboardReadiness}=loadTypeScriptModule('lib/dashboard/bootstrap-server.ts')
 const r=await readDashboardReadiness({admin,userId:db.user,tenantId:'tenant-a'})
 assert.equal(r.version.accountingGenerationId,run.run);assert.equal(admin.calls.length,1)
 assert.equal(admin.calls[0].name,'read_collection_access_context')
 assert.equal(db.psql('select count(*) from public.billing_usage_days;'),'0')
})

check('unknown preferred tenant preserves status selection but cannot claim/read another tenant queue',async()=>{
 await ready();const admin=client(db),r=await readDashboardBootstrap({admin,userId:db.user,tenantId:'unknown-tenant'})
 assert.equal(r.status.connected,true);assert.equal(r.status.tenantId,'tenant-a')
 assert.equal(r.collectionState,'unavailable');assert.equal(r.collection.code,'NO_XERO_TENANT')
 assert.equal(admin.calls.length,2);assert.equal(db.psql('select count(*) from public.billing_usage_days;'),'0')
})
