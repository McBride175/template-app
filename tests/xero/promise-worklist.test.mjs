import assert from 'node:assert/strict'
import test from 'node:test'
import { performance } from 'node:perf_hooks'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
const model = loadTypeScriptModule('lib/collections/promise-worklist.ts')
const query = (params = '') => model.parsePromiseWorklist(new URLSearchParams(params))
const owner = { user_id: 'user-a', tenant_id: 'tenant-a', source_system: 'xero' }
function splitFilter(value) {
  const parts=[]; let from=0, depth=0, quote=false, escape=false
  for(let i=0;i<value.length;i++) {const c=value[i];if(escape){escape=false;continue}if(c==='\\'){escape=true;continue}if(c==='"')quote=!quote;if(!quote){if(c==='(')depth++;if(c===')')depth--;if(c===','&&depth===0){parts.push(value.slice(from,i));from=i+1}}}
  return [...parts,value.slice(from)]
}
function fixture(size = 12) {
  const promises=Array.from({length:size},(_,i)=>({...owner,id:`p-${String(i).padStart(6,'0')}`,customer_source_id:`c-${i%4}`,invoice_source_id:`i-${i}`,
    status:'active',promised_date:['2026-10-08','2026-10-10','2026-10-12'][i%3],promised_amount_native:'9999999999999999.99',qualifying_paid_amount_native:i%2?'0':'100.000000000000001',currency_code:i%2?'EUR':'GBP',note:i===0?'Call accounts team':null,
    created_at:'2026-10-01T12:00:00Z',resolved_at:null,payment_baseline:{secret:true}}))
  const tables={invoice_promises:promises,
    canonical_customers:Array.from({length:4},(_,i)=>({...owner,sync_run_id:'current',source_id:`c-${i}`,name:['Acme','Baker','Cedar','Delta'][i]})),
    canonical_invoices:promises.map((p,i)=>({...owner,sync_run_id:'current',source_id:p.invoice_source_id,customer_source_id:p.customer_source_id,invoice_number:`INV-${i}`,transaction_currency_code:p.currency_code,amount_due_native:'4500.99',status:'AUTHORISED'})),
    canonical_organisations:[{...owner,sync_run_id:'current',timezone_iana:'Europe/London',source_timezone:'GMTStandardTime',country_code:'GB'}]}
  const calls=[],context={admin:null,userId:'user-a',tenantId:'tenant-a',snapshot:{userId:'user-a',tenantId:'tenant-a',mode:'generation',syncRunId:'current'}}, fences=[]
  const admin={from(table){const call={table,filters:[],orders:[],range:null,limit:null,columns:null};calls.push(call);const filters=[]
    const read={returns(){return this},select(columns,opts){call.columns=columns;call.count=opts?.count;return this},
      eq(key,value){call.filters.push([key,'eq',value]);filters.push(row=>row[key]===value);return this},
      is(key,value){return this.eq(key,value)},in(key,values){call.filters.push([key,'in',values]);filters.push(row=>values.includes(row[key]));return this},
      lt(key,value){call.filters.push([key,'lt',value]);filters.push(row=>row[key]<value);return this},gt(key,value){call.filters.push([key,'gt',value]);filters.push(row=>row[key]>value);return this},
      ilike(key,pattern){call.filters.push([key,'ilike',pattern]);const needle=pattern.slice(1,-1).replace(/\\(.)/g,'$1').toLowerCase();filters.push(row=>String(row[key]??'').toLowerCase().includes(needle));return this},
      or(expression){call.or=expression;filters.push(row=>splitFilter(expression).some(clause=>{const [,key,op,v]=clause.match(/^([a-z_]+)\.(eq|in)\.(.*)$/);const values=op==='eq'?[JSON.parse(v)]:splitFilter(v.slice(1,-1)).map(x=>JSON.parse(x));return values.includes(row[key])}));return this},
      order(key,options){call.orders.push([key,options?.ascending!==false]);return this},range(from,to){call.range=[from,to];return this},limit(limit){call.limit=limit;return this},
      then(resolve,reject){let rows=tables[table].filter(row=>filters.every(f=>f(row)));const count=rows.length;rows=[...rows].sort((a,b)=>{for(const [key,asc]of call.orders){const diff=String(a[key]??'').localeCompare(String(b[key]??''));if(diff)return asc?diff:-diff}return 0});if(call.range)rows=rows.slice(call.range[0],call.range[1]+1);if(call.limit)rows=rows.slice(0,call.limit);return Promise.resolve({data:rows,error:null,count}).then(resolve,reject)}}
    return read}}
  context.admin=admin
  const mocks={'@/lib/xero/authoritative-snapshot':{applyXeroAuthoritativeSnapshot:(read,snapshot)=>read.eq('sync_run_id',snapshot.syncRunId)},'@/lib/collections/invoice-disputes-server':{authenticateDisputeTenant:async(tenant)=>{if(tenant&&tenant!=='tenant-a')throw Error('forbidden');return context}},
    '@/lib/collections/invoice-promises-loading':{assertInvoicePromiseSnapshotCurrent:async()=>{fences.push(context.snapshot);if(context.stale)throw Error('snapshot changed')}}}
  const server=loadTypeScriptModule('lib/collections/promise-worklist-server.ts',{mocks})
  return {tables,calls,context,fences,server,load:(q=query())=>server.loadPromiseWorklist({tenantId:'tenant-a',query:q,now:new Date('2026-10-10T12:00:00Z')})}
}
test('query validation and history date normalization',()=>{
 assert.deepEqual(query(),{status:'active',date:'all',q:'',page:1,pageSize:25})
 for(const raw of ['status=overdue','date=missed','page=0','pageSize=100','page=-1','q='+encodeURIComponent('\x00')])assert.throws(()=>query(raw))
 assert.equal(query('status=history&date=passed').date,'all')
})
test('organisation calendar categories never alter Active lifecycle, including DST/local day boundary',async()=>{
 const f=fixture(),d=f.server.organisationDateAt
 assert.equal(d('Pacific/Auckland',new Date('2026-10-09T12:30:00Z')),'2026-10-10')
 assert.equal(d('America/Los_Angeles',new Date('2026-10-10T01:00:00Z')),'2026-10-09')
 assert.equal(d('Europe/London',new Date('2026-10-25T00:30:00Z')),'2026-10-25')
 for(const timezone of [null,'Unknown/zone'])assert.equal(d(timezone,new Date()),null)
 const result=await f.load();assert.equal(result.rows[0].dateCategory,'passed');assert.ok(result.rows.every(r=>r.status==='active'))
 assert.equal(model.promiseDateCategory('invalid','2026-10-10'),'unavailable')
})
test('bounded ordered pages, native exact decimals, scoped identity joins and safe DTO',async()=>{
 const f=fixture(100),first=await f.load(query('pageSize=25')),second=await f.load(query('pageSize=25&page=2'))
 assert.equal(first.total,100);assert.equal(first.rows.length,25);assert.equal(first.pageCount,4)
 assert.equal(new Set([...first.rows,...second.rows].map(r=>r.id)).size,50)
 assert.equal(first.rows[0].promisedAmountNative,'9999999999999999.99');assert.equal(first.rows[0].qualifyingPaidAmountNative,'100.000000000000001')
 for(const call of f.calls){assert.ok(call.filters.some(([key,,value])=>key==='user_id'&&value==='user-a'));assert.ok(call.filters.some(([key,,value])=>key==='tenant_id'&&value==='tenant-a'));assert.ok(call.range||call.limit)}
 assert.deepEqual(f.calls.filter(c=>c.table==='invoice_promises')[0].orders,[['promised_date',true],['id',true]])
 for(const key of ['user_id','tenant_id','payment_baseline','creation_sync_run_id','command_fingerprint','revision'])assert.equal(key in first.rows[0],false)
 assert.equal(f.fences.length,2)
})
test('history distinguishes all existing outcomes, no payment inference or writes',async()=>{
 const f=fixture(4);f.tables.invoice_promises.forEach((p,i)=>{p.status=['kept','missed','unclear','cancelled'][i];p.resolved_at='2026-10-09T11:00:00Z'})
 assert.equal((await f.load()).rows.length,0)
 const all=await f.load(query('status=history'));assert.deepEqual(new Set(all.rows.map(r=>r.status)),new Set(['kept','missed','unclear','cancelled']))
 assert.equal((await f.load(query('status=unclear'))).rows[0].status,'unclear');assert.equal(all.rows.find(r=>r.status==='missed').qualifyingPaidAmountNative,'0')
})
test('date filters use the authoritative organisation calendar',async()=>{
 for(const [filter,date]of [['passed','2026-10-08'],['today','2026-10-10'],['upcoming','2026-10-12']]){const f=fixture();const r=await f.load(query(`date=${filter}`));assert.ok(r.rows.every(row=>row.promisedDate===date))}
 const f=fixture();f.tables.canonical_organisations=[];assert.equal((await f.load()).organisationDate,null);await assert.rejects(f.load(query('date=today')),/Organisation date/)
})
test('customer/invoice search is two bounded lookups plus one paginated Promise query',async()=>{
 for(const search of ['Acme','INV-2','i-3','c-1']){const f=fixture();const r=await f.load(query(`q=${search}`));assert.ok(r.rows.length>0);assert.equal(f.calls.length,6);assert.equal(f.calls.filter(c=>c.table==='invoice_promises').length,1);assert.equal(f.calls.filter(c=>c.limit===201).length,2)}
 const f=fixture();f.tables.canonical_customers=Array.from({length:201},(_,i)=>({...owner,sync_run_id:'current',source_id:String(i),name:'Acme '+i}));await assert.rejects(f.load(query('q=Acme')),/specific search/)
})
test('search safely quotes opaque source identity and literal wildcard characters',async()=>{
 const f=fixture();await f.load(query('q='+encodeURIComponent('weird"),status.eq.missed')))
 assert.equal(f.calls.find(c=>c.table==='invoice_promises').or,'customer_source_id.eq."weird\\"),status.eq.missed",invoice_source_id.eq."weird\\"),status.eq.missed"')
 await f.load(query('q='+encodeURIComponent('%_*')));assert.ok(f.calls.some(c=>c.filters.some(([key,op,v])=>key==='name'&&op==='ilike'&&v==='%\\%\\_\\*%')))
})
test('foreign owner/tenant/provider data never enter worklist; wrong requested tenant fails',async()=>{
 const f=fixture();for(const change of [{user_id:'foreign'},{tenant_id:'foreign'},{source_system:'foreign'}])f.tables.invoice_promises.push({...f.tables.invoice_promises[0],...change,id:'private'})
 assert.equal((await f.load()).total,12);await assert.rejects(f.server.loadPromiseWorklist({tenantId:'foreign',query:query()}))
 const p=f.tables.invoice_promises[0];assert.throws(()=>f.server.projectPromiseWorklist([{...p,user_id:'foreign'}],[],[],f.context,'2026-10-10'))
})
test('ownership conflicts, missing current identity, invalid finance and uncertain records are truthful',async()=>{
 const f=fixture(1);f.tables.canonical_invoices[0].customer_source_id='different';f.tables.invoice_promises[0].promised_amount_native=100;f.tables.invoice_promises[0].qualifying_paid_amount_native=null;f.tables.invoice_promises[0].resolved_at='bad'
 const r=(await f.load()).rows[0];assert.equal(r.currentOutstandingNative,null);assert.equal(r.contextUnavailable,true);assert.equal(r.financialUnavailable,true);assert.equal(r.qualifyingPaidAmountNative,null);assert.equal(r.resolvedAt,null)
 f.tables.invoice_promises[0].status='overdue';assert.throws(()=>f.server.projectPromiseWorklist(f.tables.invoice_promises,[],[],f.context,'2026-10-10'),/record unavailable/)
})
test('duplicate operational identities fail closed; duplicate canonical rows provide unavailable labels',async()=>{
 const f=fixture(1);f.tables.invoice_promises.push({...f.tables.invoice_promises[0]});await assert.rejects(f.load(),/record unavailable/)
 const g=fixture(1),p=g.tables.invoice_promises[0],customer=g.tables.canonical_customers[0]
 const result=g.server.projectPromiseWorklist([p],[customer,customer],[],g.context,'2026-10-10');assert.equal(result[0].customerName,null)
})
test('concurrent accounting promotion rejects the read rather than mixing generations',async()=>{const f=fixture();f.context.stale=true;await assert.rejects(f.load(),/snapshot changed/)})
test('empty worklist skips identity hydration',async()=>{const f=fixture(0);const r=await f.load();assert.equal(r.total,0);assert.equal(f.calls.length,2)})
test('read cost stays four bounded table requests at small and larger synthetic sizes',async t=>{
 for(const size of [20,5000]){const f=fixture(size),start=performance.now(),r=await f.load();const duration=performance.now()-start;
 assert.equal(f.calls.length,4);assert.equal(r.rows.length,Math.min(25,size));assert.ok(f.calls.every(c=>c.range||c.limit));t.diagnostic(`${size} stored promises: ${duration.toFixed(2)}ms fake database + projection; ${Buffer.byteLength(JSON.stringify(r))}B response; four bounded reads. Not hosted latency.`)}
})
test('management deep links and validated return context preserve only tenant/filter/invoice identity',()=>{
 const row={customerSourceId:'customer / a',invoiceSourceId:'invoice/a'},returnHref=model.promiseWorklistUrl(query('q=Acme&date=passed&page=2'),'tenant-a')
 const url=new URL(model.promiseCustomerHref(row,'tenant-a',returnHref),'http://localhost');assert.equal(url.hash,'#invoice-invoice%2Fa');assert.equal(url.searchParams.get('customerSourceId'),'customer / a')
 assert.equal(model.promisesReturnHref(url.searchParams.get('promisesReturn'),'tenant-a'),returnHref)
 for(const bad of ['https://evil.test/promises?tenantId=tenant-a','//evil.test/promises','/dashboard?tenantId=tenant-a','/promises?tenantId=foreign','/promises?tenantId=tenant-a&status=missed-broken'])assert.equal(model.promisesReturnHref(bad,'tenant-a'),null)
})
