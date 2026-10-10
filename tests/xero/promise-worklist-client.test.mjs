import assert from 'node:assert/strict'
import test from 'node:test'
import React,{act} from 'react'
import {JSDOM} from 'jsdom'
import {loadTypeScriptModule} from './test-helpers/ts-module-loader.mjs'
const runtime=await import('react/jsx-runtime')
const query={status:'active',date:'all',q:'',page:1,pageSize:25}
async function setup(){
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/promises?tenantId=tenant',pretendToBeVisual:true})
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')}
 dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')}
 dom.window.scrollTo=()=>{};dom.window.confirm=()=>true
 const keys=['window','document','HTMLElement','Event','CustomEvent','StorageEvent','fetch','IS_REACT_ACT_ENVIRONMENT'],old=Object.fromEntries(keys.map(k=>[k,globalThis[k]]))
 for(const k of keys)if(k in dom.window)globalThis[k]=dom.window[k];globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const requests=[],navigation=[];globalThis.fetch=(url,init)=>new Promise(resolve=>requests.push({url,init,resolve}))
 const Link=({href,children,...props})=>React.createElement('a',{href,...props},children)
 const Client=loadTypeScriptModule('app/promises/PromisesClient.tsx',{mocks:{react:React,'react/jsx-runtime':runtime,'next/link':Link,'next/navigation':{useRouter:()=>({push:href=>navigation.push(href)})}}}).default
 const {createRoot}=await import('react-dom/client')
 const root=createRoot(dom.window.document.getElementById('root')),container=dom.window.document.getElementById('root')
 const render=async(props={})=>act(async()=>root.render(React.createElement(Client,{tenantId:'tenant',query,...props})))
 const body=async(index,value,status=200)=>act(async()=>requests[index].resolve(new Response(JSON.stringify(value),{status})))
 const click=async(label)=>act(async()=>{const button=[...container.querySelectorAll('button')].find(x=>x.textContent===label);assert.ok(button,label);button.click()})
 const set=async(label,value)=>act(async()=>{const field=[...container.querySelectorAll('label')].find(x=>x.textContent===label);assert.ok(field,label);const input=dom.window.document.getElementById(field.htmlFor);input[Object.keys(input).find(k=>k.startsWith('__reactProps$'))].onChange({target:{value}})})
 const submit=async()=>act(async()=>container.querySelector('dialog form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})))
 const respond=async(index,rows=[],status=200)=>act(async()=>requests[index].resolve(new Response(JSON.stringify({ok:status===200,tenantId:'tenant',query,rows,total:rows.length,pageCount:1,organisationDate:'2026-10-10',timezone:'Europe/London',error:status!==200?'Unavailable':undefined}),{status})))
 await render()
 return {dom,requests,navigation,render,respond,body,click,set,submit,container,cleanup:async()=>{await act(async()=>root.unmount());Object.assign(globalThis,old);dom.window.close()}}
}
const row=name=>({id:name,customerSourceId:name,invoiceSourceId:'invoice',customerName:name,invoiceReference:'INV-1',status:'active',currencyCode:'GBP',promisedAmountNative:'500',qualifyingPaidAmountNative:'125',promisedDate:'2026-10-08',dateCategory:'passed',currentOutstandingNative:'1000',currentInvoiceStatus:'AUTHORISED',contextUnavailable:false,financialUnavailable:false})
test('one mount request; input changes wait for Apply, no per-row loads or lifecycle mutations',async()=>{
 const f=await setup();try{
 assert.equal(f.requests.length,1);await f.respond(0,[row('Acme'),row('Baker')]);assert.equal(f.requests.length,1)
 const input=f.container.querySelector('input');await act(async()=>{input[Object.keys(input).find(k=>k.startsWith('__reactProps$'))].onChange({target:{value:'Acme'}})})
 assert.equal(f.requests.length,1)
 await act(async()=>f.container.querySelector('form').dispatchEvent(new f.dom.window.Event('submit',{bubbles:true,cancelable:true})))
 assert.equal(f.requests.length,1);assert.equal(new URL(f.navigation[0],'http://localhost').searchParams.get('q'),'Acme')
 }finally{await f.cleanup()}
})
test('rapid filter/tenant changes cancel requests and discard out-of-order results',async()=>{
 const f=await setup();try{
 await f.render({query:{...query,q:'new'}});assert.equal(f.requests[0].init.signal.aborted,true)
 await f.respond(1,[row('Newest')]);await f.respond(0,[row('STALE')]);assert.ok(f.container.textContent.includes('Newest'));assert.ok(!f.container.textContent.includes('STALE'))
 await f.render({tenantId:'other'});assert.ok(!f.container.textContent.includes('Newest'));assert.equal(new URL(f.requests.at(-1).url,'http://localhost').searchParams.get('tenantId'),'other')
 }finally{await f.cleanup()}
})
test('failure/retry stays read-only and scoped accounting/financial signals reload just the worklist',async()=>{
 const f=await setup();try{
 await f.respond(0,[],500);assert.ok(f.container.querySelector('[role="alert"]'))
 const retry=[...f.container.querySelectorAll('button')].find(x=>x.textContent==='Retry promises');await act(async()=>retry.click());assert.equal(f.requests.length,2)
 await f.respond(1,[row('Acme')]);await act(async()=>f.dom.window.dispatchEvent(new f.dom.window.CustomEvent('yuohme:promise-actionability-changed',{detail:'foreign'})));assert.equal(f.requests.length,2)
 await act(async()=>f.dom.window.dispatchEvent(new f.dom.window.CustomEvent('yuohme:promise-actionability-changed',{detail:'tenant'})));assert.equal(f.requests.length,3)
 await f.respond(2,[row('Acme')]);await act(async()=>f.dom.window.dispatchEvent(new f.dom.window.CustomEvent('accounting-updated')));assert.equal(f.requests.length,4)
 assert.ok(f.requests.every(r=>r.url.startsWith('/api/collections/promises?')&&(!r.init.method||r.init.method==='GET')))
 }finally{await f.cleanup()}
})

const commitment=(fields={})=>({...row('Acme'),revision:'3',...fields})
const invoice=(promise=commitment())=>({invoiceSourceId:'invoice',invoiceNumber:'INV-1',currencyCode:'GBP',invoiceState:'open',currentAmountDueNative:'1000',activePromise:promise.status==='active'?promise:null,latestPromise:promise,activePromisedCoverageAmountNative:'375'})
async function open(f,promise=commitment()){
 await f.respond(0,[row('Acme')]);await f.click('Manage promise');assert.equal(f.requests.length,2)
 const url=new URL(f.requests[1].url,'http://localhost');assert.equal(url.pathname,'/api/collections/invoice-disputes');assert.equal(url.searchParams.get('customerSourceId'),'Acme');assert.equal(url.searchParams.get('invoiceSourceId'),'invoice');assert.equal(url.searchParams.get('tenantId'),'tenant')
 await f.body(1,{ok:true,invoices:[invoice(promise)]})
}
test('Manage is in place; authoritative context, reopen cache, filters/page, no initial invoice waterfall',async()=>{
 const f=await setup();try{
 await open(f);assert.equal(f.navigation.length,0);assert.ok(f.container.querySelector('dialog[open]'));await f.click('Close');assert.ok(!f.container.querySelector('dialog'))
 await f.click('Manage promise');assert.equal(f.requests.length,2,'unchanged context reused within bounded TTL');assert.ok(f.container.textContent.includes('Edit promise'))
 assert.ok(f.container.querySelector('a[href*="promisesReturn="]'),'separate deep investigation link remains')
 }finally{await f.cleanup()}
})
test('note-only save refreshes one worklist, no accounting/invoice reload, keeps editor and confirms success',async()=>{
 const f=await setup();try{
 await open(f);await f.click('Edit promise');await f.set('Optional promise note','Updated note');await f.submit()
 const command=JSON.parse(f.requests[2].init.body);assert.equal(command.note,'Updated note');assert.equal(command.expectedRevision,'3');assert.equal('amount' in command,false)
 await f.body(2,{ok:true,promise:commitment({note:'Updated note',revision:'4'})});assert.equal(f.requests.length,4);assert.ok(f.requests[3].url.startsWith('/api/collections/promises?'))
 assert.ok(f.container.querySelector('ol'),'list retained during refresh');await f.respond(3,[{...row('Acme'),note:'Updated note'}]);assert.ok(f.container.querySelector('dialog'));assert.match(f.container.textContent,/Promise note saved/)
 assert.equal(f.requests.length,4)
 }finally{await f.cleanup()}
})
test('financial edit and cancellation use the existing command and exactly one scoped invoice/worklist refresh',async()=>{
 for(const cancel of [false,true]){
 const f=await setup();try{
 await open(f);await f.click(cancel?'Cancel promise':'Edit promise');if(!cancel){await f.set('Promise amount (GBP)','450');await f.set('Promised date','2026-10-20')}
 await f.submit();const command=JSON.parse(f.requests[2].init.body);assert.equal(command.operation,'edit');assert.equal(command.promiseId,'Acme');assert.equal(command.amount,cancel?'':'450')
 const saved=commitment({status:cancel?'cancelled':'active',promisedAmountNative:cancel?'500':'450',promisedDate:'2026-10-20',revision:'4'})
 await f.body(2,{ok:true,promise:saved});assert.equal(f.requests.length,4,'financial signal deduplicated during own mutation');await f.body(3,{ok:true,invoices:[invoice(saved)]})
 assert.equal(f.requests.length,5);await f.respond(4,cancel?[]:[{...row('Acme'),promisedAmountNative:'450'}]);assert.ok(f.container.querySelector('dialog'),'cancelled row removal cannot destroy committed editor');assert.equal(f.requests.length,5)
 assert.match(f.container.textContent,cancel?/Promise cancelled/:/Promise saved/);await f.click('Close');assert.ok(!f.container.querySelector('dialog'))
 }finally{await f.cleanup()}
 }
})
test('uncertain response retains draft and command identity, blocks dismissal until same-details retry',async()=>{
 const f=await setup();try{
 await open(f);await f.click('Edit promise');await f.set('Optional promise note','Retry me');await f.submit();const command=JSON.parse(f.requests[2].init.body)
 await f.body(2,{},500);const close=f.container.querySelector('dialog button[aria-label="Close promise management"]');assert.equal(close.disabled,true);assert.equal(f.container.querySelector('dialog textarea').disabled,true)
 await act(async()=>f.container.querySelector('dialog').dispatchEvent(new f.dom.window.Event('cancel',{cancelable:true})));assert.ok(f.container.querySelector('dialog'))
 await f.submit();assert.deepEqual(JSON.parse(f.requests[3].init.body),command);await f.body(3,{ok:true,promise:commitment({note:'Retry me',revision:'4'})});await f.respond(4,[{...row('Acme'),note:'Retry me'}]);assert.equal(close.disabled,false)
 }finally{await f.cleanup()}
})
test('committed save followed by list failure remains saved and refresh retry never resends the command',async()=>{
 const f=await setup();try{
 await open(f);await f.click('Edit promise');await f.set('Optional promise note','Committed');await f.submit();await f.body(2,{ok:true,promise:commitment({note:'Committed',revision:'4'})});await f.respond(3,[],500)
 assert.match(f.container.textContent,/Promise saved, but the worklist could not be refreshed/);assert.ok(f.container.querySelector('ol'));assert.ok(f.container.querySelector('dialog'));assert.equal(f.requests.filter(x=>x.init.method==='POST').length,1)
 await f.click('Refresh invoice details');await f.body(4,{ok:true,invoices:[invoice(commitment({note:'Committed',revision:'4'}))]});await f.respond(5,[{...row('Acme'),note:'Committed'}]);assert.equal(f.requests.filter(x=>x.init.method==='POST').length,1)
 }finally{await f.cleanup()}
})
test('historical commitment uses authoritative invoice history and is read-only despite another active promise',async()=>{
 const f=await setup();try{
 const historical={...row('Older'),status:'kept'};await f.respond(0,[historical]);await f.click('View promise');await f.body(1,{ok:true,invoices:[invoice()]})
 assert.equal(new URL(f.requests[2].url,'http://localhost').searchParams.get('includeHistory'),'true');await f.body(2,{ok:true,promises:[commitment(),{...historical,revision:'5',note:'Historical terms'}]})
 const dialog=f.container.querySelector('dialog');assert.match(dialog.textContent,/Promise kept/);assert.match(dialog.textContent,/Historical terms/);assert.ok(![...dialog.querySelectorAll('button')].some(x=>/Edit promise|Cancel promise|Record/.test(x.textContent)))
 await f.click('Promise history');await f.body(3,{ok:true,promises:[commitment(),{...historical,revision:'5'}],activePromise:commitment()})
 await f.body(4,{ok:true,invoices:[invoice()]});assert.match(dialog.textContent,/Promise kept/)
 }finally{await f.cleanup()}
})
test('rapidly changing management targets/tenants cancels and rejects stale invoice context',async()=>{
 const f=await setup();try{
 await f.respond(0,[row('Acme'),row('Baker')]);await f.click('Manage promise');await f.click('Close')
 assert.equal(f.requests[1].init.signal.aborted,true)
 await act(async()=>{[...f.container.querySelectorAll('button')].filter(x=>x.textContent==='Manage promise')[1].click()});await f.body(2,{ok:true,invoices:[invoice(commitment({id:'Baker'}))]});await f.body(1,{ok:true,invoices:[invoice()]});assert.equal(f.container.querySelector('dialog h2').textContent,'Baker')
 await f.render({tenantId:'other'});assert.ok(!f.container.querySelector('dialog'));assert.equal(f.requests[2].init.signal.aborted,true)
 }finally{await f.cleanup()}
})
test('revision conflict loads latest context and leaves management open without declaring a failed committed save',async()=>{
 const f=await setup();try{
 await open(f);await f.click('Edit promise');await f.set('Optional promise note','Old draft');await f.submit();await f.body(2,{ok:false,code:'conflict'},409)
 assert.equal(f.requests.length,5);await f.body(3,{ok:true,activePromise:commitment({revision:'8',note:'Latest'}),promises:[commitment({revision:'8',note:'Latest'})]});await f.body(4,{ok:true,invoices:[invoice(commitment({revision:'8',note:'Latest'}))]})
 assert.match(f.container.textContent,/changed.*latest details/);assert.ok(f.container.querySelector('dialog'));await f.click('Edit promise');assert.equal(f.container.querySelector('dialog textarea').value,'Latest')
 }finally{await f.cleanup()}
})
test('background worklist refresh preserves draft and applied page/search; no read is initiated for another row',async()=>{
 const f=await setup();try{
 const filters={...query,q:'Acme',page:2};await f.render({query:filters});await f.respond(1,[row('Acme')]);await f.click('Manage promise');await f.body(2,{ok:true,invoices:[invoice()]});await f.click('Edit promise');await f.set('Optional promise note','Unsaved draft')
 await act(async()=>f.dom.window.dispatchEvent(new f.dom.window.CustomEvent('accounting-updated')));assert.equal(f.requests.length,4);const url=new URL(f.requests[3].url,'http://localhost');assert.equal(url.searchParams.get('q'),'Acme');assert.equal(url.searchParams.get('page'),'2');await f.respond(3,[{...row('Acme'),note:'Externally updated'}]);assert.equal(f.container.querySelector('dialog textarea').value,'Unsaved draft')
 assert.equal(f.requests.filter(x=>x.url.startsWith('/api/collections/invoice-disputes?')).length,1)
 }finally{await f.cleanup()}
})
test('selected invoice context loading failure retries the same scope, never uses incomplete worklist balances',async()=>{
 const f=await setup();try{
 await f.respond(0,[row('Acme')]);await f.click('Manage promise');await f.body(1,{ok:false},503);assert.ok(!f.container.querySelector('dialog form'));assert.match(f.container.querySelector('dialog').textContent,/Could not load current invoice/)
 await f.click('Retry invoice details');assert.equal(f.requests[1].url,f.requests[2].url);await f.body(2,{ok:true,invoices:[invoice()]});assert.ok(f.container.querySelector('dialog').textContent.includes('Edit promise'))
 }finally{await f.cleanup()}
})
