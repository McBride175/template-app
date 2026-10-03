import assert from 'node:assert/strict'
import test from 'node:test'
import React,{act} from 'react'
import {JSDOM} from 'jsdom'
import {loadTypeScriptModule} from './test-helpers/ts-module-loader.mjs'
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/dashboard',pretendToBeVisual:true})
for(const key of ['window','document','HTMLElement','Event','CustomEvent','StorageEvent'])globalThis[key]=dom.window[key]
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {createRoot}=await import('react-dom/client')
const G='00000000-0000-4000-8000-000000000001'
const body=(name='Alpha',F='1',P='1',Gid=G,extra={})=>({ok:true,status:{connected:true,canSync:true,tenantId:'tenant-a',tenantName:'Synthetic',lastSyncedAt:'2026-10-01',connections:[],snapshot:{mode:'generation',syncRunId:Gid}},
 statusError:null,collectionState:'ready',collection:{ok:true,tenantId:'tenant-a',entitlement:{plan:'paid',isPaid:true,paidPlan:'pro',hasActionsAccess:true,freeUsageDaysLimit:5},
 rows:[{customer_source_id:'c1',customer_name:name,customer_email:null,customer_to_chase_overdue_base:100,
 customer_credit_applied_base:0,overdue_outstanding_base:100,effective_disputed_overdue_base_decimal:'0',
 has_actionable_overdue_balance:true,weighted_avg_overdue_days:12,last_payment_date:null,override_level:'normal',priority_score:80,recommended_action:'Review now',collectible_native_currency_breakdown:[],last_action_type:null,last_action_timestamp:null}],
 actionsTakenByCustomerId:{},queue:{status:'ready',remainingCustomerCount:1},currencyAccess:{allowed:true,requiresPro:false},currencyContext:{mode:'single_currency'},
 currencyHealth:{status:'healthy',failureReasons:{}},organisationBaseCurrency:'GBP',reviewRequiredCustomers:[],experience:{hasPriorCollectionActivity:true},
 version:{accountingGenerationId:Gid,financialEpoch:F,projectionRevision:P,financialCalculationId:'calc-'+F,evaluationDate:'2026-10-03'}},...extra})
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
async function render(handler,auto=()=>new Promise(()=>{})){
 const requests=[],router={replace:path=>requests.push({redirect:path}),push(){}}
 const {default:Component}=loadTypeScriptModule('app/dashboard/DashboardOnboardingClient.tsx',{mocks:{
  'next/navigation':{useRouter:()=>router,useSearchParams:()=>new URLSearchParams()},
  'next/link':{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)},
  '@/lib/supabase':{supabase:{auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}},
  '@/lib/xero/auto-sync-client':{triggerXeroAutoSyncOnEntry:args=>{requests.push({sync:args});return auto(args)}},
  '@/app/components/SubscriptionStatus':{__esModule:true,default:()=>null},
 }})
 globalThis.fetch=async(url,init)=>{requests.push({url,init});return handler(url,init)}
 const el=document.createElement('div');document.body.append(el);const root=createRoot(el)
 await act(async()=>root.render(React.createElement(Component)))
 return {el,requests,close:async()=>{await act(async()=>root.unmount());el.remove()}}
}
const response=b=>new Response(JSON.stringify(b),{status:200})
test('one bootstrap renders useful interactive cards before auto-sync settles; no status/queue GET waterfall',async()=>{
 const sync=deferred();let calls=0
 const ui=await render(async url=>{assert.equal(url,'/api/dashboard/bootstrap');return response(body(++calls===1?'Alpha':'Beta',''+calls,''+calls))},()=>sync.promise)
 assert.match(ui.el.textContent,/Alpha/);assert.match(ui.el.textContent,/Next to chase/)
 assert.equal(ui.requests.filter(r=>r.url).length,1);assert.equal(ui.requests.filter(r=>r.sync).length,1)
 await act(async()=>sync.resolve({state:'completed',triggered:true,syncSucceeded:true,reason:null}))
 assert.match(ui.el.textContent,/Beta/);assert.equal(ui.requests.filter(r=>r.url).length,2)
 assert.equal(ui.requests.some(r=>/api\/xero\/status|api\/collections\/actions/.test(r.url??'')),false)
 await ui.close()
})
test('failed refresh retains previous useful accounting and does not blank mounted queue',async()=>{
 let n=0;const sync=deferred()
 const ui=await render(async()=>response(body('Alpha','1','1',G,n++?{status:{...body().status,syncState:'temporary_sync_issue',hasTemporaryIssue:true}}:{})),()=>sync.promise)
 await act(async()=>sync.resolve({state:'completed',triggered:true,syncSucceeded:false}))
 assert.match(ui.el.textContent,/Alpha/);assert.match(ui.el.textContent,/Next to chase/);await ui.close()
})
test('independent status error cannot hide valid collection result',async()=>{
 const ui=await render(async()=>response(body('Alpha','1','1',G,{status:null,statusError:'Unavailable'})))
 assert.match(ui.el.textContent,/Alpha/);assert.match(ui.el.textContent,/couldn.t check/);await ui.close()
})
test('older bootstrap response cannot replace newer generation after two visibility reads',async()=>{
 let n=0;const older=deferred(),newer=deferred()
 const ui=await render(async()=>{n++;return n===1?response(body()):n===2?older.promise:newer.promise})
 await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));document.dispatchEvent(new Event('visibilitychange'))})
 await act(async()=>newer.resolve(response(body('New customer','2','2','00000000-0000-4000-8000-000000000002'))))
 assert.match(ui.el.textContent,/New customer/)
 await act(async()=>older.resolve(response(body('Old customer'))))
 assert.doesNotMatch(ui.el.textContent,/Old customer/);assert.match(ui.el.textContent,/New customer/);await ui.close()
})
test('first-value preparation redirects without attempting Dashboard auto-sync',async()=>{
 const ui=await render(async()=>response(body('Alpha','1','1',G,{collectionState:'onboarding',collection:null,status:{...body().status,lastSyncedAt:null}})))
 assert.ok(ui.requests.some(r=>r.redirect==='/start?tenantId=tenant-a'));assert.equal(ui.requests.some(r=>r.sync),false);await ui.close()
})

test('known external refresh is observed through metadata only, then loads new generation once',async()=>{
 const original=globalThis.setTimeout;let observe
 globalThis.setTimeout=(fn,ms,...args)=>ms===5000?(observe=fn,0):original(fn,ms,...args)
 let ui
 try{
  let n=0;const nextG='00000000-0000-4000-8000-000000000002'
  ui=await render(async url=>{
   n++
   if(n===1)return response(body('Alpha','1','1',G,{status:{...body().status,latestSyncAttempt:{runId:'external',state:'running'}}}))
   if(n===2){assert.match(url,/readinessOnly=true/);return response({status:{latestSyncAttempt:{state:'promoted'}},version:{accountingGenerationId:nextG,financialEpoch:'2',projectionRevision:'2'}})}
   return response(body('Updated','2','2',nextG))
  })
  assert.match(ui.el.textContent,/Alpha/);assert.ok(observe)
  await act(async()=>{observe();await new Promise(r=>original(r,0))})
  assert.match(ui.el.textContent,/Updated/);assert.equal(n,3)
 }finally{if(ui)await ui.close();globalThis.setTimeout=original}
})

test('preparing financial state is recoverable without false empty-queue state or a queue GET',async()=>{
 let n=0;const ui=await render(async url=>{assert.equal(url,'/api/dashboard/bootstrap');return response(n++?body('Recovered'):body('Alpha','1','1',G,{collectionState:'preparing',collection:null}))})
 assert.doesNotMatch(ui.el.textContent,/No collection actions available/)
 const button=[...ui.el.querySelectorAll('button')].find(b=>b.textContent==='Refresh priorities');assert.ok(button)
 await act(async()=>button.dispatchEvent(new Event('click',{bubbles:true})))
 assert.match(ui.el.textContent,/Recovered/);assert.doesNotMatch(ui.el.textContent,/Unable to load collection priorities/)
 assert.equal(n,2);await ui.close()
})

test('uncertain auto-sync response checks committed generation without repeating the provider trigger',async()=>{
 let n=0;const sync=deferred(),nextG='00000000-0000-4000-8000-000000000002'
 const ui=await render(async()=>response(n++?body('Published','2','2',nextG):body()),()=>sync.promise)
 await act(async()=>sync.resolve({state:'request_failed',triggered:false,syncSucceeded:false,reason:'request_failed'}))
 assert.match(ui.el.textContent,/Published/);assert.equal(ui.requests.filter(r=>r.sync).length,1);assert.equal(n,2)
 await ui.close()
})
