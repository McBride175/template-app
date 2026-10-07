import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {loadTypeScriptModule} from '../xero/test-helpers/ts-module-loader.mjs'
const boundary=loadTypeScriptModule('lib/auth-api-boundary.ts')
const response=()=>({cookies:{getAll:()=>[],set(){}},headers:new Headers()})
test('only the exact audited API paths bypass proxy Auth; pages and unknown APIs retain it',async()=>{
 let calls=0
 const {proxy}=loadTypeScriptModule('proxy.ts',{mocks:{
  '@supabase/ssr':{createServerClient:()=>({auth:{getUser:async()=>{calls++;return{data:{user:{id:'u'}}}}}})},
  'next/server':{NextResponse:{next:response,redirect:response}},
 }})
 const request=path=>({nextUrl:new URL('https://preview.example'+path),url:'https://preview.example'+path,headers:new Headers(),cookies:{getAll:()=>[],set(){}}})
 for(const path of boundary.ROUTE_AUTHENTICATED_API_PATHS){await proxy(request(path));assert.equal(calls,0)}
 for(const path of ['/customers','/account','/login','/api/collections/actions-extra','/api/unreviewed','/api/collections/actions/nested'])await proxy(request(path))
 assert.equal(calls,6)
})
test('all audited APIs still deny unauthenticated valid read/mutation requests at the route boundary',async()=>{
 let auth=0,admin=0
 for(const path of boundary.ROUTE_AUTHENTICATED_API_PATHS){
  const route=loadTypeScriptModule('app'+path+'/route.ts',{mocks:{
   '@/lib/supabase-server':{createServerSupabaseClient:async()=>({auth:{getUser:async()=>{auth++;return{data:{user:null},error:null}}}})},
   '@/lib/supabase-admin':{createSupabaseAdminClient:()=>{admin++;throw Error('must not create admin before Auth')}},
   'next/server':{NextResponse:{json:(body,init)=>({body,status:init?.status??200})}},
  }})
  const request={nextUrl:new URL('https://preview.example'+path+'?view=history&limit=25&tenantId=tenant-a&sourceSystem=xero&customerSourceId=00000000-0000-4000-8000-000000000001&invoiceSourceId=i1'),json:async()=>({tenant_id:'tenant-a',customer_source_id:'c1',override_level:'priority'})}
  const result=await (path.endsWith('/override')?route.POST(request):route.GET(request))
  assert.equal(result.status,401,path)
 }
 assert.equal(auth,8);assert.equal(admin,0)
})
test('route SSR cookie adapter writes refresh/rotation/clear cookies; API bypass does not own the session',async()=>{
 const writes=[]
 const {createServerSupabaseClient}=loadTypeScriptModule('lib/supabase-server.ts',{mocks:{
  'next/headers':{cookies:async()=>({getAll:()=>[],set:(...args)=>writes.push(args)})},
  '@supabase/ssr':{createServerClient:(_url,_key,options)=>({auth:{getUser:async()=>{
   options.cookies.setAll([{name:'sb-test-auth-token',value:'rotated',options:{httpOnly:true,sameSite:'lax'}}])
   return {data:{user:{id:'verified-user'}},error:null}
  }}})},
 }})
 const s=await createServerSupabaseClient();assert.equal((await s.auth.getUser()).data.user.id,'verified-user')
 assert.equal(writes[0][0],'sb-test-auth-token');assert.equal(writes[0][1],'rotated')
 assert.equal(writes[0][2].sameSite,'lax')
 const source=readFileSync(new URL('../../proxy.ts',import.meta.url),'utf8')
 assert.match(source,/if \(usesRouteAuthentication\(request.nextUrl.pathname\)\) return response/)
})

test('installed Supabase SSR refreshes an expired API session and persists rotated cookies without proxy Auth',async()=>{
 const {createServerClient}=await import('@supabase/ssr')
 const jwt=exp=>[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({exp,sub:'00000000-0000-4000-8000-000000000001',aud:'authenticated'})).toString('base64url'),'test-signature'].join('.')
 const user={id:'00000000-0000-4000-8000-000000000001',aud:'authenticated',role:'authenticated',email:'session@example.test'}
 const fresh=jwt(Math.floor(Date.now()/1000)+3600)
 const old={access_token:jwt(1),refresh_token:'fixture-old-refresh',expires_at:1,expires_in:3600,token_type:'bearer',user}
 const values=new Map([['sb-test-auth-token','base64-'+Buffer.from(JSON.stringify(old)).toString('base64url')]])
 const calls=[],writes=[],original=globalThis.fetch
 const oldUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,oldKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='fixture-key'
 globalThis.fetch=async(input,init)=>{
  const url=String(input);calls.push(url)
  if(url.includes('/token?grant_type=refresh_token')){
   assert.equal(JSON.parse(init.body).refresh_token,'fixture-old-refresh')
   return new Response(JSON.stringify({access_token:fresh,refresh_token:'fixture-new-refresh',expires_in:3600,token_type:'bearer',user}),{status:200,headers:{'content-type':'application/json'}})
  }
  assert.ok(url.endsWith('/auth/v1/user'));return new Response(JSON.stringify(user),{status:200,headers:{'content-type':'application/json'}})
 }
 try{
  const {createServerSupabaseClient}=loadTypeScriptModule('lib/supabase-server.ts',{mocks:{
   '@supabase/ssr':{createServerClient},
   'next/headers':{cookies:async()=>({getAll:()=>[...values].map(([name,value])=>({name,value})),set:(name,value,options)=>{values.set(name,value);writes.push({name,value,options})}})},
  }})
  const r=await (await createServerSupabaseClient()).auth.getUser()
  assert.equal(r.error,null);assert.equal(r.data.user.id,user.id)
  assert.equal(calls.filter(url=>url.includes('/token?')).length,1);assert.equal(calls.filter(url=>url.endsWith('/user')).length,1)
  assert.ok(writes.some(cookie=>cookie.name.startsWith('sb-test-auth-token')&&cookie.value!==values.get('old')))
  assert.ok([...values.values()].some(value=>value.includes('base64-')))
 }finally{globalThis.fetch=original;if(oldUrl===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY=oldKey}
})
