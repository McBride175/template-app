import assert from 'node:assert/strict'
import test from 'node:test'
import {NextRequest} from 'next/server.js'
import {loadTypeScriptModule} from './test-helpers/ts-module-loader.mjs'
const request=()=>new NextRequest('http://localhost/api/dashboard/bootstrap?tenantId=tenant-a')
function setup({auth=true,schema=false,statusFail=false,onboarding=false}={}){
 let authCalls=0;const calls=[];class Schema extends Error{}
 const {GET}=loadTypeScriptModule('app/api/dashboard/bootstrap/route.ts',{mocks:{
  '@/lib/supabase-server':{createServerSupabaseClient:async()=>({auth:{getUser:async()=>{authCalls++;return {data:{user:auth?{id:'owner'}:null},error:null}}}})},
  '@/lib/supabase-admin':{createSupabaseAdminClient:()=>({})},
  '@/lib/observability/first-value-latency':{recordFirstValueLatency(){}},
  '@/lib/dashboard/bootstrap-server':{DashboardSchemaUnavailable:Schema,readDashboardBootstrap:async p=>{calls.push(p);if(schema)throw new Schema();return {ok:true,status:{tenantId:'tenant-a'},collectionState:'ready',collection:{rows:[]},metrics:{databaseCalls:4,databaseWaitMs:10,applicationMs:1,customersExamined:1000,customersReturned:1,calculationRebuilt:false}}}},
  '@/app/api/xero/status/route':{GET:async()=>{calls.push('status');return new Response(JSON.stringify(statusFail?{error:'failed'}:{connected:true,tenantId:'tenant-a',lastSyncedAt:onboarding?null:'2026-10-01'}),{status:statusFail?500:200})}},
  '@/app/api/collections/actions/route':{GET:async r=>{calls.push('actions');assert.equal(r.nextUrl.searchParams.get('overdueOnly'),'true');return new Response(JSON.stringify({ok:true,rows:[{customer_source_id:'c1',reason:'rich payload'}]}))}},
 }})
 return {GET,calls,authCalls:()=>authCalls}
}
test('bootstrap authenticates once and reports complete consolidated DB count',async()=>{
 const s=setup(),r=await s.GET(request());assert.equal(r.status,200);assert.equal(s.authCalls(),1)
 assert.equal(s.calls[0].userId,'owner');assert.equal(s.calls[0].tenantId,'tenant-a')
 assert.equal(r.headers.get('X-Dashboard-Database-Calls'),'4');assert.equal(r.headers.get('Cache-Control'),'no-store')
})
test('unauthorized bootstrap cannot read service-role context or collection',async()=>{
 const s=setup({auth:false}),r=await s.GET(request());assert.equal(r.status,401);assert.equal(s.calls.length,0)
})
test('explicit schema fallback preserves valid independent collections if status fails and strips rich DTO',async()=>{
 const s=setup({schema:true,statusFail:true}),r=await s.GET(request()),b=await r.json()
 assert.equal(b.collectionState,'ready');assert.equal(b.status,null);assert.equal(b.collection.rows[0].customer_source_id,'c1')
 assert.equal('reason' in b.collection.rows[0],false);assert.deepEqual(s.calls.slice(1),['status','actions'])
 assert.equal(r.headers.get('X-Dashboard-Compatibility'),'schema-or-legacy')
})

test('schema compatibility preserves first-sync onboarding without claiming a usage day through queue GET',async()=>{
 const s=setup({schema:true,onboarding:true}),b=await (await s.GET(request())).json()
 assert.equal(b.collectionState,'onboarding');assert.equal(b.collection,null);assert.deepEqual(s.calls.slice(1),['status'])
})
