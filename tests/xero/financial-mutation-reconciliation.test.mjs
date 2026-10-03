import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
const date = () => new Date().toISOString().slice(0,10)
const identity = () => ({ generationId:'g1',financialEpoch:'3',evidenceIdentity:'e1',evaluationDate:date() })
const version = () => ({...identity(),customerRevision:'2',projectionRevision:'5'})
function fixture({ fail, race, delayed, queueMismatch }={}) {
 const calls=[],head={calculationId:'calculation-1',identity:identity()}
 let n=0
 const service=loadTypeScriptModule('lib/collections/financial-mutation-reconciliation-server.ts',{mocks:{
  '@/lib/collections/portfolio-materialization-server':{
   newPortfolioCalculationMetrics:()=>({features:{featuresRebuilt:0},scoresRecalculated:0}),
   readPortfolioBaseCalculation:async()=>{calls.push('read-only-portfolio');return null},
   ensurePortfolioBaseCalculation:async p=>{calls.push('portfolio');await p.admin.rpc('portfolio',{});return head},
  },
  '@/lib/collections/customer-detail-bootstrap-server':{readCustomerDetailBootstrap:async()=>{
   calls.push('detail');if(fail==='detail')throw Error('secret');return {row:{customer_source_id:'c1'},invoices:[],currencyContext:{mode:'multi_currency'},version:version()}
  }},
  '@/lib/collections/fast-queue-projection-server':{readCollectionQueueProjection:async()=>{
   calls.push('queue');return {version:{financialCalculationId:queueMismatch?'old':'calculation-1',projectionRevision:'5'},metadata:{},rows:[],reviews:[]}
  }},
  '@/lib/collections/dependency-state-server':{readCollectionDependencyState:async()=>{
   calls.push('fence');const v=version();if(race && (n++===0 || race==='always')) v[race==='always'?'financialEpoch':race]='99'
   return {accounting:{generationId:v.generationId},financialEpoch:v.financialEpoch,projectionRevision:v.projectionRevision,customer:{financialRevision:v.customerRevision}}
  }},
 }})
 const admin={rpc:()=>({abortSignal:signal=>new Promise((resolve,reject)=>{
  if(delayed) { signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});return }
  if(fail==='portfolio')reject(Error('secret'));else resolve({data:{},error:null})
 })})}
 return {calls,run:extra=>service.reconcileCollectionFinancialMutation({admin,userId:'owner',tenantId:'tenant-a',customerSourceId:'c1',...extra})}
}
test('warm financial reconciliation composes certified layers without queue formatting',async()=>{
 const f=fixture(),r=await f.run();assert.equal(r.reconciliationReady,true);assert.deepEqual(f.calls,['portfolio','detail','fence'])
 assert.equal(r.projection,null);assert.equal(r.version.financialCalculationId,'calculation-1');assert.equal(r.metrics.databaseCalls,1)
})
test('requested queue and detail share a fenced financial/projection identity',async()=>{
 const f=fixture(),r=await f.run({queue:{overdueOnly:true,limit:20}});assert.equal(r.reconciliationReady,true)
 assert.deepEqual(f.calls,['portfolio','detail','queue','fence']);assert.ok(r.projection)
})
for(const race of ['financialEpoch','generationId','customerRevision','projectionRevision'])test(`${race} changes cause coherent retry`,async()=>{
 const f=fixture({race}),r=await f.run();assert.equal(r.reconciliationReady,true);assert.equal(f.calls.filter(c=>c==='portfolio').length,2)
})
for(const fail of ['portfolio','detail'])test(`${fail} failure preserves committed continuation as not ready`,async()=>{
 const f=fixture({fail}),r=await f.run();assert.equal(r.reconciliationReady,false);assert.equal(r.reason,'unavailable');assert.equal('detail' in r,false)
 assert.doesNotMatch(JSON.stringify(r),/secret/)
})
test('bounded deadline aborts in-flight read and returns not ready without later stage',async()=>{
 const f=fixture({delayed:true}),r=await f.run({budgetMs:10});assert.equal(r.reconciliationReady,false);assert.equal(r.reason,'budget');assert.deepEqual(f.calls,['portfolio'])
})
for(const options of [{race:'always'},{queueMismatch:true}])test('unresolved race never labels inconsistent projection current',async()=>{
 const f=fixture(options),r=await f.run({queue:{overdueOnly:false,limit:20}});assert.equal(r.reconciliationReady,false);assert.equal(f.calls.filter(c=>c==='portfolio').length,3)
})
const {shouldApplyCustomerFinancialResponse:apply}=loadTypeScriptModule('lib/collections/financial-mutation-response.ts')
for(const field of ['financialEpoch','customerRevision','projectionRevision'])test(`older ${field} response cannot overwrite newer customer detail`,()=>{
 assert.equal(apply(version(),{...version(),[field]:'1'}),false);assert.equal(apply(version(),{...version(),[field]:'100'}),true)
})
test('date and generation ordering reject stale or mixed responses',()=>{
 assert.equal(apply(version(),{...version(),generationId:'g0'}),false)
 assert.equal(apply(version(),{...version(),generationId:'g2',financialEpoch:'4'}),true)
 assert.equal(apply(version(),{...version(),evaluationDate:'2000-01-01'}),false)
 assert.equal(apply(null,{...version(),customerRevision:'NaN'}),false)
})

test('metadata-only cold calculation is typed not ready without constructing financial state',async()=>{const f=fixture();const r=await f.run({metadataOnly:true});assert.equal(r.reconciliationReady,false);assert.deepEqual(f.calls,['read-only-portfolio'])})

test('current currency population is rechecked against command entitlement before returning detail',async()=>{const f=fixture();const r=await f.run({entitlement:{hasActionsAccess:true,isPaid:true,paidPlan:'basic'}});assert.equal(r.reconciliationReady,false);assert.equal('detail'in r,false)})
