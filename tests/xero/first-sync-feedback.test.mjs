import assert from 'node:assert/strict'
import test from 'node:test'
import React,{act} from 'react'
import {JSDOM} from 'jsdom'
import {loadTypeScriptModule} from './test-helpers/ts-module-loader.mjs'
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://test.example/dashboard',pretendToBeVisual:true})
for(const key of ['window','document','HTMLElement','Event','CustomEvent'])globalThis[key]=dom.window[key]
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {createRoot}=await import('react-dom/client')
const status=(phase='complete',options={})=>({connection:{provider:'xero',providerOrganisationId:'org',displayName:'Xero',health:'healthy'},accounting:{state:'valid',activeGenerationId:'G1',accountingObservedAt:'2026-10-08T12:00:00Z',derivatives:{state:'ready'},ageSeconds:100,freshness:'fresh'},work:{phase,stage:phase==='preparing'?'derivatives':'accounting',jobId:'job',requestedAt:'2026-10-08T12:00:00Z'},failure:null,...options})
const response=payload=>Response.json({ok:true,...payload})
async function observer(handler,org='org'){
 const calls=[],timers=[],saved={fetch:globalThis.fetch,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout},api=loadTypeScriptModule('app/components/accounting-refresh-client.ts')
 let hook
 globalThis.fetch=async(url,init)=>{calls.push({url,init});return handler(url,init)}
 globalThis.setTimeout=(fn,ms,...args)=>[2000,5000].includes(ms)?(timers.push({fn,ms,cleared:false}),timers.length):saved.setTimeout(fn,ms,...args)
 globalThis.clearTimeout=id=>{if(typeof id==='number'&&timers[id-1])timers[id-1].cleared=true;else saved.clearTimeout(id)}
 const el=document.createElement('div');document.body.append(el);const root=createRoot(el)
 function Observer(){hook=api.useAccountingRefresh(org);return React.createElement('p',{},hook.status?.work.phase??'loading')}
 await act(async()=>root.render(React.createElement(Observer)))
 return {api,calls,timers,el,get hook(){return hook},close:async()=>{await act(async()=>root.unmount());Object.assign(globalThis,saved);el.remove()}}
}
test('concurrent/repeated activity signals share one POST; throttle is organisation scoped',async()=>{
 const old=globalThis.fetch,calls=[],api=loadTypeScriptModule('app/components/accounting-refresh-client.ts');let release
 globalThis.fetch=async(url,init)=>{calls.push({url,init});await new Promise(r=>release=r);return response({outcome:'not_due',phase:'idle',jobId:null})}
 try{const a=api.signalProductAccountingActivity('org','dashboard',100000),b=api.signalProductAccountingActivity('org','customers',100001);assert.equal(calls.length,1);release();assert.equal(await a,await b);assert.equal(await api.signalProductAccountingActivity('org','disputes',129999),null);const c=api.signalProductAccountingActivity('other-org','customers',130000);release();await c;assert.equal(calls.length,2)}finally{globalThis.fetch=old}
})
test('status observation never posts activity or refresh intent',async()=>{const ui=await observer(async()=>response({status:status()}));try{assert.equal(ui.calls.length,1);assert.ok(ui.calls.every(c=>c.url.startsWith('/api/accounting/refresh-status')));assert.equal(ui.timers.length,0)}finally{await ui.close()}})
test('manual POST acknowledges immediately, then status observation starts after two seconds and settles to five',async()=>{
 let phase='complete';const ui=await observer(async(url)=>url.includes('refresh-status')?response({status:status(phase)}):response({outcome:'started',phase:'queued',jobId:'new'}))
 try{await act(async()=>ui.hook.request('manual','account'));assert.equal(ui.hook.status.work.phase,'queued');assert.equal(ui.timers.at(-1).ms,2000);phase='running';await act(async()=>ui.timers.at(-1).fn());assert.equal(ui.hook.status.work.phase,'running');assert.equal(ui.timers.at(-1).ms,5000);phase='complete';await act(async()=>ui.timers.at(-1).fn());assert.equal(ui.hook.status.work.phase,'complete');assert.ok(ui.timers.at(-1).cleared)}finally{await ui.close()}
})
test('five minute observation cap leaves durable work active; visibility return rechecks',async()=>{
 const dateNow=Date.now;let now=100000;Date.now=()=>now
 const ui=await observer(async()=>response({status:status('running')}))
 try{const count=ui.timers.length;now+=300001;await act(async()=>ui.timers.at(-1).fn());assert.equal(ui.timers.length,count);assert.equal(ui.hook.status.work.phase,'running');await act(async()=>document.dispatchEvent(new Event('visibilitychange')));assert.equal(ui.calls.length,3);assert.equal(ui.timers.length,count+1)}finally{Date.now=dateNow;await ui.close()}
})
test('unmount cancels polling and GET observation, not already accepted server work',async()=>{const ui=await observer(async()=>response({status:status('running')}));const signal=ui.calls[0].init.signal;await ui.close();assert.equal(signal.aborted,true);assert.ok(ui.timers.every(t=>t.cleared))})
test('older status response cannot replace a newer generation',async()=>{
 let n=0,older,newer;const ui=await observer(async()=>++n===1?response({status:status()}):n===2?new Promise(r=>older=r):new Promise(r=>newer=r))
 try{await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));document.dispatchEvent(new Event('visibilitychange'))});await act(async()=>newer(response({status:status('complete',{accounting:{...status().accounting,activeGenerationId:'G2'}})})));await act(async()=>older(response({status:status()})));assert.equal(ui.hook.status.accounting.activeGenerationId,'G2')}finally{await ui.close()}
})
test('first-value admission hint never invents successful accounting',()=>{const api=loadTypeScriptModule('lib/xero/first-sync-feedback.ts');assert.equal(api.shouldObserveFirstXeroSync({connected:true,lastSyncedAt:null}),true);assert.equal(api.shouldObserveFirstXeroSync({connected:true,lastSyncedAt:'date'}),false);assert.equal(api.shouldObserveFirstXeroSync({connected:false,lastSyncedAt:null}),false)})
