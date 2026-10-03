// Opt-in disposable-local benchmark; no provider or hosted activity.
import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import * as db from './test-helpers/dependency-database-fixture.mjs'
import {server as features,params as featureParams,cert} from './test-helpers/materialization-client.mjs'
import {client,parameters,portfolio} from './test-helpers/portfolio-client.mjs'
if(process.env.RUN_SUPABASE_INTEGRATION!=='1')throw Error('Disposable local opt-in required')
const results=[]
try{db.setup();for(const n of [100,1000,10000]){
  db.reset();const run=db.ready()
  // Synthetic authoritative fixture only; no provider activity or hosted writes.
  db.psql(`insert into public.canonical_customers select (jsonb_populate_record(null::public.canonical_customers,to_jsonb(c)||jsonb_build_object('id',gen_random_uuid(),'source_id','customer-'||lpad(s::text,5,'0'),'is_customer',true))).* from public.canonical_customers c cross join generate_series(1,${n}) s where c.source_id='c1';
    insert into public.canonical_invoices select (jsonb_populate_record(null::public.canonical_invoices,to_jsonb(i)||jsonb_build_object('id',gen_random_uuid(),'source_id','invoice-'||lpad(s::text,5,'0')||'-'||j,'customer_source_id','customer-'||lpad(s::text,5,'0'),
      'status',case when j>2 then 'PAID' else 'AUTHORISED' end,'issue_date','2026-07-01','due_date','2026-09-01','fully_paid_date',case when j>2 then '2026-09-10' else null end,
      'total_native','100','amount_paid_native',case when j>2 then '100' else '10' end,'amount_due_native',case when j>2 then '0' else '90' end,'amount_due_base',case when j>2 then '0' else '90' end))).*
      from public.canonical_invoices i cross join generate_series(1,${n}) s cross join generate_series(1,5) j where i.source_id='i1';
    insert into public.canonical_payments(user_id,tenant_id,source_system,sync_run_id,source_id,customer_source_id,invoice_source_id,payment_date)
      select '${db.user}','tenant-a','xero','${run.run}','payment-'||s,'customer-'||lpad(s::text,5,'0'),'invoice-'||lpad(s::text,5,'0')||'-1','2026-09-20' from generate_series(1,${n}) s;
    delete from public.canonical_invoices where source_id='i1';delete from public.canonical_customers where source_id='c1';`)
  cert(db,run.run)

 const admin=client(db),start=admin.calls.length,prep=featureParams(db,admin)
 await features.ensureCustomerFinancialFeaturesForPortfolio(prep)
 const prepared={metrics:prep.metrics,databaseExecutionMs:admin.calls.slice(start).reduce((s,c)=>s+c.databaseMs,0),payloadBytes:admin.calls.slice(start).reduce((s,c)=>s+c.bytes,0)}
 async function measure(name,{date,read,completePopulation,customerSourceIds}={}){
  const p=parameters(db,admin,date),offset=admin.calls.length
  const value=read?await portfolio.readPortfolioBaseCalculation({...p,completePopulation,customerSourceIds}):await portfolio.ensurePortfolioBaseCalculation(p)
  const calls=admin.calls.slice(offset)
  return {name,metrics:p.metrics,rpcCount:calls.length,databaseExecutionMs:calls.reduce((s,c)=>s+c.databaseMs,0),
   publicationDatabaseMs:calls.filter(c=>c.name==='publish_collection_portfolio_calculation').reduce((s,c)=>s+c.databaseMs,0),
   featureDatabaseMs:calls.filter(c=>!c.name.includes('portfolio')).reduce((s,c)=>s+c.databaseMs,0),
   payloadBytes:calls.reduce((s,c)=>s+c.bytes,0),value}
 }
 const cold=await measure('cold-calculation'),warm=await measure('warm-hit')
 assert.equal(cold.value.calculationId,warm.value.calculationId);assert.equal(warm.metrics.features.roundTrips,0);assert.equal(warm.metrics.scoresRecalculated,0)
 const complete=await measure('compact-population',{read:true,completePopulation:true}),target=await measure('target',{read:true,customerSourceIds:['customer-00001']})
 assert.equal(complete.value.rows.length,n);assert.equal(target.value.rows.length,1)
 db.psql(db.override('priority','customer-00001'));const priority=await measure('priority');assert.equal(priority.value.calculationId,warm.value.calculationId);assert.equal(priority.metrics.features.roundTrips,0)
 db.psql(db.action(undefined,'customer-00001'));const action=await measure('action-history');assert.equal(action.value.calculationId,warm.value.calculationId)
 db.dispute('invoice-00001-1',20);const financial=await measure('financial')
 assert.equal(financial.metrics.features.featuresRebuilt,1);assert.equal(financial.metrics.features.canonicalBuildRequests,0)
 const rollover=await measure('rollover',{date:'2026-10-02T00:00:00Z'});assert.equal(rollover.metrics.features.canonicalBuildRequests,0)
 const storage=JSON.parse(db.psql("select jsonb_build_object('calculations',(select count(*) from public.collection_portfolio_calculations),'scoreRows',(select count(*) from public.collection_portfolio_base_scores),'manifestTableBytes',pg_total_relation_size('public.collection_portfolio_calculations'),'scoreTableBytes',pg_total_relation_size('public.collection_portfolio_base_scores'));"))
 const summary={customers:n,invoices:n*5,payments:n,featurePreparation:prepared,storage,journeys:[cold,warm,complete,target,priority,action,financial,rollover].map(measured=>{const {value,...measurement}=measured;return {...measurement,customerCount:measured.name==='compact-population'||measured.name==='target'?value.rows.length:value.customerCount}})}
 results.push(summary);console.log(JSON.stringify(summary));writeFileSync('/tmp/yuohme-phase34/scale.json',JSON.stringify(results,null,2))
}}finally{db.cleanup()}
