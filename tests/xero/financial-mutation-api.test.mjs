import assert from 'node:assert/strict'
import test from 'node:test'
import {loadTypeScriptModule} from './test-helpers/ts-module-loader.mjs'
const json=(data,init={})=>({data,status:init.status??200}),context={admin:{},userId:'owned-user',tenantId:'owned-tenant'}
for(const domain of ['promise','dispute'])test(`${domain} post-commit continuation returns verified detail without accepting caller customer identity`,async()=>{
 const calls=[],saved={id:'command-result',revision:'7'},ready={reconciliationReady:true,detail:{invoices:[]}}
 let error=false
 const complete=async(ctx,customer)=>{calls.push({ctx,customer});if(error)throw Error('unavailable');return ready}
 const mocks={'next/server':{NextResponse:{json}},'@/lib/collections/financial-mutation-reconciliation-server':{reconcileCollectionFinancialMutation:async args=>complete(context,args.customerSourceId)}}
 if(domain==='promise')mocks['@/lib/collections/invoice-promises-server']={InvoicePromiseOperationError:Error,mutateInvoicePromise:async(body,after)=>{calls.push(body);try{await after(context,'authoritative-customer')}catch{};return{promise:saved,replayed:true}}}
 else mocks['@/lib/collections/invoice-disputes-server']={InvoiceDisputeOperationError:Error,setPartialInvoiceDispute:async({afterCommit,...body})=>{calls.push(body);try{await afterCommit(context,'authoritative-customer')}catch{};return saved}}
 const route=loadTypeScriptModule(`app/api/collections/invoice-${domain==='promise'?'promises':'disputes'}/route.ts`,{mocks})
 const body={tenantId:'owned-tenant',operation:domain==='promise'?'edit':'partial',invoiceSourceId:'i1',disputedAmountNative:'20',reconcile:true,customerSourceId:'caller-customer'}
 const r=await route.POST({json:async()=>body});assert.equal(r.status,200);assert.equal(r.data.committed,true);assert.deepEqual(r.data.reconciliation,ready)
 assert.equal(calls.at(-1).customer,'authoritative-customer')
 error=true;const failed=await route.POST({json:async()=>body});assert.equal(failed.status,200);assert.equal(failed.data.committed,true);assert.equal(failed.data.reconciliation.reconciliationReady,false)
})
test('recovery uses existing exact tenant access boundary and never issues a mutation',async()=>{
 const calls=[],route=loadTypeScriptModule('app/api/collections/financial-reconciliation/route.ts',{mocks:{
  'next/server':{NextResponse:{json}},
  '@/lib/collections/invoice-disputes-server':{InvoiceDisputeOperationError:Error,authenticateDisputeTenant:async tenant=>{calls.push(['auth',tenant]);return context}},
  '@/lib/collections/financial-mutation-reconciliation-server':{reconcileCollectionFinancialMutation:async args=>{calls.push(['recover',args.customerSourceId]);return{reconciliationReady:true}}},
 }})
 assert.equal((await route.GET({nextUrl:new URL('https://test/api?tenantId=owned-tenant&customerSourceId=c1')})).status,200)
 assert.deepEqual(calls,[['auth','owned-tenant'],['recover','c1']]);assert.equal((await route.GET({nextUrl:new URL('https://test/api')})).status,400)
})
