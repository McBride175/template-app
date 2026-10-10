import assert from 'node:assert/strict'
import test from 'node:test'
import React,{act} from 'react'
import {JSDOM} from 'jsdom'
import {loadTypeScriptModule} from './test-helpers/ts-module-loader.mjs'
const runtime=await import('react/jsx-runtime')
const {disputeFixture:row,disputeQuery:query,disputeResponse}=loadTypeScriptModule('stories/ui/disputeFixture.ts')
async function setup(initialQuery=query){
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/disputes?tenantId=synthetic',pretendToBeVisual:true})
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')}
 dom.window.scrollTo=()=>{};dom.window.confirm=()=>true
 const keys=['window','document','HTMLElement','Event','CustomEvent','StorageEvent','fetch','IS_REACT_ACT_ENVIRONMENT'],old=Object.fromEntries(keys.map(k=>[k,globalThis[k]]))
 for(const k of keys)if(k in dom.window)globalThis[k]=dom.window[k];globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const requests=[],navigation=[];globalThis.fetch=(url,init)=>new Promise(resolve=>requests.push({url,init,resolve}))
 const Link=({href,children,...props})=>React.createElement('a',{href,...props},children)
 const Client=loadTypeScriptModule('app/disputes/DisputesClient.tsx',{mocks:{react:React,'react/jsx-runtime':runtime,'next/link':Link,'next/navigation':{useRouter:()=>({push:href=>navigation.push(href)})}}}).default
 const {createRoot}=await import('react-dom/client'),container=dom.window.document.getElementById('root'),root=createRoot(container)
 const render=async(props={})=>act(async()=>root.render(React.createElement(Client,{tenantId:'synthetic',query:initialQuery,...props})))
 const body=async(index,value,status=200)=>act(async()=>requests[index].resolve(new Response(JSON.stringify(value),{status})))
 const list=async(index,rows=[row],q=initialQuery,status=200)=>body(index,status===200?disputeResponse(rows,q):{ok:false,error:'Read unavailable'},status)
 const click=async(name)=>act(async()=>{const node=[...container.querySelectorAll('button')].find(x=>x.textContent.trim()===name);assert.ok(node,name);node.click()})
 const set=async(label,value)=>act(async()=>{const node=[...container.querySelectorAll('label')].find(x=>x.textContent.startsWith(label));assert.ok(node,label);const input=node.querySelector('input,textarea');input[Object.keys(input).find(k=>k.startsWith('__reactProps$'))].onChange({target:{value}})})
 await render()
 return {dom,requests,navigation,container,render,body,list,click,set,cleanup:async()=>{await act(async()=>root.unmount());Object.assign(globalThis,old);dom.window.close()}}
}
async function open(f,invoice=row){await f.list(0,[invoice]);await f.click('Manage');assert.equal(f.requests.length,2);const url=new URL(f.requests[1].url,'http://localhost');assert.equal(url.pathname,'/api/collections/invoice-disputes');assert.equal(url.searchParams.get('tenantId'),'synthetic');assert.equal(url.searchParams.get('customerSourceId'),invoice.customerSourceId);assert.equal(url.searchParams.get('invoiceSourceId'),invoice.invoiceSourceId);await f.body(1,{ok:true,invoices:[invoice]})}
const record=invoice=>({dispute_mode:invoice.disputeMode,recorded_disputed_amount_native:invoice.recordedDisputedAmountNative,note:invoice.note,is_active:invoice.isActive,revision:invoice.revision})
const reconciliation=invoice=>({reconciliationReady:true,tenantId:'synthetic',customerSourceId:invoice.customerSourceId,detail:{invoices:[invoice]},version:{financialEpoch:'2'},projection:null})

test('compact worklist has one initial read, no per-row editors/prefetch; current context loads only on Manage and separate investigation retains query',async()=>{
 const f=await setup();try{
 assert.equal(f.requests.length,1);await open(f);assert.equal(f.navigation.length,0);assert.ok(f.container.querySelector('dialog'));assert.equal(f.requests.length,2)
 assert.ok(!f.container.querySelector('dialog article'),'no nested invoice card');const link=f.container.querySelector('dialog a');const url=new URL(link.href);assert.equal(url.pathname,'/customers');assert.equal(url.searchParams.get('tenantId'),'synthetic');assert.equal(url.hash,'#invoice-synthetic-invoice-1');assert.equal(new URL(url.searchParams.get('disputesReturn'),'http://localhost').pathname,'/disputes')
 await f.click('Close');assert.ok(!f.container.querySelector('dialog'))
 }finally{await f.cleanup()}
})
for(const operation of ['partial','full','note','resolve','confirm','reactivate'])test(`${operation}: same revision controller, one scoped reconciliation and worklist read, manager survives row leaving Active`,async()=>{
 const f=await setup(operation==='reactivate'?{...query,status:'resolved'}:query);try{
 const initial={...row,needsReview:operation==='confirm',isResolved:operation==='reactivate',isActive:operation!=='reactivate',...(operation==='reactivate'?{effectiveDisputedAmountNative:'0',collectibleAmountNative:'4250',toChaseAmountNative:'4250'}:{})}
 await open(f,initial)
 if(operation==='note'){await f.click('Edit note');await f.set('Dispute note','Updated note');await f.click('Save note')}
 else if(operation==='partial'||operation==='full'){
  await f.click('Edit dispute');if(operation==='partial')await f.set('Partial disputed amount','1100');else await f.set('Dispute full outstanding amount','ignored')
  await f.set('Optional note','Call details');await f.click('Save dispute')
 }else await f.click({resolve:'Resolve dispute',confirm:'Keep as is',reactivate:'Reactivate dispute'}[operation])
 assert.equal(f.requests.length,3);const command=JSON.parse(f.requests[2].init.body);assert.equal(command.operation,operation);assert.equal(command.expected_revision,'4');assert.equal(command.reconcile,true);assert.equal(command.tenantId,'synthetic')
 const saved={...initial,revision:'5',needsReview:false,note:operation==='note'?'Updated note':initial.note,isActive:operation!=='resolve',isResolved:operation==='resolve',...(operation==='partial'?{recordedDisputedAmountNative:'1100',effectiveDisputedAmountNative:'1100',collectibleAmountNative:'3150',toChaseAmountNative:'3150'}:operation==='full'?{disputeMode:'full',recordedDisputedAmountNative:'5000',effectiveDisputedAmountNative:'5000',activePromisedCoverageAmountNative:'0',collectibleAmountNative:'0',toChaseAmountNative:'0'}:operation==='resolve'?{effectiveDisputedAmountNative:'0',collectibleAmountNative:'4250',toChaseAmountNative:'4250'}:operation==='reactivate'?{effectiveDisputedAmountNative:'1200',collectibleAmountNative:'3050',toChaseAmountNative:'3050'}:{})}
 await f.body(2,{ok:true,dispute:record(saved),reconciliation:reconciliation(saved)})
 assert.equal(f.requests.length,4,'no duplicate selected-invoice read after ready reconciliation');await f.list(3,['resolve','reactivate'].includes(operation)?[]:[saved]);assert.ok(f.container.querySelector('dialog'));assert.equal(f.requests.filter(r=>r.init.method==='POST').length,1)
 assert.ok(!f.container.querySelector('dialog button[aria-label="Close dispute management"]').disabled)
 if(operation==='resolve'){assert.match(f.container.querySelector('dialog').textContent,/Resolved by user/);assert.match(f.container.querySelector('dialog').textContent,/Dispute resolved/)}
 }finally{await f.cleanup()}
})
test('invalid partial values produce no write, including exact decimal boundary beyond safe integer precision',async()=>{
 const f=await setup();try{
 const invoice={...row,currentAmountDueNative:'9999999999999999.99'};await open(f,invoice);await f.click('Edit dispute')
 for(const amount of ['0','-1','invalid','1.123456789','10000000000000000.00']){await f.set('Partial disputed amount',amount);await f.click('Save dispute');assert.equal(f.requests.length,2)}
 await f.set('Partial disputed amount','9999999999999999.98');await f.click('Save dispute');assert.equal(JSON.parse(f.requests[2].init.body).disputedAmountNative,'9999999999999999.98')
 }finally{await f.cleanup()}
})
test('uncertain response preserves draft, locks controls and dismissal, read recovery never blindly repeats the write',async()=>{
 const f=await setup();try{
 await open(f);await f.click('Edit dispute');await f.set('Optional note','Unconfirmed draft');await f.click('Save dispute');await f.body(2,{error:'Uncertain upstream failure'},500)
 const close=f.container.querySelector('dialog button[aria-label="Close dispute management"]');assert.equal(close.disabled,true);assert.equal(f.container.querySelector('dialog textarea').value,'Unconfirmed draft');assert.equal(f.container.querySelector('dialog textarea').disabled,true)
 await act(async()=>f.container.querySelector('dialog').dispatchEvent(new f.dom.window.Event('cancel',{cancelable:true})));assert.ok(f.container.querySelector('dialog'))
 await f.click('Check current dispute');await f.body(3,{ok:true,invoices:[{...row,revision:'5',note:'Authoritative saved note'}]});await f.list(4,[{...row,revision:'5'}]);assert.equal(f.requests.filter(r=>r.init.method==='POST').length,1);assert.equal(close.disabled,false);assert.match(f.container.textContent,/earlier response was not confirmed/)
 }finally{await f.cleanup()}
})
test('confirmed success survives failed list refresh, preserves record and disables unsafe mutations until read retry',async()=>{
 const f=await setup();try{
 await open(f);await f.click('Resolve dispute');const saved={...row,revision:'5',isActive:false,isResolved:true}
 await f.body(2,{ok:true,dispute:record(saved),reconciliation:reconciliation(saved)});await f.list(3,[],query,500)
 assert.match(f.container.querySelector('dialog').textContent,/Dispute saved, but current balances are not ready/);assert.match(f.container.querySelector('dialog').textContent,/Resolved by user/);assert.ok(f.container.querySelector('ol'));assert.equal(f.container.querySelector('dialog button').disabled,false)
 await f.click('Restore current details');await f.body(4,{ok:true,invoices:[saved]});await f.list(5,[]);assert.equal(f.requests.filter(r=>r.init.method==='POST').length,1);assert.match(f.container.textContent,/Current dispute details restored/)
 }finally{await f.cleanup()}
})
test('revision conflict restores latest details, closes only the old edit and does not resubmit',async()=>{
 const f=await setup();try{
 await open(f);await f.click('Edit dispute');await f.set('Optional note','Old draft');await f.click('Save dispute');await f.body(2,{code:'conflict',error:'This dispute changed.'},409)
 await f.body(3,{ok:true,invoices:[{...row,revision:'9',note:'Newest record'}]});await f.list(4,[{...row,revision:'9'}]);await f.click('Edit dispute');assert.equal(f.container.querySelector('dialog textarea').value,'Newest record');assert.equal(f.requests.filter(r=>r.init.method==='POST').length,1)
 }finally{await f.cleanup()}
})
test('applied filters/page/search and draft survive background refresh; old-tenant and out-of-order results never display',async()=>{
 const f=await setup();try{
 const q={...query,q:'INV',sort:'oldest',page:3,status:'all'};await f.render({query:q});assert.equal(f.requests[0].init.signal.aborted,true);await f.list(1,[row],q);await f.click('Manage');await f.body(2,{ok:true,invoices:[row]});await f.click('Edit dispute');await f.set('Optional note','Unsaved')
 await act(async()=>f.dom.window.dispatchEvent(new f.dom.window.CustomEvent('accounting-updated')));const url=new URL(f.requests[3].url,'http://localhost');assert.equal(url.searchParams.get('page'),'3');assert.equal(url.searchParams.get('sort'),'oldest');await f.list(3,[{...row,note:'External'}],q);assert.equal(f.container.querySelector('dialog textarea').value,'Unsaved')
 await f.list(0,[{...row,customerName:'Stale initial'}]);assert.ok(!f.container.textContent.includes('Stale initial'))
 await f.render({tenantId:'other',query});assert.ok(!f.container.querySelector('dialog'));assert.ok(!f.container.textContent.includes('Northbridge'));assert.equal(f.requests[2].init.signal.aborted,true)
 await f.body(4,{...disputeResponse([row]),tenantId:'synthetic'});assert.ok(!f.container.textContent.includes('Northbridge'),'mismatched response tenant rejected')
 }finally{await f.cleanup()}
})
test('unavailable orphan dispute retains operational resolution and note tools without pretending accounting is available',async()=>{
 const f=await setup({...query,status:'unavailable'});try{
 const orphan={...row,customerSourceId:null,customerHref:null,invoiceState:'unavailable',currentAmountDueNative:null,effectiveDisputedAmountNative:null};await f.list(0,[orphan]);await f.click('Manage');assert.equal(f.requests.length,1)
 const dialog=f.container.querySelector('dialog');assert.match(dialog.textContent,/Current accounting values unavailable/);assert.ok(![...dialog.querySelectorAll('button')].some(x=>/Edit dispute|Reactivate dispute|Mark disputed/.test(x.textContent)));assert.ok([...dialog.querySelectorAll('button')].some(x=>x.textContent==='Resolve dispute'))
 }finally{await f.cleanup()}
})
test('closing an unsaved draft requires confirmation and keeps state when discard is declined',async()=>{
 const f=await setup();try{await open(f);await f.click('Edit dispute');await f.set('Optional note','Keep me');f.dom.window.confirm=()=>false;await f.click('Close');assert.equal(f.container.querySelector('dialog textarea').value,'Keep me');assert.equal(f.requests.length,2)}finally{await f.cleanup()}
})
test('late mutation/reconciliation from a replaced tenant cannot reload an old URL or replace the new worklist',async()=>{
 const f=await setup();try{
 await open(f);await f.click('Resolve dispute');assert.equal(f.requests.length,3)
 await f.render({tenantId:'other',query});assert.equal(f.requests.length,4);assert.ok(!f.container.querySelector('dialog'))
 const other={...row,disputeId:'other-dispute',customerSourceId:'other-customer',customerName:'New tenant customer'}
 await f.body(3,{...disputeResponse([other]),customers:[{sourceId:other.customerSourceId,name:other.customerName}],tenantId:'other'});await f.body(2,{ok:true,dispute:record({...row,isActive:false,isResolved:true}),reconciliation:reconciliation({...row,isActive:false,isResolved:true})})
 assert.equal(f.requests.length,4);assert.match(f.container.textContent,/New tenant customer/);assert.ok(!f.container.textContent.includes('Northbridge'))
 }finally{await f.cleanup()}
})
test('context loading failure retries only that invoice; rapid target replacement discards stale context',async()=>{
 const f=await setup();try{
 const other={...row,disputeId:'second-dispute',invoiceSourceId:'second-invoice',customerName:'Second customer'};await f.list(0,[row,other]);await f.click('Manage');await f.body(1,{ok:false},503);assert.ok(!f.container.querySelector('dialog input'))
 await f.click('Retry dispute details');const old=f.requests[2];await f.click('Close');assert.equal(old.init.signal.aborted,true)
 await act(async()=>[...f.container.querySelectorAll('button')].filter(x=>x.textContent==='Manage')[1].click());await f.body(3,{ok:true,invoices:[other]});await f.body(2,{ok:true,invoices:[row]});assert.equal(f.container.querySelector('dialog h2').textContent,'Second customer')
 }finally{await f.cleanup()}
})
test('pending save cannot duplicate a request and cannot be closed through the management control',async()=>{
 const f=await setup();try{
 await open(f);await f.click('Resolve dispute');await f.click('Resolve dispute');assert.equal(f.requests.filter(x=>x.init.method==='POST').length,1)
 const close=f.container.querySelector('dialog button[aria-label="Close dispute management"]');assert.equal(close.disabled,true)
 }finally{await f.cleanup()}
})
test('retained accounting-unavailable invoice can resolve and refresh its operational record without a fictitious financial reconciliation',async()=>{
 const f=await setup({...query,status:'unavailable'});try{
 const unavailable={...row,invoiceState:'unavailable',currentAmountDueNative:null,effectiveDisputedAmountNative:null};await f.list(0,[unavailable]);await f.click('Manage');assert.equal(f.requests.length,1)
 await f.click('Resolve dispute');const saved={...unavailable,isActive:false,isResolved:true,revision:'5'}
 await f.body(1,{ok:true,dispute:record(saved),reconciliation:{reconciliationReady:false,reason:'unavailable'}});assert.equal(f.requests.length,3);assert.ok(f.requests[2].url.startsWith('/api/collections/disputes?'));await f.list(2,[saved])
 const dialog=f.container.querySelector('dialog');assert.match(dialog.textContent,/Dispute resolved/);assert.match(dialog.textContent,/Current accounting values unavailable/);assert.match(dialog.textContent,/Resolved by user/);assert.ok(![...dialog.querySelectorAll('button')].some(x=>/Edit dispute|Reactivate dispute/.test(x.textContent)));assert.equal(f.requests.filter(x=>x.init.method==='POST').length,1)
 }finally{await f.cleanup()}
})
test('an incomplete success response cannot falsely declare resolution or permit a blind retry',async()=>{
 const f=await setup();try{
 await open(f);await f.click('Resolve dispute');await f.body(2,{ok:true,dispute:{}})
 const dialog=f.container.querySelector('dialog');assert.match(dialog.textContent,/Save response incomplete/);assert.equal(dialog.querySelector('button[aria-label="Close dispute management"]').disabled,true);assert.ok(!dialog.textContent.includes('Saved record: Resolved'))
 assert.equal(f.requests.filter(x=>x.init.method==='POST').length,1);assert.ok([...dialog.querySelectorAll('button')].some(x=>x.textContent==='Check current dispute'))
 }finally{await f.cleanup()}
})
