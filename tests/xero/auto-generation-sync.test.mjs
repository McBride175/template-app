import assert from 'node:assert/strict'
import test from 'node:test'
import {loadTypeScriptModule} from './test-helpers/ts-module-loader.mjs'
for(const [path,trigger] of [['app/api/xero/sync/auto/route.ts','opportunistic'],['app/api/xero/sync/route.ts','manual']])test(`${path} delegates exactly one durable request without a provider response`,async()=>{
 const calls=[]
 const route=loadTypeScriptModule(path,{mocks:{'@/lib/accounting/product-refresh-http':{accountingRefreshPost:async(request,actual)=>{calls.push(actual);return Response.json({ok:true,outcome:'started',jobId:'opaque',phase:'queued'},{status:202})}}}})
 const r=await route.POST(new Request('https://test.example/'+path,{method:'POST'}));assert.equal(r.status,202);assert.deepEqual(calls,[trigger]);assert.equal((await r.json()).phase,'queued')
})
