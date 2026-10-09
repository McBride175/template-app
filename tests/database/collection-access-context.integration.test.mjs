import assert from 'node:assert/strict'
import test,{before,after,beforeEach} from 'node:test'
import * as db from './test-helpers/dependency-database-fixture.mjs'
import {client} from './test-helpers/portfolio-client.mjs'
import {loadTypeScriptModule} from '../xero/test-helpers/ts-module-loader.mjs'
const access=loadTypeScriptModule('lib/collections/access-context-server.ts')
const {snapshotFromCollectionAccessContext,applyXeroAuthoritativeSnapshot}=loadTypeScriptModule('lib/xero/authoritative-snapshot.ts')
const {deriveCollectionsCurrencyContext}=loadTypeScriptModule('lib/collections/currency-context.ts')
const enabled=process.env.RUN_SUPABASE_INTEGRATION==='1',check=(n,f)=>test(n,{skip:!enabled},f)
before(()=>{if(enabled)db.setup()});after(()=>{if(enabled)db.cleanup()});beforeEach(()=>{if(enabled)db.reset()})
const now=()=>new Date()
const args=(admin=client(db),extra={})=>({admin,userId:db.user,tenantId:'tenant-a',supabase:{},now:now(),...extra})
const read=p=>access.readCollectionAccessDatabaseContext(p??args())
function subscription(status='active',price='price_access_pro',until="now()+interval '1 day'"){
 db.psql(`insert into public.subscriptions(user_id,stripe_customer_id,stripe_subscription_id,status,stripe_price_id,current_period_end,stripe_subscription_created_at) values('${db.user}','cus_access','sub_access',${db.quote(status)},${db.quote(price)},${until},now());`)
}
check('ordered replay; context matches predecessor values under one scoped snapshot',async()=>{
 const run=db.ready();const c=await read();const old=JSON.parse(db.rpc(`select public.read_dashboard_bootstrap_context('${db.user}','tenant-a',current_date,array[]::text[],now());`))
 for(const key of Object.keys(old)) assert.deepEqual(c[key],old[key],key)
 assert.equal(c.snapshot.syncRunId,run.run);assert.equal(c.financialEpoch,db.head().financialEpoch)
 const snapshot=snapshotFromCollectionAccessContext(c,{userId:db.user,tenantId:'tenant-a'})
 const queries=[];applyXeroAuthoritativeSnapshot({eq:(...q)=>queries.push(q)},snapshot)
 assert.deepEqual(queries,[['sync_run_id',run.run]])
 assert.equal(c.organisation.base_currency_code,'GBP')
})
check('paid entitlement is one RPC, exact configured Pro, no free-day claim',async()=>{
 process.env.STRIPE_PRICE_ID_PRO='price_access_pro'
 try{db.ready();subscription();const admin=client(db),r=await access.claimCollectionAccess(args(admin))
 assert.deepEqual(admin.calls.map(c=>c.name),['read_collection_access_context'])
 assert.equal(r.entitlement.paidPlan,'pro');assert.equal(r.entitlement.hasActionsAccess,true)
 assert.equal(r.entitlement.usageDaysRemaining,null);assert.equal(r.entitlement.usageDaysConsumed,0)
 assert.equal(db.psql('select count(*) from public.billing_usage_days'),'0')
 }finally{delete process.env.STRIPE_PRICE_ID_PRO}
})
check('five distinct UTC free days and repeat claims retain independently committed usage',async()=>{
 db.ready();const admin=client(db);const a=await access.claimCollectionAccess(args(admin)),b=await access.claimCollectionAccess(args(admin))
 assert.deepEqual(a.entitlement,b.entitlement);assert.equal(a.entitlement.usageDaysConsumed,1)
 assert.deepEqual(admin.calls.map(c=>c.name),['read_collection_access_context','claim_billing_usage_day','read_collection_access_context','claim_billing_usage_day'])
 assert.equal(db.psql('select count(*) from public.billing_usage_days'),'1')
 db.psql(`delete from public.billing_usage_days;insert into public.billing_usage_days(user_id,tenant_id,usage_date) select '${db.user}','tenant-a',current_date-s from generate_series(1,5)s;`)
 const exhausted=await access.claimCollectionAccess(args());assert.equal(exhausted.entitlement.hasActionsAccess,false)
 assert.equal(exhausted.entitlement.usageDaysConsumed,5);assert.equal(db.psql('select count(*) from public.billing_usage_days'),'5')
 // Failing a later business transaction cannot roll the earlier claim back.
 db.psql('delete from public.billing_usage_days');await access.claimCollectionAccess(args())
 assert.throws(()=>db.psql("begin;select 1/0;commit;"));assert.equal(db.psql('select count(*) from public.billing_usage_days'),'1')
})
check('expired/unknown subscription does not silently grant paid access',async()=>{
 process.env.STRIPE_PRICE_ID_PRO='price_access_pro'
 try{db.ready();subscription('active','price_access_pro',"now()-interval '1 second'")
 const r=await access.claimCollectionAccess(args());assert.equal(r.entitlement.isPaid,false);assert.equal(r.entitlement.plan,'free')
 db.psql("update public.subscriptions set current_period_end=now()+interval '1 day',stripe_price_id='unknown';")
 assert.equal((await access.claimCollectionAccess(args())).entitlement.isPaid,false)
 }finally{delete process.env.STRIPE_PRICE_ID_PRO}
})
check('wrong owner/requested tenant and disconnected state cannot grant tenant access',async()=>{
 db.ready();const foreign=await read(args(client(db),{userId:db.other}));assert.equal(foreign.connection,null);assert.equal(foreign.snapshot,null)
 const r=await access.claimCollectionAccess(args(client(db),{tenantId:'foreign'}));assert.equal(r.entitlement.tenantId,null);assert.equal(r.entitlement.hasActionsAccess,false)
 db.psql(`insert into public.billing_usage_days(user_id,tenant_id,usage_date)values('${db.user}','tenant-a',current_date);update public.xero_connections_public set auth_state='disconnected';`)
 const disconnected=await access.claimCollectionAccess(args());assert.equal(disconnected.entitlement.hasActionsAccess,false)
 assert.equal(disconnected.entitlement.usageDaysConsumed,1);assert.equal(disconnected.entitlement.usageDateConsumed,true)
})
check('invalid/non-succeeded pointers fail closed; legacy null remains explicit',async()=>{
 let c=await read();assert.equal(c.snapshot.mode,'legacy')
 db.ready();const running=db.candidate();assert.throws(()=>db.psql(`update public.xero_sync_tenant_state set active_sync_run_id='${running.run}';`),/pointer is invalid/)
 // Existing disposable-database corruption hook; never run against hosted data.
 db.psql(`set session_replication_role=replica;update public.xero_sync_tenant_state set active_sync_run_id='${running.run}';set session_replication_role=origin;`)
 c=await read();assert.equal(c.invalidSnapshot,true);assert.equal(c.snapshot,null)
 assert.throws(()=>snapshotFromCollectionAccessContext(c,{userId:db.user,tenantId:'tenant-a'}))
})
check('gross currency aggregate exactly matches existing pure population, not dispute/Promise/net credit',async()=>{
 db.ready();db.dispute();db.createPromise()
 const current=await read();assert.deepEqual(access.collectionAccessCurrencyContext(current),
  deriveCollectionsCurrencyContext([{type:'ACCREC',status:'AUTHORISED',customer_source_id:'c1',transaction_currency_code:'GBP',amount_due_native:'9000'}]))
 // Mixed/unavailable valuation is exercised as explicit legacy input, not
 // forced through the readiness guard for certified immutable generations.
 db.reset()
 const rows=[
  {source_id:'i1',customer_source_id:'c1',transaction_currency_code:'GBP',amount_due_native:'9000'},
  {source_id:'a',customer_source_id:'c2',transaction_currency_code:'USD',amount_due_native:'10'},
  {source_id:'b',customer_source_id:'c2',transaction_currency_code:null,amount_due_native:'11'},
  {source_id:'c',customer_source_id:'c2',transaction_currency_code:'EUR',amount_due_native:'0'},
  {source_id:'d',customer_source_id:'c2',transaction_currency_code:'EUR',type:'ACCPAY',amount_due_native:'12'},
  {source_id:'e',customer_source_id:'c2',transaction_currency_code:'EUR',status:'PAID',amount_due_native:'12'},
  {source_id:'f',customer_source_id:'c2',transaction_currency_code:'EUR',amount_due_native:null},
 ].map(r=>({type:'ACCREC',status:'AUTHORISED',...r}))
 for(const r of rows){const currency=r.transaction_currency_code,amount=r.amount_due_native===null?'null':db.quote(r.amount_due_native)
  db.psql(`insert into public.canonical_invoices(user_id,tenant_id,source_system,source_id,customer_source_id,type,status,currency_code,transaction_currency_code,organisation_base_currency_code,xero_currency_rate,amount_due_native,amount_due_base,currency_conversion_status,currency_conversion_failure_reason)
   values('${db.user}','tenant-a','xero',${db.quote(r.source_id)},${db.quote(r.customer_source_id)},${db.quote(r.type)},${db.quote(r.status)},${currency?db.quote(currency):'null'},${currency?db.quote(currency):'null'},'GBP',${currency&&currency!=='GBP'?'1':'null'},${amount},${currency?amount:'null'},${db.quote(!currency?'incomplete':currency==='GBP'?'identity':'converted')},${currency?'null':db.quote('missing_transaction_currency')});`)
 }
 const c=await read(),actual=access.collectionAccessCurrencyContext(c)
 assert.equal(c.snapshot.mode,'legacy');assert.deepEqual(actual,deriveCollectionsCurrencyContext(rows))
 assert.equal(actual.mode,'multi_currency');assert.equal(actual.relevantInvoiceCount,3)
 assert.deepEqual(actual.invoicedCurrencies,['GBP','USD'])
})
check('RPC is stable, fixed search path and service-only; unsupported provider rejected',async()=>{
 for(const role of ['anon','authenticated'])assert.throws(()=>db.psql(`set role ${role};select public.read_collection_access_context('${db.user}','tenant-a',current_date,array[]::text[],now(),'xero');`),/permission denied/)
 assert.throws(()=>db.rpc(`select public.read_collection_access_context('${db.user}','tenant-a',current_date,array[]::text[],now(),'other');`),/invalid_scope/)
 const p=JSON.parse(db.psql("select jsonb_build_object('stable',provolatile='s','path',proconfig,'definer',prosecdef)from pg_proc where oid='public.read_collection_access_context(uuid,text,date,text[],timestamptz,text)'::regprocedure;"))
 assert.equal(p.stable,true);assert.equal(p.definer,true);assert.deepEqual(p.path,['search_path=pg_catalog'])
})
check('reconnect retains licensed promoted reads; exhausted allowance still blocks product use',async()=>{
 const run=db.ready()
 for(const state of ['reauth_required','error']){
  db.psql(`update public.xero_connections_public set auth_state=${db.quote(state)} where user_id='${db.user}' and tenant_id='tenant-a';`)
  const c=await read();assert.equal(c.snapshot.syncRunId,run.run);assert.equal(access.hasReadableCollectionConnection(c),true)
  const r=await access.claimCollectionAccess(args());assert.equal(r.entitlement.hasActionsAccess,true);assert.equal(r.entitlement.tenantId,'tenant-a')
 }
 db.psql(`delete from public.billing_usage_days;insert into public.billing_usage_days(user_id,tenant_id,usage_date)select '${db.user}','tenant-a',current_date-s from generate_series(1,5)s;`)
 const exhausted=await access.claimCollectionAccess(args());assert.equal(exhausted.entitlement.hasActionsAccess,false);assert.equal(db.psql('select count(*) from public.billing_usage_days;'),'5')
})
