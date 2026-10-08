import assert from 'node:assert/strict'
import test from 'node:test'
import {NextRequest} from 'next/server.js'
import {loadTypeScriptModule} from './test-helpers/ts-module-loader.mjs'

test('OAuth relink invalidates old token CAS and scopes removal to the returned grant',async()=>{
 const user='00000000-0000-4000-8000-000000000011',grant='00000000-0000-4000-8000-000000000012',calls=[]
 const stored=[{tenant_id:'retained',grant_id:grant},{tenant_id:'removed',grant_id:grant},{tenant_id:'unrelated',grant_id:'other-grant'}]
 const admin={from(table){let op='read',payload=null;const filters={};const query={
   select(){return query},eq(k,v){filters[k]=v;return query},in(k,v){filters[k]=v;return query},
   upsert(v){op='upsert';payload=v;return query},update(v){op='update';payload=v;return query},
   single:async()=>{calls.push({table,op,payload,filters:{...filters}});return {data:{id:grant},error:null}},
   then(resolve){calls.push({table,op,payload,filters:{...filters}});resolve({data:op==='read'?stored.filter(row=>!filters.grant_id||row.grant_id===filters.grant_id):null,error:null})},
 };return query}}
 const api=loadTypeScriptModule('app/api/xero/callback/route.ts',{mocks:{
  '@/lib/supabase-admin':{createSupabaseAdminClient:()=>admin},
  '@/lib/supabase-server':{createServerSupabaseClient:async()=>({auth:{getUser:async()=>({data:{user:{id:user}},error:null})}})},
  '@/lib/xero/secrets':{encryptXeroToken:()=> 'local-fixture-ciphertext'},
  '@/lib/xero/server':{getXeroConfig:()=>({clientId:'fixture',clientSecret:'fixture',redirectUri:'https://fixture.invalid/callback'}),getXeroTokenUrl:()=> 'https://fixture.invalid/token',getXeroConnectionsUrl:()=> 'https://fixture.invalid/connections',safeEqualStrings:(a,b)=>a===b,XERO_STATE_COOKIE_NAME:'state',XERO_STATE_USER_COOKIE_NAME:'state-user',XERO_RETURN_COOKIE_NAME:'return'},
  '@/lib/observability/first-value-latency':{recordFirstValueLatency:()=>{}},
 }})
 const saved=globalThis.fetch;globalThis.fetch=async url=>url.endsWith('/token')?Response.json({access_token:'fixture',refresh_token:'fixture',expires_in:1800,xero_userid:'fixture-provider-user',scope:'offline_access accounting.settings.read accounting.contacts.read accounting.transactions.read'}):Response.json([{tenantId:'retained',tenantName:'Local fixture',tenantType:'ORGANISATION'}])
 try {
  const r=await api.GET(new NextRequest('https://fixture.invalid/api/xero/callback?code=fixture&state=valid',{headers:{cookie:`state=valid; state-user=${user}`}}))
  assert.equal(r.status,307)
  const relink=calls.find(c=>c.table==='xero_oauth_grants'&&c.op==='upsert')
  assert.match(relink.payload.authorization_revision,/^[0-9a-f-]{36}$/);assert.equal(Object.hasOwn(relink.payload,'refresh_lock_id'),false);assert.equal(Object.hasOwn(relink.payload,'refresh_lock_expires_at'),false)
  const removed=calls.find(c=>c.table==='xero_connections_public'&&c.op==='update')
  assert.equal(removed.filters.grant_id,grant);assert.deepEqual(removed.filters.tenant_id,['removed']);assert.equal(removed.payload.auth_state,'disconnected')
 }finally{globalThis.fetch=saved}
})
