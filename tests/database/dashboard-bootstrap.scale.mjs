// Opt-in isolated Docker measurement. Auth uses a local fixture identity, not
// Supabase Auth HTTP. All access/usage/projection queries execute real SQL.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { NextRequest } from 'next/server.js'
import * as db from './test-helpers/dependency-database-fixture.mjs'
import { cert } from './test-helpers/materialization-client.mjs'
import { client,parameters,portfolio } from './test-helpers/portfolio-client.mjs'
import {loadTypeScriptModule} from '../xero/test-helpers/ts-module-loader.mjs'
if(process.env.RUN_SUPABASE_INTEGRATION!=='1')throw new Error('Disposable local opt-in required')
const {readCollectionQueueProjection}=loadTypeScriptModule('lib/collections/fast-queue-projection-server.ts')
const results=[],date=new Date().toISOString().slice(0,10)
function measuredClient(){
 const admin=client(db)
 // Minimal local PostgREST adapter for unchanged customer-list access reads.
 admin.from=table=>{
  assert.match(table,/^[a-z_]+$/);const filters=[],orders=[];let columns='*',limit=null,single=false
  const q={select(c){columns=c;return q},eq(k,v){assert.match(k,/^[a-z_]+$/);filters.push(`${k}=${db.quote(v)}`);return q},
   order(k,{ascending}){orders.push(`${k} ${ascending?'asc':'desc'}`);return q},limit(n){limit=n;return q},maybeSingle(){single=true;return q},
   async then(resolve,reject){try{const at=performance.now();const sql=`select ${columns} from public.${table}${filters.length?' where '+filters.join(' and '):''}${orders.length?' order by '+orders.join(','):''}${limit?' limit '+limit:''}`
    const data=JSON.parse(await db.psqlAsync(`set role service_role; select coalesce(jsonb_agg(t),'[]'::jsonb) from (${sql}) t;`));admin.calls.push({name:'select:'+table,databaseMs:null,waitMs:performance.now()-at,bytes:Buffer.byteLength(JSON.stringify(data))});return resolve({data:single?data[0]??null:data,error:null})}catch(e){return reject(e)}}};return q
 }
 const rpc=admin.rpc;admin.rpc=(name,args)=>{const promise=rpc(name,args);promise.single=()=>promise.then(r=>({...r,data:Array.isArray(r.data)?r.data[0]:r.data}));return promise}
 return admin
}
try{
 db.setup()
 for(const n of [100,1000,10000]){
  db.reset();db.psql("update public.xero_oauth_grants set scopes=array['offline_access','accounting.settings.read','accounting.contacts.read','accounting.invoices.read','accounting.payments.read'];")
  const run=db.ready({invoiceChanges:{due_date:'2026-09-01'}})
    db.psql(`insert into public.canonical_customers
      select (jsonb_populate_record(null::public.canonical_customers,
        to_jsonb(c)||jsonb_build_object('id',gen_random_uuid(),
        'source_id','customer-'||lpad(s::text,5,'0'),'is_customer',true))).*
      from public.canonical_customers c cross join generate_series(1,${n}) s where c.source_id='c1';
      insert into public.canonical_invoices
      select (jsonb_populate_record(null::public.canonical_invoices,
        to_jsonb(i)||jsonb_build_object('id',gen_random_uuid(),
        'source_id','invoice-'||lpad(s::text,5,'0')||'-'||j,
        'customer_source_id','customer-'||lpad(s::text,5,'0'),
        'status',case when j>2 then 'PAID' else 'AUTHORISED' end,
        'issue_date','2026-07-01','due_date','2026-09-01',
        'fully_paid_date',case when j>2 then '2026-09-10' else null end,
        'total_native','100','amount_paid_native',case when j>2 then '100' else '10' end,
        'amount_due_native',case when j>2 then '0' else '90' end,
        'amount_due_base',case when j>2 then '0' else '90' end))).*
      from public.canonical_invoices i cross join generate_series(1,${n}) s
        cross join generate_series(1,5) j where i.source_id='i1';
      insert into public.canonical_payments(user_id,tenant_id,source_system,sync_run_id,
        source_id,customer_source_id,invoice_source_id,payment_date)
      select '${db.user}','tenant-a','xero','${run.run}','payment-'||s,
        'customer-'||lpad(s::text,5,'0'),
        'invoice-'||lpad(s::text,5,'0')||'-1','2026-09-20'
      from generate_series(1,${n}) s;
      delete from public.canonical_invoices where source_id='i1';
      delete from public.canonical_customers where source_id='c1';`)

  cert(db,run.run);const admin=measuredClient();await portfolio.ensurePortfolioBaseCalculation(parameters(db,admin,`${date}T12:00:00Z`))
  let authCalls=0
  const mocks={
   '@/lib/supabase-server':{createServerSupabaseClient:async()=>({...admin,auth:{getUser:async()=>{authCalls++;return {data:{user:{id:db.user}},error:null}}}})},
   '@/lib/supabase-admin':{createSupabaseAdminClient:()=>admin},
   '@/lib/observability/first-value-latency':{recordFirstValueLatency(){}},
  }
  const {GET}=loadTypeScriptModule('app/api/dashboard/bootstrap/route.ts',{mocks})
  async function measureDashboard(name){
   const samples=[]
   for(let repeat=0;repeat<3;repeat++){
    const offset=admin.calls.length,at=performance.now();const response=await GET(new NextRequest('http://localhost/api/dashboard/bootstrap?tenantId=tenant-a'))
    const text=await response.text(),totalMs=performance.now()-at,b=JSON.parse(text),calls=admin.calls.slice(offset)
    assert.equal(response.status,200);assert.equal(b.collectionState,'ready');assert.equal(calls.some(c=>/publish|canonical|materialization/.test(c.name)),false)
    const timing=Object.fromEntries([...response.headers.get('Server-Timing').matchAll(/(\w+);dur=([\d.]+)/g)].map(m=>[m[1],Number(m[2])]))
    samples.push({totalMs,timing,rpcCount:calls.length,databaseExecutionMs:calls.reduce((s,c)=>s+(c.databaseMs??0),0),
     databasePayloadBytes:calls.reduce((s,c)=>s+c.bytes,0),browserBytes:Buffer.byteLength(text),
     rowsReturned:b.collection.rows.length,customersExamined:n,canonicalReads:0,featureRebuilds:0,benchmarkRebuilds:0,scoreRebuilds:0})
   }
   samples.sort((a,b)=>a.totalMs-b.totalMs);return {name,p50:samples[1],samples}
  }
  const free=await measureDashboard('free-warm')
  process.env.STRIPE_PRICE_ID_PRO='price_local_dashboard_pro'
  db.psql(`insert into public.subscriptions(user_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,status,current_period_end,stripe_subscription_created_at) values('${db.user}','cus_local','sub_local','price_local_dashboard_pro','active',now()+interval '1 day',now());`)
  const paid=await measureDashboard('paid-warm')
  const {GET:listGET}=loadTypeScriptModule('app/api/collections/customers/route.ts',{mocks})
  const before=admin.calls.length,at=performance.now();const listResponse=await listGET(new NextRequest('http://localhost/api/collections/customers?tenantId=tenant-a&limit=200'))
  const listText=await listResponse.text(),listTotalMs=performance.now()-at,listCalls=admin.calls.slice(before);assert.equal(listResponse.status,200,listText)
  const list={totalMs:listTotalMs,databaseRequests:listCalls.length,requestNames:listCalls.map(c=>c.name),databasePayloadBytes:listCalls.reduce((s,c)=>s+c.bytes,0),browserBytes:Buffer.byteLength(listText),rowsReturned:JSON.parse(listText).rows.length,canonicalReads:0,featureRebuilds:0}
  const rich=await readCollectionQueueProjection({admin,userId:db.user,tenantId:'tenant-a',evaluationInstant:new Date(),overdueOnly:true,limit:200,legacyTodayDateIso:date})
  const richRowBytes=Buffer.byteLength(JSON.stringify(rich.rows))
  let calculationMiss=null
  if(n===1000){
   db.psql('delete from public.collection_portfolio_calculations;')
   const offset=admin.calls.length,at=performance.now(),r=await GET(new NextRequest('http://localhost/api/dashboard/bootstrap?tenantId=tenant-a'))
   const text=await r.text(),calls=admin.calls.slice(offset);assert.equal(r.status,200);assert.equal(JSON.parse(text).collectionState,'ready')
   assert.equal(calls.some(c=>/canonical|publish_collection_customer/.test(c.name)),false)
   calculationMiss={totalMs:performance.now()-at,rpcCount:calls.length,requestNames:calls.map(c=>c.name),databaseExecutionMs:calls.reduce((s,c)=>s+(c.databaseMs??0),0),databasePayloadBytes:calls.reduce((s,c)=>s+c.bytes,0),browserBytes:Buffer.byteLength(text),canonicalReads:0,featureRebuilds:0,portfolioRebuilds:1}
  }
  const result={customers:n,richRowBytes,calculationMiss,invoices:n*5,free,paid,list,authCalls,authMode:'local fixture; real Supabase Auth/network latency excluded'}
  results.push(result);console.log(JSON.stringify(result));writeFileSync('/tmp/yuohme-phase38/dashboard-scale.json',JSON.stringify(results,null,2))
  delete process.env.STRIPE_PRICE_ID_PRO
 }
}finally{delete process.env.STRIPE_PRICE_ID_PRO;db.cleanup()}
