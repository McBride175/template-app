import assert from 'node:assert/strict'
import test from 'node:test'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'
import {loadTypeScriptModule} from './test-helpers/ts-module-loader.mjs'
const runtime=await import('react/jsx-runtime')
const query={status:'active',date:'all',q:'',page:1,pageSize:25}
async function setup(){
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/promises?tenantId=tenant',pretendToBeVisual:true})
 const keys=['window','document','HTMLElement','Event','CustomEvent','StorageEvent','fetch','IS_REACT_ACT_ENVIRONMENT'],old=Object.fromEntries(keys.map(k=>[k,globalThis[k]]))
 for(const k of keys)if(k in dom.window)globalThis[k]=dom.window[k];globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const requests=[],navigation=[];globalThis.fetch=(url,init)=>new Promise(resolve=>requests.push({url,init,resolve}))
 const Link=({href,children,...props})=>React.createElement('a',{href,...props},children)
 const Client=loadTypeScriptModule('app/promises/PromisesClient.tsx',{mocks:{react:React,'react/jsx-runtime':runtime,'next/link':Link,'next/navigation':{useRouter:()=>({push:href=>navigation.push(href)})}}}).default
 const root=createRoot(dom.window.document.getElementById('root')),container=dom.window.document.getElementById('root')
 const render=async(props={})=>act(async()=>root.render(React.createElement(Client,{tenantId:'tenant',query,...props})))
 const respond=async(index,rows=[],status=200)=>act(async()=>requests[index].resolve(new Response(JSON.stringify({ok:status===200,tenantId:'tenant',query,rows,total:rows.length,pageCount:1,organisationDate:'2026-10-10',timezone:'Europe/London',error:status!==200?'Unavailable':undefined}),{status})))
 await render()
 return {dom,requests,navigation,render,respond,container,cleanup:async()=>{await act(async()=>root.unmount());Object.assign(globalThis,old);dom.window.close()}}
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
