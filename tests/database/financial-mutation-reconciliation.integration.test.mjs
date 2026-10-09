import assert from 'node:assert/strict'
import test,{before,after,beforeEach} from 'node:test'
import {randomUUID} from 'node:crypto'
import * as db from './test-helpers/dependency-database-fixture.mjs'
import {cert} from './test-helpers/materialization-client.mjs'
import {client,parameters,portfolio} from './test-helpers/portfolio-client.mjs'
import {loadTypeScriptModule} from '../xero/test-helpers/ts-module-loader.mjs'
const {reconcileCollectionFinancialMutation:reconcile}=loadTypeScriptModule('lib/collections/financial-mutation-reconciliation-server.ts')
const {readCustomerDetailBootstrap:detail}=loadTypeScriptModule('lib/collections/customer-detail-bootstrap-server.ts')
const {readCollectionQueueProjection:queue}=loadTypeScriptModule('lib/collections/fast-queue-projection-server.ts')
const enabled=process.env.RUN_SUPABASE_INTEGRATION==='1',check=(name,fn)=>test(name,{skip:!enabled},fn)
before(()=>{if(enabled)db.setup()});after(()=>{if(enabled)db.cleanup()});beforeEach(()=>{if(enabled)db.reset()})
const scope=admin=>({admin,userId:db.user,tenantId:'tenant-a',customerSourceId:'c1'})
async function prepare(){const run=db.ready({invoiceChanges:{due_date:'2026-09-01'},extraInvoices:[{source_id:'i2',customer_source_id:'c2'}]});cert(db,run.run)
 const admin=client(db);await portfolio.ensurePortfolioBaseCalculation(parameters(db,admin,new Date().toISOString(),false));return admin}
async function read(admin,withQueue=false){return reconcile({...scope(admin),...(withQueue?{queue:{overdueOnly:false,limit:200}}:{})})}
async function assertCurrent(admin,r){assert.equal(r.reconciliationReady,true)
 const clean=await detail({...scope(admin),evaluationInstant:new Date()});assert.deepEqual(r.detail.invoices,clean.invoices);assert.deepEqual(r.detail.row,clean.row)
 const scores=await portfolio.readPortfolioBaseCalculation({...parameters(db,admin,new Date().toISOString(),false),completePopulation:true})
 assert.equal(scores.head.calculationId,r.version.financialCalculationId)
 if(r.projection){const cleanQueue=await queue({...scope(admin),evaluationInstant:new Date(),overdueOnly:false,limit:200,legacyTodayDateIso:new Date().toISOString().slice(0,10)})
  assert.deepEqual(r.projection.rows,cleanQueue.rows);assert.deepEqual(r.projection.queue,cleanQueue.queue)}
}
check('financial dispute rebuilds one feature from existing basis; detail and queue equal clean reads',async()=>{
 const admin=await prepare();db.dispute('i1',2000);const r=await read(admin,true);await assertCurrent(admin,r)
 assert.equal(r.metrics.portfolio.features.featuresRebuilt,1);assert.equal(r.metrics.portfolio.features.canonicalBuildRequests,0)
 assert.equal(r.detail.row.effective_disputed_outstanding_base_decimal,'2000');assert.equal(r.metrics.portfolio.scoresRecalculated,2)
})
check('full/partial amount, resolve and reactivate preserve exact post-command projection',async()=>{
 const admin=await prepare(),id=db.dispute('i1',2000)
 for(const statement of ['recorded_disputed_amount_native=3000',"dispute_mode='full'",'is_active=false,resolved_at=now()','is_active=true,resolved_at=null']){
  db.psql(`update public.invoice_disputes set ${statement} where id='${id}';`);const r=await read(admin,true);await assertCurrent(admin,r)
  assert.equal(r.metrics.portfolio.features.featuresRebuilt,1);assert.equal(r.metrics.portfolio.features.canonicalBuildRequests,0)
 }
})
check('dispute notes/reconfirmation reuse same calculation with no financial extraction',async()=>{
 const admin=await prepare(),id=db.dispute('i1',2000);const financial=await read(admin)
 for(const statement of ["note='review note'",'amount_due_at_last_review_native=8000','amount_due_at_last_review_native=9000','amount_due_at_last_review_native=9000']){
  db.psql(`update public.invoice_disputes set ${statement} where id='${id}';`);const r=await reconcile({...scope(admin),metadataOnly:true})
  assert.equal(r.reconciliationReady,true);assert.equal(r.version.financialCalculationId,financial.version.financialCalculationId)
  assert.equal(r.metrics.portfolio.features.featuresRebuilt,0);assert.equal(r.metrics.portfolio.scoresRecalculated,0)
 }
})
check('Promise partial/full create, amount edits, date, note and cancel reconcile without peer feature rebuild',async()=>{
 const admin=await prepare();const made=db.createPromise();let last=await read(admin,true);await assertCurrent(admin,last)
 assert.equal(last.metrics.portfolio.features.featuresRebuilt,1)
 for(const change of [{amount:'9000'},{amount:'3000'},{note:'metadata only'},{promisedDate:'2099-12-30'},{operation:'cancel'}]){
  db.promiseRequest({operation:'edit',promiseId:made.promise.id,...change});const r=await read(admin,true);await assertCurrent(admin,r)
  const metadata='note'in change||'promisedDate'in change
  assert.equal(r.metrics.portfolio.features.featuresRebuilt,metadata?0:1)
  assert.equal(r.metrics.portfolio.features.canonicalBuildRequests,0)
  if(metadata)assert.equal(r.version.financialCalculationId,last.version.financialCalculationId)
  last=r
 }
})
check('same Promise command receipt replay reconciles but writes no second Promise or versions',async()=>{
 const admin=await prepare(),command=randomUUID(),intent={operation:'create',invoiceSourceId:'i1',amount:'4000',promisedDate:'2099-12-31'}
 const made=db.promiseRequest(intent,command);const first=await read(admin);const before=db.head()
 const receipt=JSON.parse(db.rpc(`select public.read_invoice_promise_request('${db.user}','tenant-a','${command}',${db.json(intent)});`))
 assert.equal(receipt.promise.id,made.promise.id);const replay=await read(admin)
 assert.deepEqual(db.head(),before);assert.equal(replay.version.financialCalculationId,first.version.financialCalculationId)
 assert.equal(replay.metrics.portfolio.scoresRecalculated,0)
 assert.equal(db.psql('select count(*) from public.invoice_promises;'),'1')
})
check('bulk disputes on one customer still rebuild one feature',async()=>{
 const run=db.ready({extraInvoices:[{source_id:'i2'}]});cert(db,run.run);const admin=client(db)
 await portfolio.ensurePortfolioBaseCalculation(parameters(db,admin,new Date().toISOString(),false))
 db.rpc(`select public.apply_invoice_disputes_bulk_full('${db.user}','tenant-a','xero',${db.json(['i1','i2'].map(invoice_source_id=>({invoice_source_id,amount_due_native:'9000',expected_revision:null})))});`)
 const r=await read(admin,true);await assertCurrent(admin,r);assert.equal(r.metrics.portfolio.features.featuresRebuilt,1)
})
check('financial mutation during publication rejects old F and finishes at latest revision',async()=>{
 const initial=await prepare();db.dispute('i1',2000);let changed=false
 const admin=client(db,async name=>{if(name==='publish_collection_portfolio_calculation'&&!changed){changed=true;db.dispute('i2',1000)}})
 const r=await read(admin,true);await assertCurrent(admin,r);assert.equal(changed,true);assert.equal(r.version.financialEpoch,db.head().financialEpoch)
 assert.equal(initial.calls.some(c=>c.name==='build_collection_customer_accounting_bases'),false)
})
check('priority and Action History races are retained in final operational projection',async()=>{
 await prepare();db.dispute('i1',2000);let changed=false
 const admin=client(db,async name=>{if(name==='read_collection_dependencies'&&!changed){changed=true;db.psql(db.override());db.psql(db.action())}})
 const r=await read(admin,true);await assertCurrent(admin,r);assert.equal(r.detail.row.override_level,'priority')
 assert.equal(r.version.projectionRevision,db.head().projectionRevision)
})
check('generation promotion during reconciliation cannot return old invoice balances',async()=>{
 await prepare();db.dispute('i1',2000);let promoted=null
 const admin=client(db,async name=>{if(name==='publish_collection_portfolio_calculation'&&!promoted){promoted=db.ready({invoiceChanges:{amount_due_native:'5000',amount_due_base:'5000',due_date:'2026-09-01'}});cert(db,promoted.run)}})
 let r=await read(admin)
 // A heavily loaded local Docker transport may use the unchanged ten-second
 // budget during the deliberately injected full generation. Timeout must not
 // return obsolete financial data; a subsequent ordinary ensure repairs it.
 if(!r.reconciliationReady){assert.equal(r.reason,'budget');assert.equal('detail'in r,false);r=await read(client(db))}
 await assertCurrent(admin,r);assert.equal(r.version.generationId,promoted.run)
 assert.equal(r.detail.invoices[0].currentAmountDueNative,'5000')
})
check('failed publication preserves committed domain state; later read repairs idempotently',async()=>{
 await prepare();const id=db.dispute('i1',2000);const before=db.head()
 const broken=client(db);const rpc=broken.rpc;broken.rpc=(name,args)=>name==='publish_collection_portfolio_calculation'?Promise.resolve({data:null,error:{message:'forced'}}):rpc(name,args)
 const unavailable=await read(broken);assert.equal(unavailable.reconciliationReady,false);assert.equal(db.psql(`select count(*) from public.invoice_disputes where id='${id}';`),'1')
 const recovered=await read(client(db));assert.equal(recovered.reconciliationReady,true);assert.deepEqual(db.head(),before)
})
check('foreign owner/customer scope cannot retrieve detail through reconciliation',async()=>{
 await prepare();const result=await reconcile({...scope(client(db)),userId:db.other});assert.equal(result.reconciliationReady,false);assert.equal('detail'in result,false)
 const absent=await reconcile({...scope(client(db)),customerSourceId:'missing'});assert.equal(absent.reconciliationReady,false)
})

check('metadata-only miss does not secretly reconstruct a financial calculation',async()=>{
 const run=db.ready();cert(db,run.run);const admin=client(db)
 const r=await reconcile({...scope(admin),metadataOnly:true})
 assert.equal(r.reconciliationReady,false);assert.equal(r.metrics.portfolio.features.featuresRebuilt,0)
 assert.equal(r.metrics.portfolio.scoresRecalculated,0)
 assert.equal(admin.calls.some(c=>c.name==='publish_collection_portfolio_calculation'),false)
})
