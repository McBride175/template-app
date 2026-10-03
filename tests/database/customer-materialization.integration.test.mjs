import assert from 'node:assert/strict'
import test, {before,after,beforeEach} from 'node:test'
import * as db from './test-helpers/dependency-database-fixture.mjs'
import {databaseClient,params,server,featureFromInputs,cert} from './test-helpers/materialization-client.mjs'
const enabled=process.env.RUN_SUPABASE_INTEGRATION==='1'
const check=(name,fn)=>test(name,{skip:!enabled},fn)
before(()=>{if(enabled)db.setup()});after(()=>{if(enabled)db.cleanup()});beforeEach(()=>{if(enabled)db.reset()})
const basisCount=()=>Number(db.psql('select count(*) from public.collection_customer_bases;'))
const run2=()=>db.ready({extraInvoices:[{source_id:'i2',customer_source_id:'c2',amount_due_native:'500',amount_due_base:'500'}],invoiceChanges:{due_date:'2026-09-01',issue_date:'2026-08-01'}})
const readInput=(g,ids=['c1'])=>JSON.parse(db.rpc(`select public.read_collection_customer_feature_inputs('${db.user}','tenant-a','${g}',array[${ids.map(db.quote)}]);`))
const publish=(g,identity,results,date='2026-10-01')=>db.rpc(`select public.publish_collection_customer_features('${db.user}','tenant-a','${g}','${date}',${db.quote(identity)},${db.json(results)});`)
check('migration replay; cold build then warm hit without canonical/operational reconstruction',async()=>{
 const run=db.ready({invoiceChanges:{due_date:'2026-09-01',issue_date:'2026-08-01'}}),admin=databaseClient(db),p=params(db,admin)
 const cold=await server.ensureCustomerFinancialFeatures({...p,customerSourceId:'c1'})
 assert.equal(cold.rows[0].gross_overdue_base_decimal,'9000');assert.equal(cold.rows[0].oldest_overdue_days,30)
 assert.equal(p.metrics.canonicalBuildRequests,1);assert.equal(p.metrics.featuresRebuilt,1);assert.equal(p.metrics.roundTrips,6)
 const warmParams=params(db,admin),warm=await server.ensureCustomerFinancialFeatures({...warmParams,customerSourceId:'c1'})
 assert.deepEqual(warm,cold);assert.equal(warmParams.metrics.roundTrips,1);assert.equal(warmParams.metrics.canonicalBuildRequests,0);assert.equal(warmParams.metrics.operationalReadRequests,0)
 const b=readInput(run.run).bases[0].payload
 assert.deepEqual(b.invoices[0],{user_id:db.user,tenant_id:'tenant-a',source_system:'xero',source_id:'i1',customer_source_id:'c1',type:'ACCREC',status:'AUTHORISED',issue_date:'2026-08-01',due_date:'2026-09-01',fully_paid_date:null,transaction_currency_code:'GBP',organisation_base_currency_code:'GBP',xero_currency_rate:null,total_native:'10000',amount_paid_native:'1000',amount_due_native:'9000',amount_credited_native:'0',amount_due_base:'9000',currency_conversion_status:'identity',currency_conversion_failure_reason:null})
 assert.equal(run.run,db.head().generationId)
})
check('full population includes >REST-page-limit source rows and complete manifest',async()=>{
 const extras=Array.from({length:1100},(_,i)=>({source_id:`invoice-${String(i).padStart(4,'0')}`,customer_source_id:'c2'}))
 // Canonical writer max500: add rows to this disposable succeeded fixture directly.
 const run=run2();db.psql(`insert into public.canonical_invoices select (jsonb_populate_record(null::public.canonical_invoices,to_jsonb(i)||jsonb_build_object('id',gen_random_uuid(),'source_id','bulk-'||s))).* from public.canonical_invoices i cross join generate_series(1,1100) s where i.source_id='i2';`)
 const p=params(db,databaseClient(db)),result=await server.ensureCustomerFinancialFeaturesForPortfolio(p)
 assert.equal(result.sourceCounts.invoices,1102);assert.equal(result.rows.length,2);assert.equal(p.metrics.canonicalBuildRequests,1)
 assert.equal(JSON.parse(db.psql('select to_jsonb(m) from public.collection_basis_manifests m;')).invoice_count,1102)
 assert.equal(basisCount(),3);assert.equal(extras.length,1100);assert.equal(db.head().generationId,run.run)
})
check('rCustomer rebuild reuses basis, leaves unaffected customer output untouched',async()=>{
 run2();const admin=databaseClient(db);await server.ensureCustomerFinancialFeaturesForPortfolio(params(db,admin))
 const untouched=db.psql("select result::text||verified_at::text from public.collection_customer_features where customer_source_id='c2';")
 db.dispute();const p=params(db,admin),result=await server.ensureCustomerFinancialFeaturesForPortfolio(p)
 assert.equal(result.rows.find(r=>r.customer_source_id==='c1').effective_disputed_overdue_base_decimal,'2000')
 assert.equal(p.metrics.canonicalBuildRequests,0);assert.equal(p.metrics.featuresRebuilt,1);assert.equal(p.metrics.operationalReadRequests,1)
 assert.equal(db.psql("select result::text||verified_at::text from public.collection_customer_features where customer_source_id='c2';"),untouched)
})
check('UTC rollover reuses accounting history and changes ages; feature slots do not grow',async()=>{
 run2();const a=params(db,databaseClient(db)),before=await server.ensureCustomerFinancialFeaturesForPortfolio(a)
 const p=params(db,databaseClient(db),'2026-10-02T00:00:00Z'),after=await server.ensureCustomerFinancialFeaturesForPortfolio(p)
 assert.equal(after.rows[0].oldest_overdue_days,before.rows[0].oldest_overdue_days+1);assert.equal(p.metrics.canonicalBuildRequests,0)
 assert.equal(db.psql('select count(*) from public.collection_customer_features;'),String(basisCount()))
})
check('generation invalidation keeps historical basis separate and does not increment all rCustomer',async()=>{
 const first=db.ready();await server.ensureCustomerFinancialFeaturesForPortfolio(params(db,databaseClient(db)))
 const second=db.ready({invoiceChanges:{amount_due_native:'5000',amount_due_base:'5000'}})
 const p=params(db,databaseClient(db)),result=await server.ensureCustomerFinancialFeaturesForPortfolio(p)
 assert.equal(result.rows[0].gross_outstanding_base_decimal,'5000');assert.equal(p.metrics.canonicalBuildRequests,1)
 assert.equal(db.head().customerFinancialRevision,'0');assert.equal(db.psql('select count(distinct generation_id) from public.collection_customer_bases;'),'2')
 assert.notEqual(first.run,second.run)
})
check('same-G credit certificate/count identity invalidates even when F/r do not change',async()=>{
 const run=db.ready();cert(db,run.run);await server.ensureCustomerFinancialFeaturesForPortfolio(params(db,databaseClient(db)))
 const before=db.head();db.psql(`update public.xero_customer_credit_validations set resource_observations=jsonb_set(resource_observations,'{initial,creditnotes,count}','1');`)
 assert.equal(db.head().financialEpoch,before.financialEpoch)
 const p=params(db,databaseClient(db)),result=await server.ensureCustomerFinancialFeaturesForPortfolio(p)
 assert.equal(result.rows[0].customer_credit_state,'unavailable');assert.equal(result.rows[0].available_customer_credit_base_decimal,null)
 assert.equal(p.metrics.canonicalBuildRequests,0);assert.equal(p.metrics.featuresRebuilt,basisCount())
})
check('priority/actions/notes leave financial feature slots valid; money/cancel/delete invalidates',async()=>{
 db.ready({invoiceChanges:{due_date:'2026-09-01'}});const made=db.createPromise();const id=db.dispute()
 const admin=databaseClient(db);await server.ensureCustomerFinancialFeaturesForPortfolio(params(db,admin))
 db.psql(db.override()+db.action()+`update public.invoice_disputes set note='reviewed' where id='${id}';`)
 db.promiseRequest({operation:'edit',promiseId:made.promise.id,note:'reviewed'})
 let p=params(db,admin);await server.ensureCustomerFinancialFeaturesForPortfolio(p);assert.equal(p.metrics.featuresRebuilt,0)
 db.promiseRequest({operation:'cancel',promiseId:made.promise.id});p=params(db,admin);await server.ensureCustomerFinancialFeaturesForPortfolio(p);assert.equal(p.metrics.featuresRebuilt,1)
 db.psql(`delete from public.invoice_disputes where id='${id}';`);p=params(db,admin);await server.ensureCustomerFinancialFeaturesForPortfolio(p);assert.equal(p.metrics.featuresRebuilt,1)
 db.dispute();p=params(db,admin);await server.ensureCustomerFinancialFeaturesForPortfolio(p);assert.equal(p.metrics.featuresRebuilt,1)
})
check('stale financial builder and old-date builder cannot overwrite current features',async()=>{
 const run=db.ready();db.rpc(`select public.build_collection_customer_bases('${db.user}','tenant-a','${run.run}');`)
 const stale=readInput(run.run),old=featureFromInputs(stale,db);db.dispute()
 assert.equal(publish(run.run,stale.context.evidenceIdentity,old),'f');assert.equal(db.psql('select count(*) from public.collection_customer_features;'),'0')
 await server.ensureCustomerFinancialFeaturesForPortfolio(params(db,databaseClient(db),'2026-10-02T12:00:00Z'))
 const current=readInput(run.run);assert.equal(publish(run.run,current.context.evidenceIdentity,featureFromInputs(current,db)),'f')
})
check('concurrent identical builders are safe; generation promotion rejects held old-G publication',async()=>{
 const run=db.ready();db.rpc(`select public.build_collection_customer_bases('${db.user}','tenant-a','${run.run}');`)
 const i=readInput(run.run),r=featureFromInputs(i,db)
 const sql=`set role service_role;select public.publish_collection_customer_features('${db.user}','tenant-a','${run.run}','2026-10-01',${db.quote(i.context.evidenceIdentity)},${db.json(r)});`
 assert.deepEqual(await Promise.all([db.psqlAsync(sql),db.psqlAsync(sql)]),['t','t'])
 db.ready();assert.equal(publish(run.run,i.context.evidenceIdentity,r),'f')
})
check('in-flight mutation after input read causes rejection/retry, never stale success',async()=>{
 db.ready();let changed=false
 const admin=databaseClient(db,async name=>{if(name==='publish_collection_customer_features'&&!changed){changed=true;db.dispute()}})
 const p=params(db,admin),result=await server.ensureCustomerFinancialFeatures({...p,customerSourceId:'c1'})
 assert.equal(result.rows[0].effective_disputed_outstanding_base_decimal,'2000');assert.equal(p.metrics.featuresRebuilt,2)
})
check('scope spoofing, unsupported G, partial result and missing customer cannot publish',async()=>{
 const run=db.ready();db.rpc(`select public.build_collection_customer_bases('${db.user}','tenant-a','${run.run}');`)
 assert.throws(()=>db.rpc(`select public.build_collection_customer_bases('${db.other}','tenant-a','${run.run}');`),/generation_unavailable/)
 assert.throws(()=>db.rpc(`select public.build_collection_customer_bases('${db.user}','tenant-b','${run.run}');`),/generation_unavailable/)
 assert.equal(db.rpc(`select public.publish_collection_customer_features('${db.user}','tenant-b','${run.run}','2026-10-01','foreign',${db.json([{customerId:'c1',revision:'0',result:{}}])});`),'f')
 const i=readInput(run.run);assert.equal(publish(run.run,i.context.evidenceIdentity,[{customerId:'c1',revision:'0',result:{result:{rows:[]}}}]),'f')
 const p=params(db,databaseClient(db));await assert.rejects(()=>server.ensureCustomerFinancialFeatures({...p,customerSourceId:'absent'}),/customer_missing/)
 const cross={...params(db,databaseClient(db)),userId:db.other};await assert.rejects(()=>server.ensureCustomerFinancialFeaturesForPortfolio(cross),/legacy/)
})
check('RLS/grants forbid browser functions and direct mutation; owner erasure cascades',async()=>{
 const run=db.ready();await server.ensureCustomerFinancialFeaturesForPortfolio(params(db,databaseClient(db)))
 for(const role of ['anon','authenticated']){
  assert.throws(()=>db.psql(`set role ${role};select public.build_collection_customer_bases('${db.user}','tenant-a','${run.run}');`),/permission denied/)
  assert.throws(()=>db.psql(`set role ${role};select * from public.collection_customer_features;`),/permission denied/)
 }
 assert.throws(()=>db.rpc('delete from public.collection_customer_bases;'),/permission denied/)
 assert.equal(db.psql("select count(*) from pg_class where relname in('collection_customer_bases','collection_customer_features','collection_basis_manifests') and relrowsecurity;"),'3')
 db.psql(`delete from auth.users where id='${db.user}';`);assert.equal(basisCount(),0);assert.equal(db.psql('select count(*) from public.collection_customer_features;'),'0')
 assert.equal(db.psql('select count(*) from public.collection_basis_manifests;'),'0')
})
check('bounded retention removes only derivatives older than current/previous G',async()=>{
 const generations=[];for(let n=0;n<3;n++){generations.push(db.ready().run);await server.ensureCustomerFinancialFeaturesForPortfolio(params(db,databaseClient(db)))}
 assert.equal(db.rpc(`select public.prune_collection_customer_materialization('${db.user}','tenant-a',1);`),'1')
 assert.equal(db.psql(`select count(*) from public.collection_basis_manifests where generation_id='${generations[0]}';`),'0')
 db.rpc(`select public.prune_collection_customer_materialization('${db.user}','tenant-a',500);`)
 assert.equal(db.psql('select count(distinct generation_id) from public.collection_customer_bases;'),'2')
 assert.equal(db.psql('select count(*) from public.xero_sync_runs;'),'3')
})

check('publication waits behind an uncommitted financial mutation, then rejects its old revision',async()=>{
 const run=db.ready(),id=db.dispute();db.rpc(`select public.build_collection_customer_bases('${db.user}','tenant-a','${run.run}');`)
 const held=readInput(run.run),results=featureFromInputs(held,db),barrier=await db.holdBarrier()
 let released=false;const mutation=db.psqlAsync(`set application_name='materialization-mutation';begin;update public.invoice_disputes set recorded_disputed_amount_native=3000 where id='${id}';select pg_advisory_lock(${barrier.key});commit;`)
 try {
  await db.waitForLock('materialization-mutation')
  const publication=db.psqlAsync(`set application_name='materialization-publication';set role service_role;select public.publish_collection_customer_features('${db.user}','tenant-a','${run.run}','2026-10-01',${db.quote(held.context.evidenceIdentity)},${db.json(results)});`)
  await db.waitForLock('materialization-publication');await barrier.release();released=true;await mutation;assert.equal(await publication,'f')
 }finally{if(!released)await barrier.release();await mutation}
 assert.equal(db.psql('select count(*) from public.collection_customer_features;'),'0')
})
check('normalized source aliases cannot bypass customer financial invalidation',async()=>{
 const run=db.ready();db.psql(`update public.canonical_customers set source_id=E' c1\t' where source_id='c1';update public.canonical_invoices set customer_source_id=E' c1\t' where source_id='i1';`)
 const admin=databaseClient(db);await server.ensureCustomerFinancialFeatures({...params(db,admin),customerSourceId:'c1'})
 db.dispute();const p=params(db,admin),result=await server.ensureCustomerFinancialFeatures({...p,customerSourceId:'c1'})
 assert.equal(p.metrics.featuresRebuilt,1);assert.equal(result.rows[0].effective_disputed_outstanding_base_decimal,'2000');assert.equal(db.head().generationId,run.run)
})
check('partial derivative inventory cannot pass as a complete population; rebuild recovers',async()=>{
 const run=run2(),admin=databaseClient(db);await server.ensureCustomerFinancialFeaturesForPortfolio(params(db,admin))
 db.psql("delete from public.collection_customer_bases where customer_source_id='c2';")
 await assert.rejects(()=>server.ensureCustomerFinancialFeaturesForPortfolio(params(db,admin)),/incomplete/)
 db.rpc(`select public.build_collection_customer_bases('${db.user}','tenant-a','${run.run}');`)
 assert.equal((await server.ensureCustomerFinancialFeaturesForPortfolio(params(db,admin))).rows.length,2)
})
check('certified credit remains customer-level and does not alter invoice ageing',async()=>{
 const run=db.ready({cashRows:[db.cash()],invoiceChanges:{due_date:'2026-09-01'}})
 cert(db,run.run,`update public.xero_customer_credit_validations set resource_observations=jsonb_set(resource_observations,'{initial,overpayments,count}','1');`)
 const result=await server.ensureCustomerFinancialFeaturesForPortfolio(params(db,databaseClient(db))),r=result.rows[0]
 assert.equal(r.customer_credit_state,'ready');assert.equal(r.available_customer_credit_base_decimal,'3500')
 assert.equal(r.customer_to_chase_overdue_base_decimal,'5500');assert.equal(r.invoice_to_chase_overdue_base_decimal,'9000');assert.equal(r.weighted_avg_overdue_days,30)
})
check('current authoritative Promise state is read per customer, including multiple invoices',async()=>{
 db.ready({extraInvoices:[{source_id:'i2',customer_source_id:'c1',due_date:'2026-09-01'}],invoiceChanges:{due_date:'2026-09-01'}})
 db.createPromise({amount:'1000'});db.createPromise({invoiceSourceId:'i2',amount:'2000'});db.dispute('i1',500)
 const result=await server.ensureCustomerFinancialFeaturesForPortfolio(params(db,databaseClient(db))),r=result.rows[0]
 assert.equal(r.active_promised_overdue_base_decimal,'3000');assert.equal(r.effective_disputed_overdue_base_decimal,'500');assert.equal(r.customer_to_chase_overdue_base_decimal,'14500')
})
check('payment fallback/direct association and unassigned source counts match live inputs',async()=>{
 const run=run2();db.psql(`insert into public.canonical_payments(user_id,tenant_id,source_system,sync_run_id,source_id,invoice_source_id,customer_source_id,payment_date) values
  ('${db.user}','tenant-a','xero','${run.run}','fallback','i1',null,'2026-09-29'),
  ('${db.user}','tenant-a','xero','${run.run}','direct','i1','c2','2026-09-30'),
  ('${db.user}','tenant-a','xero','${run.run}','unassigned',null,null,'2026-09-28');`)
 const result=await server.ensureCustomerFinancialFeaturesForPortfolio(params(db,databaseClient(db)))
 assert.equal(result.sourceCounts.payments,3);assert.equal(result.rows.find(r=>r.customer_source_id==='c1').last_payment_date,'2026-09-29')
 assert.equal(result.rows.find(r=>r.customer_source_id==='c2').last_payment_date,'2026-09-30')
 assert.equal(result.rows.find(r=>r.customer_source_id==='c2').has_recent_partial_payment,false)
})
check('calculation version mismatch fails closed; no legacy source reconstruction',async()=>{
 db.ready();const real=databaseClient(db),admin={async rpc(name,args){const result=await real.rpc(name,args);if(result.data?.context)result.data.context.featureVersion='future';return result}}
 await assert.rejects(()=>server.ensureCustomerFinancialFeaturesForPortfolio(params(db,admin)),/scope/)
 assert.equal(real.calls.length,1);assert.equal(basisCount(),0)
})
check('explicit single/bounded/full basis builder validates scope and preserves immutable slots',async()=>{
 const run=run2(),admin=databaseClient(db),scope={admin,userId:db.user,tenantId:'tenant-a',sourceSystem:'xero',generationId:run.run}
 assert.equal((await server.buildCustomerAccountingBases({...scope,customerSourceIds:['c1']})).inserted,1)
 assert.equal((await server.buildCustomerAccountingBases({...scope,customerSourceIds:['c1','c2']})).inserted,1)
 const timestamp=db.psql("select built_at from public.collection_customer_bases where customer_source_id='c1';")
 assert.equal((await server.buildCustomerAccountingBases(scope)).inserted,1)
 assert.equal(db.psql("select built_at from public.collection_customer_bases where customer_source_id='c1';"),timestamp)
 await assert.rejects(()=>server.buildCustomerAccountingBases({...scope,customerSourceIds:Array.from({length:101},(_,i)=>String(i))}),/scope/)
})
check('P-only concurrency does not reject or rebuild authoritative financial features',async()=>{
 db.ready();let changed=false
 const admin=databaseClient(db,async name=>{if(name==='publish_collection_customer_features'&&!changed){changed=true;db.psql(db.override()+db.action())}})
 const p=params(db,admin);await server.ensureCustomerFinancialFeatures({...p,customerSourceId:'c1'});assert.equal(p.metrics.featuresRebuilt,1)
})
check('count-only evidence change rejects stale publication even with unchanged F/r',()=>{
 const run=db.ready();cert(db,run.run);db.rpc(`select public.build_collection_customer_bases('${db.user}','tenant-a','${run.run}');`)
 const held=readInput(run.run),results=featureFromInputs(held,db),before=db.head()
 db.psql(`update public.xero_customer_credit_validations set resource_observations=jsonb_set(resource_observations,'{initial,creditnotes,count}','1');`)
 assert.equal(db.head().financialEpoch,before.financialEpoch);assert.equal(publish(run.run,held.context.evidenceIdentity,results),'f')
})
check('publication waits for accounting promotion and cannot publish old-G financial state',async()=>{
 const run=db.ready();db.rpc(`select public.build_collection_customer_bases('${db.user}','tenant-a','${run.run}');`)
 const held=readInput(run.run),results=featureFromInputs(held,db),next=db.candidate(),barrier=await db.holdBarrier()
 let released=false
 const promotion=db.psqlAsync(`set application_name='materialization-promotion';begin;select public.promote_xero_sync_run_with_promises('${next.run}','${db.owner}',${next.fence},null,null);select pg_advisory_lock(${barrier.key});commit;`)
 try{
  await db.waitForLock('materialization-promotion')
  const publication=db.psqlAsync(`set application_name='materialization-old-generation';set role service_role;select public.publish_collection_customer_features('${db.user}','tenant-a','${run.run}','2026-10-01',${db.quote(held.context.evidenceIdentity)},${db.json(results)});`)
  await db.waitForLock('materialization-old-generation');await barrier.release();released=true;await promotion;assert.equal(await publication,'f')
 }finally{if(!released)await barrier.release();await promotion}
 assert.equal(db.head().generationId,next.run);assert.equal(db.psql('select count(*) from public.collection_customer_features;'),'0')
})
check('missing last-successful authority marker fails closed without canonical reconstruction',async()=>{
 db.ready();assert.throws(()=>db.psql(`update public.xero_sync_tenant_state set last_successful_sync_at=null where user_id='${db.user}' and tenant_id='tenant-a';`),/success_pointer_check/)
 const real=databaseClient(db),admin={async rpc(name,args){const result=await real.rpc(name,args);if(result.data?.context)result.data.context.generationReady=false;return result}}
 await assert.rejects(()=>server.ensureCustomerFinancialFeaturesForPortfolio(params(db,admin)),/transition/);assert.equal(real.calls.length,1)
})
check('certified result returns its captured G/F/date/model/evidence identity, not a later head',async()=>{
 const run=run2(),admin=databaseClient(db),p=params(db,admin)
 const certified=await server.ensureCustomerFinancialFeaturesForPortfolioWithIdentity(p)
 assert.equal(certified.identity.generationId,run.run);assert.equal(certified.identity.financialEpoch,db.head().financialEpoch)
 assert.equal(certified.identity.evaluationDate,'2026-10-01');assert.equal(certified.identity.basisVersion,'customer_basis_v1')
 assert.equal(certified.identity.featureVersion,'customer_features_v1');assert.match(certified.identity.evidenceIdentity,/^[a-f0-9]{64}$/)
 assert.deepEqual(certified.result,await server.ensureCustomerFinancialFeaturesForPortfolio(params(db,admin)))
 const single=await server.ensureCustomerFinancialFeaturesWithIdentity({...params(db,admin),customerSourceId:'c1'})
 assert.deepEqual(single.identity.customerRevisions,[{sourceId:'c1',financialRevision:'0'}])
 const held=certified.identity.financialEpoch;db.dispute();assert.notEqual(db.head().financialEpoch,held)
 assert.equal(certified.identity.financialEpoch,held,'never relabel already-calculated inputs with a new epoch')
})
check('orphan active Promise outside the accounting population fails closed even on a warm portfolio',async()=>{
 const run=db.ready(),id=db.historicalPromise(run);await server.ensureCustomerFinancialFeaturesForPortfolio(params(db,databaseClient(db)))
 // Deliberate invalid authoritative fixture, isolated local DB only. Ordinary
 // commands never reassign these identities; validate the live-path safety guard.
 db.psql(`alter table public.invoice_promises disable trigger user;update public.invoice_promises set invoice_source_id='missing',customer_source_id='orphan' where id='${id}';alter table public.invoice_promises enable trigger user;`)
 await assert.rejects(()=>server.ensureCustomerFinancialFeaturesForPortfolio(params(db,databaseClient(db))),/operational_context/)
})
check('targeted Promise reads include invoice associations so mismatched customer identity is not omitted',async()=>{
 const run=run2(),id=db.historicalPromise(run)
 db.psql(`alter table public.invoice_promises disable trigger user;update public.invoice_promises set customer_source_id='c2' where id='${id}';alter table public.invoice_promises enable trigger user;`)
 await assert.rejects(()=>server.ensureCustomerFinancialFeatures({...params(db,databaseClient(db)),customerSourceId:'c1'}))
 assert.equal(db.psql('select count(*) from public.collection_customer_features;'),'0')
})
check('fresh unanalysed generic probe uses bounded complete-key feature lookups',async()=>{
 const run=db.ready()
 // Prevent statistics arriving midway through this specific regression fixture.
 db.psql(`alter table public.collection_customer_bases set(autovacuum_enabled=false);alter table public.collection_customer_features set(autovacuum_enabled=false);
 insert into public.canonical_customers select (jsonb_populate_record(null::public.canonical_customers,to_jsonb(c)||jsonb_build_object('id',gen_random_uuid(),'source_id','generic-'||s,'is_customer',true))).* from public.canonical_customers c cross join generate_series(1,600) s where c.source_id='c1';`)
 await server.ensureCustomerFinancialFeaturesForPortfolio(params(db,databaseClient(db)))
 const body=db.psql("select prosrc from pg_proc where oid='public.read_collection_customer_materialization(uuid,text,date,text[],text,integer)'::regprocedure;")
 const args=['p_user_id','p_tenant_id','p_evaluation_date','p_customer_ids','p_after','p_limit']
 let query=body;for(const [i,arg]of args.entries())query=query.replaceAll(new RegExp(`\\b${arg}\\b`,'g'),`$${i+1}`)
 const explain=JSON.parse(db.psql(`set plan_cache_mode=force_generic_plan;prepare probe(uuid,text,date,text[],text,integer) as ${query};
   explain(analyze,buffers,format json)execute probe('${db.user}','tenant-a','2026-10-01',null,null,500);`))[0]
 const scans=[];function visit(plan){if(plan['Relation Name']==='collection_customer_features')scans.push(plan);for(const child of plan.Plans??[])visit(child)}visit(explain.Plan)
 assert.ok(scans.length);for(const scan of scans){assert.ok(scan['Actual Loops']<=500);assert.ok(scan['Actual Rows']<=1);assert.match(scan['Index Cond'],/customer_source_id/)}
 assert.equal(db.head().generationId,run.run)
})
