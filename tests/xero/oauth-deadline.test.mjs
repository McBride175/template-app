import assert from 'node:assert/strict'
import test from 'node:test'
import {loadTypeScriptModule} from './test-helpers/ts-module-loader.mjs'
const {refreshXeroAccessToken}=loadTypeScriptModule('lib/xero/accounting.ts',{mocks:{'@/lib/xero/server':{getXeroConfig:()=>({clientId:'fixture',clientSecret:'fixture'}),getXeroTokenUrl:()=> 'https://fixture.invalid/token'}}})
async function withFetch(fetcher,fn){const saved=globalThis.fetch;globalThis.fetch=fetcher;try{return await fn()}finally{globalThis.fetch=saved}}
const hangs=async(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}))
test('OAuth refresh has a bounded timeout including response body',async()=>{
 await withFetch(hangs,()=>assert.rejects(refreshXeroAccessToken('fixture',{timeoutMs:15}),e=>e.name==='AbortError'))
 await withFetch(async(url,opts)=>({ok:true,json:()=>hangs(url,opts)}),()=>assert.rejects(refreshXeroAccessToken('fixture',{timeoutMs:15}),e=>e.name==='AbortError'))
})
test('OAuth observes remaining worker deadline and external authority cancellation',async()=>{
 await withFetch(hangs,()=>assert.rejects(refreshXeroAccessToken('fixture',{timeoutMs:10000,deadlineAtMs:Date.now()+15}),e=>e.name==='AbortError'))
 const abort=new AbortController();const pending=withFetch(hangs,()=>refreshXeroAccessToken('fixture',{signal:abort.signal,timeoutMs:10000}));abort.abort();await assert.rejects(pending,e=>e.name==='AbortError')
})
test('already expired/cancelled OAuth request performs no provider call',async()=>{
 let calls=0;await withFetch(async()=>{calls++},async()=>{const abort=new AbortController();abort.abort();await assert.rejects(refreshXeroAccessToken('fixture',{signal:abort.signal}));await assert.rejects(refreshXeroAccessToken('fixture',{deadlineAtMs:Date.now()-1}))});assert.equal(calls,0)
})
test('successful bounded OAuth response preserves rotated token/scopes contract',async()=>{
 await withFetch(async()=>Response.json({access_token:'fixture-access',refresh_token:'fixture-rotation',expires_in:1800,scope:'offline_access accounting.transactions.read'}),async()=>{const r=await refreshXeroAccessToken('fixture',{timeoutMs:100});assert.equal(r.refreshToken,'fixture-rotation');assert.ok(r.scopes.includes('offline_access'));assert.ok(Date.parse(r.expiresAt)>Date.now())})
})
