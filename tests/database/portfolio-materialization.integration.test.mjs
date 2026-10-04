import assert from 'node:assert/strict'
import test,{before,after,beforeEach} from 'node:test'
import * as db from './test-helpers/dependency-database-fixture.mjs'
import {cert,server as featureServer,params as featureParams} from './test-helpers/materialization-client.mjs'
import {client,parameters,portfolio,calculation} from './test-helpers/portfolio-client.mjs'
const enabled=process.env.RUN_SUPABASE_INTEGRATION==='1',check=(n,f)=>test(n,{skip:!enabled},f)
before(()=>{if(enabled)db.setup()});after(()=>{if(enabled)db.cleanup()});beforeEach(()=>{if(enabled)db.reset()})
const ready=()=>{const run=db.ready({extraInvoices:[{source_id:'i2',customer_source_id:'c2',amount_due_native:'500',amount_due_base:'500'}],invoiceChanges:{due_date:'2026-09-01'}});cert(db,run.run);return run}
const ensure=admin=>portfolio.ensurePortfolioBaseCalculation(parameters(db,admin))
const read=(admin,extra={})=>portfolio.readPortfolioBaseCalculation({...parameters(db,admin),...extra})
const held=async(admin)=>{const f=await featureServer.ensureCustomerFinancialFeaturesForPortfolioWithIdentity(featureParams(db,admin));return {identity:{...f.identity,scoringScope:'collections',overdueOnly:true,scoringModelVersion:calculation.COLLECTION_SCORING_MODEL_VERSION,calculationVersion:calculation.PORTFOLIO_CALCULATION_VERSION},calculation:calculation.calculateReusablePortfolio(f.result,true)}}
const publish=b=>db.rpc(`select public.publish_collection_portfolio_calculation('${db.user}','tenant-a',${db.json(b.identity)},${db.json(b.calculation)});`)
check('payload checksums preserve pgcrypto parity with hosted extension placement',()=>{
 assert.equal(db.psql("select to_regprocedure('public.digest(text,text)') is null;"),'t')
 for(const payload of [{}, {amount:'123.4500',missing:null}, {text:'£ é 日本語 \\ newline\n',rows:[1,true,null]}]) {
  assert.equal(db.psql(`select collection_portfolio_private.payload_hash(${db.json(payload)}) = extensions.digest((${db.json(payload)})::text,'sha256');`),'t')
 }
 assert.equal(db.psql("select has_function_privilege('anon','collection_portfolio_private.payload_hash(jsonb)','execute') or has_function_privilege('authenticated','collection_portfolio_private.payload_hash(jsonb)','execute') or has_function_privilege('service_role','collection_portfolio_private.payload_hash(jsonb)','execute');"),'f')
})
check('replay; cold financial calculation and warm manifest/target/population reads are exact',async()=>{
 ready();const admin=client(db),p=parameters(db,admin),h=await portfolio.ensurePortfolioBaseCalculation(p)
 assert.equal(h.customerCount,2);assert.equal(p.metrics.scoresRecalculated,2)
 const warm=parameters(db,admin);assert.deepEqual(await portfolio.ensurePortfolioBaseCalculation(warm),h)
 assert.equal(warm.metrics.roundTrips,1);assert.equal(warm.metrics.features.roundTrips,0);assert.equal(warm.metrics.benchmarkMs,0);assert.equal(warm.metrics.baseScoreMs,0)
 const population=await read(admin,{completePopulation:true}),target=await read(admin,{customerSourceIds:['c1']})
 assert.equal(population.rows.length,2);assert.deepEqual(target.rows,[population.rows.find(r=>r.customerId==='c1')])
 assert.equal(target.head.calculationId,h.calculationId);assert.ok(!JSON.stringify(target).includes('override_level'))
})
check('priority/Normal/action create-delete and note-only changes reuse identical calculation',async()=>{
 ready();const made=db.createPromise({amount:'100'}),dispute=db.dispute('i1',20),admin=client(db),initial=await ensure(admin)
 for(const sql of [db.override(),db.override('normal'),"delete from public.customer_overrides;",db.action(),"delete from public.collection_actions;",`update public.invoice_disputes set note='changed' where id='${dispute}';`]){
  db.psql(sql);const p=parameters(db,admin),h=await portfolio.ensurePortfolioBaseCalculation(p);assert.equal(h.calculationId,initial.calculationId);assert.equal(p.metrics.features.roundTrips,0)
 }
 db.promiseRequest({operation:'edit',promiseId:made.promise.id,note:'changed'});db.promiseRequest({operation:'edit',promiseId:made.promise.id,promisedDate:'2099-12-30'});assert.equal((await ensure(admin)).calculationId,initial.calculationId)
})
check('one financial change rebuilds only affected feature; all compact scores stay exact',async()=>{
 ready();const admin=client(db),initial=await ensure(admin)
 const untouched=db.psql("select result::text||verified_at::text from public.collection_customer_features where customer_source_id='c2';")
 db.dispute('i1',2000);const p=parameters(db,admin),after=await portfolio.ensurePortfolioBaseCalculation(p)
 assert.notEqual(after.calculationId,initial.calculationId);assert.equal(p.metrics.features.featuresRebuilt,1);assert.equal(p.metrics.features.canonicalBuildRequests,0)
 assert.equal(db.psql("select result::text||verified_at::text from public.collection_customer_features where customer_source_id='c2';"),untouched)
 const expected=await held(admin),actual=await read(admin,{completePopulation:true})
 assert.deepEqual(actual.head.benchmarks,expected.calculation.benchmarks);assert.deepEqual(actual.rows.sort((a,b)=>a.order-b.order),expected.calculation.rows)
})
check('same-G certification changes invalidate even without F advancement',async()=>{
 const run=ready(),admin=client(db),initial=await ensure(admin),f=db.head().financialEpoch
 db.psql(`update public.xero_customer_credit_validations set resource_observations=jsonb_set(resource_observations,'{initial,creditnotes,count}','1');`)
 assert.equal(db.head().financialEpoch,f);assert.equal(await read(admin),null)
 const after=await ensure(admin);assert.notEqual(after.calculationId,initial.calculationId);assert.notEqual(after.identity.evidenceIdentity,initial.identity.evidenceIdentity);assert.equal(after.scoredCustomerCount,(await held(admin)).calculation.population.scoring);assert.equal(db.psql("select result#>>'{result,rows,0,available_customer_credit_base_decimal}' from public.collection_customer_features where customer_source_id='c1';"),'')
 assert.equal(run.run,after.identity.generationId)
})
check('UTC rollover reuses bases; scopes/modes are distinct financial identities',async()=>{
 ready();const admin=client(db),first=await ensure(admin),p=parameters(db,admin,'2026-10-02T00:00:00Z'),next=await portfolio.ensurePortfolioBaseCalculation(p)
 assert.notEqual(first.calculationId,next.calculationId);assert.equal(first.identity.financialEpoch,next.identity.financialEpoch);assert.equal(p.metrics.features.canonicalBuildRequests,0)
 const all=await portfolio.ensurePortfolioBaseCalculation(parameters(db,admin,'2026-10-02T00:00:00Z',false));assert.notEqual(all.calculationId,next.calculationId)
 await assert.rejects(()=>portfolio.ensurePortfolioBaseCalculation({...p,scoringScope:'display-limit-1'}),/scope/)
})
check('new generation cannot reuse/relabel old scores; stale G publication rejected',async()=>{
 ready();const admin=client(db),before=await ensure(admin),old=await held(admin);ready()
 assert.equal(publish(old),'');assert.equal(await read(admin),null)
 const next=await ensure(admin);assert.notEqual(before.identity.generationId,next.identity.generationId)
})
check('stale F and two financial mutations cannot publish under later authority',async()=>{
 ready();const admin=client(db),old=await held(admin);db.dispute('i1',100);db.dispute('i2',100)
 assert.equal(publish(old),'');assert.equal(db.psql('select count(*) from public.collection_portfolio_calculations;'),'0')
 const p=parameters(db,admin),next=await portfolio.ensurePortfolioBaseCalculation(p);assert.equal(next.identity.financialEpoch,db.head().financialEpoch);assert.equal(p.metrics.features.featuresRebuilt,2)
})
check('priority and Action History during build do not block financial publication',async()=>{
 ready();const old=await held(client(db));db.psql(db.override()+db.action());assert.ok(publish(old))
 assert.equal((await read(client(db))).head.identity.financialEpoch,old.identity.financialEpoch)
})
check('mutating during ensure retries using newly captured feature identity',async()=>{
 ready();let changed=false;const admin=client(db,name=>{if(name==='publish_collection_portfolio_calculation'&&!changed){changed=true;db.dispute('i1',100)}})
 const p=parameters(db,admin),h=await portfolio.ensurePortfolioBaseCalculation(p);assert.equal(h.identity.financialEpoch,db.head().financialEpoch)
 assert.equal(p.metrics.misses,2);assert.equal(p.metrics.features.canonicalBuildRequests,1)
})
check('incomplete population is rejected; failed insertion rolls back manifest and rows',async()=>{
 ready();const old=await held(client(db)),partial=structuredClone(old);partial.calculation.rows.pop();assert.equal(publish(partial),'')
 const missingComponent=structuredClone(old);delete missingComponent.calculation.rows[0].score.components.exposureScore;assert.equal(publish(missingComponent),'')
 const badCurrency=structuredClone(old);badCurrency.calculation.metadata.organisationBaseCurrency=null;badCurrency.calculation.metadata.currencyHealth.status='unavailable';badCurrency.calculation.rows=[];assert.equal(publish(badCurrency),'')
 const invalid=structuredClone(old);invalid.calculation.rows[1].order=invalid.calculation.rows[0].order
 assert.throws(()=>publish(invalid),/unique constraint/);assert.equal(db.psql('select count(*) from public.collection_portfolio_calculations;'),'0')
 assert.equal(db.psql('select count(*) from public.collection_portfolio_base_scores;'),'0')
 assert.ok(publish(old))
})
check('missing/corrupt disposable row or manifest produces miss and automatic rebuild',async()=>{
 ready();const admin=client(db),first=await ensure(admin)
 db.psql("delete from public.collection_portfolio_base_scores where customer_source_id='c2';");assert.equal(await read(admin),null)
 const second=await ensure(admin);assert.notEqual(second.calculationId,first.calculationId)
 db.psql("update public.collection_portfolio_base_scores set payload=jsonb_set(payload,'{score,weighted}','99') where customer_source_id='c2';")
 assert.equal(await read(admin),null);await ensure(admin)
 db.psql("update public.collection_portfolio_calculations set payload=jsonb_set(payload,'{benchmarks,totalOverdueOutstandingBase}','42');")
 assert.equal(await read(admin),null);await ensure(admin)
})
check('feature population missing/stale prevents publication and no partial ready state appears',async()=>{
 ready();const old=await held(client(db));db.psql("delete from public.collection_customer_features where customer_source_id='c2';")
 assert.equal(publish(old),'');const p=parameters(db,client(db));await portfolio.ensurePortfolioBaseCalculation(p);assert.equal(p.metrics.features.featuresRebuilt,1)
})
check('duplicate builders return one atomic ready identity; older dates cannot displace newer',async()=>{
 ready();const old=await held(client(db)),[one,two]=await Promise.all([db.psqlAsync(`set role service_role;select public.publish_collection_portfolio_calculation('${db.user}','tenant-a',${db.json(old.identity)},${db.json(old.calculation)});`),db.psqlAsync(`set role service_role;select public.publish_collection_portfolio_calculation('${db.user}','tenant-a',${db.json(old.identity)},${db.json(old.calculation)});`)])
 assert.equal(one,two);assert.equal(db.psql('select count(*) from public.collection_portfolio_calculations;'),'1')
 await portfolio.ensurePortfolioBaseCalculation(parameters(db,client(db),'2026-10-02T00:00:00Z'));assert.equal(publish(old),'')
})
check('cross-owner/tenant isolation, model validation, service-only security and erasure',async()=>{
 ready();const admin=client(db),h=await ensure(admin),old=await held(admin)
 assert.equal(await portfolio.readPortfolioBaseCalculation({...parameters(db,admin),tenantId:'tenant-b'}).catch(e=>e.reason),'legacy')
 const badModel=structuredClone(old);badModel.identity.scoringModelVersion='retired-model';assert.throws(()=>publish(badModel),/invalid_publication/)
 assert.equal(db.psql("select count(*) from pg_proc where proname in('read_collection_portfolio_calculation','publish_collection_portfolio_calculation','prune_collection_portfolio_calculations') and prosecdef and pg_get_userbyid(proowner)='postgres' and proconfig @> array['search_path=pg_catalog'];"),'3')
 old.identity.userId=db.other;assert.throws(()=>publish(old),/invalid_publication/)
 for(const role of ['anon','authenticated']){
  assert.throws(()=>db.psql(`set role ${role};select * from public.collection_portfolio_base_scores;`),/permission denied/)
  assert.throws(()=>db.psql(`set role ${role};select public.read_collection_portfolio_calculation('${db.user}','tenant-a','2026-10-01',true);`),/permission denied/)
 }
 assert.throws(()=>db.rpc('delete from public.collection_portfolio_calculations;'),/permission denied/)
 assert.equal(db.psql("select count(*) from pg_class where relname in('collection_portfolio_calculations','collection_portfolio_base_scores') and relrowsecurity;"),'2')
 db.psql(`delete from auth.users where id='${db.user}';`);assert.equal(db.psql('select count(*) from public.collection_portfolio_base_scores;'),'0');assert.equal(db.psql('select count(*) from public.collection_portfolio_calculations;'),'0')
 assert.ok(h.calculationId)
})
check('bounded pruning retains recent/current calculations without deleting features/accounting',async()=>{
 ready();const admin=client(db);for(let i=0;i<4;i++){if(i)db.dispute('i1',100*i);await ensure(admin);if(i<3)db.psql('delete from public.invoice_disputes;')}
 const h=await ensure(admin),bases=db.psql('select count(*) from public.collection_customer_bases;')
 db.rpc(`select public.prune_collection_portfolio_calculations('${db.user}','tenant-a');`)
 assert.ok(Number(db.psql('select count(*) from public.collection_portfolio_calculations;'))<=2);assert.equal((await ensure(admin)).calculationId,h.calculationId)
 assert.equal(db.psql('select count(*) from public.collection_customer_bases;'),bases)
})
check('publication waits for concurrent financial transaction and rejects stale F',async()=>{
 ready();const d=db.dispute(),old=await held(client(db)),barrier=await db.holdBarrier();let released=false
 const mutation=db.psqlAsync(`set application_name='portfolio-financial';begin;update public.invoice_disputes set recorded_disputed_amount_native=3000 where id='${d}';select pg_advisory_lock(${barrier.key});commit;`)
 try{await db.waitForLock('portfolio-financial');const publication=db.psqlAsync(`set application_name='portfolio-publisher';set role service_role;select public.publish_collection_portfolio_calculation('${db.user}','tenant-a',${db.json(old.identity)},${db.json(old.calculation)});`)
 await db.waitForLock('portfolio-publisher');await barrier.release();released=true;await mutation;assert.equal(await publication,'')}
 finally{if(!released)await barrier.release();await mutation}
})

check('unavailable organisation currency remains explicit; no fabricated score population',async()=>{
 ready();db.psql('delete from public.canonical_organisations;');const admin=client(db),h=await ensure(admin)
 assert.equal(h.benchmarks,null);assert.equal(h.metadata.currencyHealth.status,'unavailable');assert.equal(h.scoredCustomerCount,0)
 assert.deepEqual((await read(admin,{completePopulation:true})).rows,[])
})
check('feature ensure failure leaves no staged manifest and subsequent ensure recovers',async()=>{
 ready();const admin=client(db,name=>{if(name==='build_collection_customer_bases')throw new Error('synthetic source failure')})
 await assert.rejects(()=>ensure(admin),/synthetic source failure/);assert.equal(db.psql('select count(*) from public.collection_portfolio_calculations;'),'0')
 assert.ok((await ensure(client(db))).calculationId)
})

check('new epoch with unchanged feature output preserves numerical results and rebuilds no features',async()=>{
 ready();const admin=client(db),before=await ensure(admin),oldRows=(await read(admin,{completePopulation:true})).rows
 // Conservative invalidation exercise in this disposable DB; no source mutation.
 db.psql(`select collection_dependency_private.advance_financial('${db.user}','tenant-a','xero');`)
 const p=parameters(db,admin),after=await portfolio.ensurePortfolioBaseCalculation(p)
 assert.notEqual(after.calculationId,before.calculationId);assert.equal(p.metrics.features.featuresRebuilt,0)
 assert.deepEqual(after.benchmarks,before.benchmarks);assert.deepEqual((await read(admin,{completePopulation:true})).rows,oldRows)
 assert.deepEqual(after.provenance.benchmarkDependencies,{exposure:false,exposureShares:false,urgency:false,deterioration:false})
})
