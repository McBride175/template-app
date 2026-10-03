// Opt-in deterministic local command + reconciliation benchmark. No hosted/provider access.
import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import * as db from './test-helpers/dependency-database-fixture.mjs'
import {cert} from './test-helpers/materialization-client.mjs'
import {client,parameters,portfolio} from './test-helpers/portfolio-client.mjs'
import {loadTypeScriptModule} from '../xero/test-helpers/ts-module-loader.mjs'
const {reconcileCollectionFinancialMutation:reconcile}=loadTypeScriptModule('lib/collections/financial-mutation-reconciliation-server.ts')
if(process.env.RUN_SUPABASE_INTEGRATION!=='1')throw Error('Disposable local opt-in required')
const output=[],now=()=>new Date().toISOString()
try{db.setup();for(const n of [100,1000,10000]){
 db.reset();const run=db.ready({invoiceChanges:{due_date:'2026-09-01'}})
    db.psql(`insert into public.canonical_customers
      select (jsonb_populate_record(null::public.canonical_customers,
        to_jsonb(c)||jsonb_build_object('id',gen_random_uuid(),
        'source_id','customer-'||lpad(s::text,5,'0'),'is_customer',true))).*
      from public.canonical_customers c cross join generate_series(1,${n}) s where c.source_id='c1';
      insert into public.canonical_invoices
      select (jsonb_populate_record(null::public.canonical_invoices,
        to_jsonb(i)||jsonb_build_object('id',gen_random_uuid(),
        'source_id','invoice-'||lpad(s::text,5,'0')||'-'||j,
        'customer_source_id','customer-'||lpad(s::text,5,'0'),
        'status',case when j>2 then 'PAID' else 'AUTHORISED' end,
        'issue_date','2026-07-01','due_date','2026-09-01',
        'fully_paid_date',case when j>2 then '2026-09-10' else null end,
        'total_native','100','amount_paid_native',case when j>2 then '100' else '10' end,
        'amount_due_native',case when j>2 then '0' else '90' end,
        'amount_due_base',case when j>2 then '0' else '90' end))).*
      from public.canonical_invoices i cross join generate_series(1,${n}) s
        cross join generate_series(1,5) j where i.source_id='i1';
      insert into public.canonical_payments(user_id,tenant_id,source_system,sync_run_id,
        source_id,customer_source_id,invoice_source_id,payment_date)
      select '${db.user}','tenant-a','xero','${run.run}','payment-'||s,
        'customer-'||lpad(s::text,5,'0'),
        'invoice-'||lpad(s::text,5,'0')||'-1','2026-09-20'
      from generate_series(1,${n}) s;
      delete from public.canonical_invoices where source_id='i1';
      delete from public.canonical_customers where source_id='c1';`)
 cert(db,run.run)
 const admin=client(db)
 await portfolio.ensurePortfolioBaseCalculation(parameters(db,admin,now(),false))
 const customer='customer-00001',invoice='invoice-00001-1',journeys=[]
 let promiseId,disputeId
 async function measure(name,mutate,metadata=false){
  const allStarted=performance.now(),at=admin.calls.length,mutationStarted=performance.now()
  mutate();const mutationMs=performance.now()-mutationStarted
  const result=await reconcile({admin,userId:db.user,tenantId:'tenant-a',customerSourceId:customer})
  const totalMs=performance.now()-allStarted,calls=admin.calls.slice(at)
  const record={name,ready:result.reconciliationReady,mutationMs,totalMs,reconciliationMs:result.metrics.totalMs,
   metrics:result.metrics,rpcCount:calls.length,databaseExecutionMs:calls.reduce((s,c)=>s+c.databaseMs,0),
   publicationSqlMs:calls.filter(c=>c.name==='publish_collection_portfolio_calculation').reduce((s,c)=>s+c.databaseMs,0),
   databasePayloadBytes:calls.reduce((s,c)=>s+c.bytes,0),responseBytes:Buffer.byteLength(JSON.stringify(result)),
   invoiceDisplayReadRequests:calls.filter(c=>c.name==='read_collection_customer_detail_bootstrap').length}
  journeys.push(record);console.log(JSON.stringify({customers:n,...record}))
  if(result.reconciliationReady){assert.equal(result.metrics.portfolio.features.canonicalBuildRequests,0)
   assert.equal(result.metrics.portfolio.features.featuresRebuilt,metadata?0:1)
   if(metadata)assert.equal(result.metrics.portfolio.scoresRecalculated,0)
  }
 }
 await measure('promise-create',()=>{promiseId=db.promiseRequest({operation:'create',invoiceSourceId:invoice,amount:'40',promisedDate:'2099-12-31'}).promise.id})
 await measure('promise-amount',()=>db.promiseRequest({operation:'edit',promiseId,amount:'30'}))
 await measure('promise-note',()=>db.promiseRequest({operation:'edit',promiseId,note:'metadata'}),true)
 await measure('promise-cancel',()=>db.promiseRequest({operation:'cancel',promiseId}))
 await measure('dispute-create',()=>{disputeId=db.psql(`insert into public.invoice_disputes(user_id,tenant_id,source_system,invoice_source_id,dispute_mode,recorded_disputed_amount_native,amount_due_at_last_review_native)
   values('${db.user}','tenant-a','xero','${invoice}','partial',20,90) returning id;`)})
 await measure('dispute-amount',()=>db.psql(`update public.invoice_disputes set recorded_disputed_amount_native=25 where id='${disputeId}';`))
 await measure('dispute-note',()=>db.psql(`update public.invoice_disputes set note='metadata' where id='${disputeId}';`),true)
 await measure('dispute-resolve',()=>db.psql(`update public.invoice_disputes set is_active=false,resolved_at=now() where id='${disputeId}';`))
 await measure('dispute-reactivate',()=>db.psql(`update public.invoice_disputes set is_active=true,resolved_at=null where id='${disputeId}';`))
 output.push({customers:n,invoices:n*5,journeys})
 writeFileSync('/tmp/yuohme-phase37/scale.json',JSON.stringify(output,null,2))
}}finally{db.cleanup()}
