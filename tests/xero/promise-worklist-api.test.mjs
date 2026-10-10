import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
function api({ user = {id:'owner'}, entitlement={tenantId:'tenant',hasActionsAccess:true}, currency=true }={}) {
 const calls=[]
 const mocks={
  'next/server':{NextResponse:{json:(body,options={})=>new Response(JSON.stringify(body),options)}},
  '@/lib/supabase-server':{createServerSupabaseClient:async()=>({auth:{getUser:async()=>{calls.push('getUser');return{data:{user},error:null}}}})},
  '@/lib/supabase-admin':{createSupabaseAdminClient:()=>({from:table=>{calls.push(table);const read={select(){return this},eq(){return this},is(){return this},limit(){return this},range(){return this},order(){return this},then(resolve){return Promise.resolve({data:[],count:0,error:null}).then(resolve)}};return read}})},
  '@/lib/collections/access-context-server':{claimCollectionAccess:async({userId,tenantId})=>{calls.push(['access',userId,tenantId]);return {context:null,entitlement}}},
  '@/lib/billing/collections-access':{resolveCollectionsCurrencyAccess:()=>({allowed:currency})},
  '@/lib/collections/currency-context-server':{loadCollectionsCurrencyContext:async()=>({})},
  '@/lib/xero/authoritative-snapshot':{resolveXeroAuthoritativeSnapshot:async()=>({mode:'legacy',syncRunId:null}),applyXeroAuthoritativeSnapshot:read=>read.is('sync_run_id',null)},
  '@/lib/collections/invoice-promises-loading':{assertInvoicePromiseSnapshotCurrent:async()=>{calls.push('fence')}},
 }
 const route=loadTypeScriptModule('app/api/collections/promises/route.ts',{mocks})
 return {calls,get:(params='tenantId=tenant')=>route.GET({nextUrl:new URL('http://localhost/api/collections/promises?'+params)})}
}
test('signed-out request stops before service reads or access claims',async()=>{const f=api({user:null}),r=await f.get();assert.equal(r.status,401);assert.deepEqual(f.calls,['getUser'])})
for(const [label,options]of [['wrong tenant',{entitlement:{tenantId:'other',hasActionsAccess:true}}],['no entitlement',{entitlement:{tenantId:'tenant',hasActionsAccess:false}}],['restricted currency',{currency:false}]])test(label+' cannot read operational promises',async()=>{const f=api(options),r=await f.get();assert.equal(r.status,403);assert.ok(!f.calls.includes('invoice_promises'))})
test('missing tenant resolves an owned tenant; blank/malformed tenant is rejected',async()=>{
 const f=api();assert.equal((await f.get('')).status,200);assert.ok(f.calls.some(c=>Array.isArray(c)&&c[2]===null))
 for(const input of ['tenantId=','tenantId='+encodeURIComponent('a'.repeat(501))])assert.equal((await api().get(input)).status,400)
})
test('safe empty DTO, private no-store response and no lifecycle/refresh/scorer writes',async()=>{
 const f=api(),r=await f.get();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store')
 const body=await r.json();assert.equal(body.tenantId,'tenant');assert.equal(body.organisationDate,null);assert.deepEqual(body.rows,[])
 assert.deepEqual(f.calls,['getUser',['access','owner','tenant'],'canonical_organisations','invoice_promises','fence'])
})
test('invalid filters fail explicitly',async()=>{const r=await api().get('tenantId=tenant&status=overdue');assert.equal(r.status,400)})
