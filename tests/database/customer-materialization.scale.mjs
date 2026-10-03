// Explicit opt-in local benchmark. Creates/drops only its own disposable database.
import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import * as db from './test-helpers/dependency-database-fixture.mjs'
import {databaseClient,params,server,cert} from './test-helpers/materialization-client.mjs'
if(process.env.RUN_SUPABASE_INTEGRATION!=='1')throw Error('Disposable local database opt-in required')
const results=[]
try{
 db.setup()
 for(const n of [100,1000,10000]){
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
  const admin=databaseClient(db)
  async function measure(name,date='2026-10-01T12:00:00Z',customer=null){
   const p=params(db,admin,date),offset=admin.calls.length
   const result=customer?await server.ensureCustomerFinancialFeatures({...p,customerSourceId:customer}):await server.ensureCustomerFinancialFeaturesForPortfolio(p)
   const calls=admin.calls.slice(offset)
   return {name,metrics:p.metrics,databaseExecutionMs:calls.reduce((sum,c)=>sum+c.databaseMs,0),basisDatabaseMs:calls.filter(c=>c.name==='build_collection_customer_bases').reduce((sum,c)=>sum+c.databaseMs,0),result}
  }
  const cold=await measure('cold'),warm=await measure('warm');assert.deepEqual(warm.result,cold.result)
  assert.equal(cold.result.rows.length,n);assert.equal(cold.result.sourceCounts.invoices,n*5)
  const customer='customer-00001'
  db.dispute('invoice-00001-1',20)
  const financial=await measure('financial',undefined,customer)
  assert.equal(financial.metrics.featuresRebuilt,1);assert.equal(financial.metrics.canonicalBuildRequests,0)
  const rollover=await measure('rollover','2026-10-02T00:00:00Z')
  assert.equal(rollover.metrics.canonicalBuildRequests,0)
  const storage=JSON.parse(db.psql(`select jsonb_build_object('basisRows',(select count(*) from public.collection_customer_bases),
    'featureRows',(select count(*) from public.collection_customer_features),'basisBytes',(select sum(pg_column_size(payload)) from public.collection_customer_bases),
    'featureBytes',(select sum(pg_column_size(result)) from public.collection_customer_features),
    'basisTableBytes',pg_total_relation_size('public.collection_customer_bases'),'featureTableBytes',pg_total_relation_size('public.collection_customer_features'));`))
  const summary={customers:n,invoices:n*5,payments:n,storage,journeys:[cold,warm,financial,rollover].map(measured=>({name:measured.name,metrics:measured.metrics,databaseExecutionMs:measured.databaseExecutionMs,basisDatabaseMs:measured.basisDatabaseMs}))}
  results.push(summary);console.log(JSON.stringify(summary));writeFileSync('/tmp/yuohme-phase33/scale.json',JSON.stringify(results,null,2))
 }
}finally{db.cleanup()}
