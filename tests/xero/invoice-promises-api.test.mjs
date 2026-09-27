import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
function route(overrides={}) {
 class OperationError extends Error { constructor(code) { super(code);this.code=code } }
 const calls=[]
 const loaded=loadTypeScriptModule('app/api/collections/invoice-promises/route.ts',{mocks:{
  'next/server':{NextResponse:{json:(data,options={})=>({data,status:options.status??200})}},
  '@/lib/collections/invoice-promises-server':{
   InvoicePromiseOperationError:OperationError,
   mutateInvoicePromise:async body=>{calls.push(body);if(overrides.error)throw new OperationError(overrides.error);return {promise:{id:'owned'},events:[],invoice:null}},
   readInvoicePromiseContext:async params=>{calls.push(params);return {activePromise:null,promises:[]}},
   readInvoicePromiseHistory:async params=>{calls.push(params);return []},
  },
 }})
 return {...loaded,calls}
}
test('POST delegates to authenticated server and returns only deliberate DTO response',async()=>{
 const handler=route(),body={operation:'create',tenantId:'tenant-a',amount:'4000'}
 const response=await handler.POST({json:async()=>body});assert.equal(response.status,200);assert.equal(response.data.ok,true);assert.deepEqual(handler.calls,[body])
})
test('malformed HTTP JSON is rejected without a server write',async()=>{
 const handler=route();assert.equal((await handler.POST({json:async()=>{throw Error('bad')}})).status,400);assert.equal(handler.calls.length,0)
})
for(const [code,status] of [['unauthorized',401],['forbidden',403],['not_found',404],['invalid_input',400],['conflict',409],['temporarily_unavailable',503]])test(`HTTP ${code} is explicit and does not leak persistence error`,async()=>{
 const result=await route({error:code}).POST({json:async()=>({})});assert.equal(result.status,status);assert.equal(result.data.code,code)
})
test('GET bounded invoice and history reads are distinct and reject ambiguous identities',async()=>{
 const handler=route(),req=url=>({nextUrl:new URL(url,'https://example.test')})
 assert.equal((await handler.GET(req('/?tenantId=t&invoiceSourceId=i&includeHistory=true'))).status,200)
 assert.deepEqual(handler.calls[0],{tenantId:'t',invoiceSourceId:'i',includeHistory:true})
 assert.equal((await handler.GET(req('/?tenantId=t&promiseId=p'))).status,200)
 assert.deepEqual(handler.calls[1],{tenantId:'t',promiseId:'p'})
 for(const url of ['/?invoiceSourceId=i','/?tenantId=t','/?tenantId=t&invoiceSourceId=i&promiseId=p'])assert.equal((await handler.GET(req(url))).status,400)
 assert.equal(handler.calls.length,2)
})
