import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
const { compactDashboardCollection, DASHBOARD_CARD_FIELDS } = loadTypeScriptModule('lib/dashboard/collection-projection.ts')
const { dashboardResponseStamp, shouldApplyDashboardResponse } = loadTypeScriptModule('lib/dashboard/bootstrap-client.ts')
const G = '00000000-0000-4000-8000-000000000001'
const context = extra => ({ subscription:null,paid:false,claim:{allowed:true,usage_days_consumed:1,usage_date_already_recorded:false},
 connection:{tenant_id:'tenant-a',tenant_name:'Synthetic',auth_state:'active',grant_id:'g',last_refresh_error:null},
 grantScopes:['offline_access','accounting.settings.read','accounting.contacts.read','accounting.invoices.read','accounting.payments.read'],
 snapshot:{mode:'generation',syncRunId:G},lastSyncedAt:'2026-10-01T00:00:00Z',invalidSnapshot:false,statusUnavailable:false,
 latestRun:null,financialEpoch:'1',projectionRevision:'0',accessDigest:'access',...extra })
const projection = extra => ({ rows:[{customer_source_id:'c1',customer_name:'One',customer_email:null,
 customer_to_chase_overdue_base:50,override_level:'normal',recommended_action:'Review now',priority_score:75,
 has_actionable_overdue_balance:true,score_breakdown_lines:['SECRET-LARGE-DETAIL'],reason:'table only'}],
 actionsTakenByCustomerId:{hidden:{type:'called'},c1:{type:'emailed'}},queue:{status:'ready',remainingCustomerCount:1},reviews:[],
 experience:{hasPriorCollectionActivity:false},followUpSchedule:null,
 version:{accountingGenerationId:G,financialEpoch:'1',projectionRevision:'0',financialCalculationId:'calc',evaluationDate:'2026-10-03'},
 metadata:{currencyContext:{mode:'single_currency',invoicedCurrencies:['GBP'],relevantInvoiceCount:1},organisationBaseCurrency:'GBP',currencyHealth:{status:'healthy'}},
 metrics:{customersExamined:1000,calculationRebuilt:false},...extra })
function setup({ctx=context(), project=projection(), hook}={}) {
 const calls=[];let projects=0
 const admin={async rpc(name,args){calls.push({name,args});const c=name==='read_dashboard_bootstrap_context'&&typeof ctx==='function'?await ctx(calls.filter(c=>c.name==='read_dashboard_bootstrap_context').length,args):typeof ctx==='function'?context():ctx;const data=name==='claim_billing_usage_day'?c.claim:c;return {data,error:null}}}
 const { readDashboardBootstrap }=loadTypeScriptModule('lib/dashboard/bootstrap-server.ts', { mocks:{
  '@/lib/collections/fast-queue-projection-server':{classPlaceholder:null,FastQueueUnavailable:class extends Error{},async readCollectionQueueProjection(p){projects++;if(hook)await hook(p);if(project instanceof Error)throw project;return project}},
 }})
 return {read:()=>readDashboardBootstrap({admin,userId:'u',tenantId:'tenant-a',evaluationInstant:new Date('2026-10-03T12:00Z')}),calls,projects:()=>projects}
}
test('Dashboard card projection preserves exact displayed values and strips table explanations',()=>{
 const row=projection().rows[0],compact=compactDashboardCollection({rows:[row],queue:{status:'ready'}})
 assert.equal(compact.rows[0].customer_to_chase_overdue_base,row.customer_to_chase_overdue_base)
 assert.deepEqual(Object.keys(compact.rows[0]),DASHBOARD_CARD_FIELDS.filter(k=>k in row))
 assert.equal('score_breakdown_lines' in compact.rows[0],false);assert.equal('reason' in compact.rows[0],false)
 assert.equal(compact.queue.status,'ready')
})
test('warm Dashboard shares one context and returns compact current queue with no provider work',async()=>{
 const s=setup(),r=await s.read();assert.equal(r.collectionState,'ready');assert.equal(r.collection.rows.length,1)
 assert.equal(r.collection.entitlement.usageDaysConsumed,1);assert.equal(r.status.connected,true)
 assert.deepEqual(Object.keys(r.collection.actionsTakenByCustomerId),['c1']);assert.equal(s.projects(),1)
 assert.deepEqual(s.calls.map(c=>c.name),['read_dashboard_bootstrap_context','claim_billing_usage_day','read_dashboard_bootstrap_context'])
})
for(const change of [{latestRun:{id:'new',status:'running',lease_expires_at:'2099-01-01',started_at:'2026-10-03'}},
 {latestRun:{id:'bad',status:'failed',started_at:'2026-10-03',error_code:'provider_failure'},connection:{...context().connection,last_refresh_error:'refresh_failed'}},
 {statusUnavailable:true}]) test(`prior accounting remains usable during operational state ${JSON.stringify(change)}`,async()=>{
 const r=await setup({ctx:context(change)}).read();assert.equal(r.collectionState,'ready');assert.equal(r.collection.rows.length,1)
 assert.equal(r.collection.version.accountingGenerationId,G)
})
for(const [name,ctx,state] of [
 ['disconnected',context({connection:null,grantScopes:null,snapshot:null,lastSyncedAt:null,claim:null}),'onboarding'],
 ['first-sync',context({snapshot:{mode:'legacy',syncRunId:null},lastSyncedAt:null}),'onboarding'],
 ['revoked',context({connection:{...context().connection,auth_state:'reauth_required'},claim:null}),'onboarding'],
 ['exhausted',context({claim:{allowed:false,usage_days_consumed:5,usage_date_already_recorded:false}}),'blocked'],
 ['invalid-generation',context({invalidSnapshot:true,snapshot:null,lastSyncedAt:null}),'unavailable']]) {
 test(`${name} keeps its authoritative access/onboarding result without reading scores`,async()=>{
  const s=setup({ctx}),r=await s.read();assert.equal(r.collectionState,state);assert.equal(s.projects(),0)
  if(name==='exhausted')assert.equal(r.collection.code,'ACTION_USAGE_LIMIT_REACHED')
 })
}
test('collection failure retains useful connection state',async()=>{
 const s=setup({project:new Error('derivative unavailable')}),r=await s.read();assert.equal(r.status.connected,true)
 assert.equal(r.collectionState,'unavailable');assert.equal(r.collection,null)
})
for(const field of ['financialEpoch','projectionRevision','accessDigest']) test(`Dashboard retries ${field} race`,async()=>{
 let n=0;const ctx=context();const s=setup({ctx:()=>{n++;return n===2?{...ctx,[field]:'changed'}:ctx}})
 const r=await s.read();assert.equal(r.collectionState,'ready');assert.equal(s.projects(),2)
})
test('stale browser bootstrap cannot overwrite newer financial or operational revision',()=>{
 const body=(F,P,Gid=G)=>({status:{tenantId:'tenant-a'},collection:{version:{financialEpoch:F,projectionRevision:P,accountingGenerationId:Gid}}})
 const current=dashboardResponseStamp(body('2','4'),2)
 assert.equal(shouldApplyDashboardResponse(current,dashboardResponseStamp(body('1','3'),3)),false)
 assert.equal(shouldApplyDashboardResponse(current,dashboardResponseStamp(body('2','4'),1)),false)
 assert.equal(shouldApplyDashboardResponse(current,dashboardResponseStamp(body('2','4','wrong'),3)),false)
 assert.equal(shouldApplyDashboardResponse(current,dashboardResponseStamp(body('3','5'),3)),true)
})

test('Dashboard displayed fields/counts retain all 89 independently frozen financial and operational scenarios',async()=>{
 const {scenarios,captureCurrent}=await import('./test-helpers/calculation-parity-fixture.mjs')
 const {expectedByName}=await import('./test-helpers/calculation-goldens.mjs')
 for(const scenario of scenarios){
  const current=(await captureCurrent(scenario)).queue,expected=expectedByName.get(scenario.name).queue
  assert.equal(current.status,expected.status,scenario.name)
  const a=compactDashboardCollection(current.body),b=expected.body
  assert.deepEqual(a.rows,b.rows?.map(row=>Object.fromEntries(DASHBOARD_CARD_FIELDS.filter(key=>key in row).map(key=>[key,row[key]])))??[],scenario.name)
  for(const key of ['queue','experience','entitlement','currencyHealth','currencyAccess','reviewRequiredCustomers','followUpSchedule','actionsTakenByCustomerId']) assert.deepEqual(a[key],b[key],`${scenario.name}:${key}`)
 }
})

test('free allowance retains complete multi-currency access; paid Basic retains its existing restriction',async()=>{
 const p=projection();p.metadata.currencyContext={mode:'multi_currency',invoicedCurrencies:['GBP','USD'],relevantInvoiceCount:2}
 const free=await setup({project:p}).read();assert.equal(free.collectionState,'ready')
 process.env.STRIPE_PRICE_ID_BASIC='price_local_dashboard_basic'
 try{
  const ctx=context({paid:true,subscription:{status:'active',current_period_end:'2099-01-01',stripe_price_id:'price_local_dashboard_basic'}})
  const r=await setup({ctx,project:p}).read();assert.equal(r.collectionState,'blocked')
  assert.equal(r.collection.code,'MULTI_CURRENCY_REQUIRES_PRO');assert.deepEqual(r.collection.rows,[])
 }finally{delete process.env.STRIPE_PRICE_ID_BASIC}
})
test('permission recovery and first value consume no usage day; ready free access uses locked claim once',async()=>{
 for(const ctx of [context({lastSyncedAt:null}),context({grantScopes:['offline_access']})]){
  const s=setup({ctx});await s.read();assert.equal(s.calls.some(c=>c.name==='claim_billing_usage_day'),false)
 }
 const s=setup();await s.read();assert.equal(s.calls.filter(c=>c.name==='claim_billing_usage_day').length,1)
})
