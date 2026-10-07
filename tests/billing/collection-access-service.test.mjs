import assert from 'node:assert/strict'
import test from 'node:test'
import {loadTypeScriptModule} from '../xero/test-helpers/ts-module-loader.mjs'
const now=new Date('2026-10-07T12:00:00Z')
const base=()=>({userId:'u',sourceSystem:'xero',subscription:null,paid:false,
 connection:{tenant_id:'tenant-a',auth_state:'active'},snapshot:{mode:'generation',syncRunId:'g'},
 financialEpoch:'9',projectionRevision:'37',invalidSnapshot:false,
 currencyPopulation:{relevantInvoiceCount:1,invoicedCurrencies:['GBP']},userUsageDays:0,usageDateConsumed:false})
function setup(context=base(),reply){
 const calls=[],admin={rpc:async(name,args)=>{calls.push({name,args});return reply?reply(name,args):{data:name==='claim_billing_usage_day'?[{allowed:true,usage_days_consumed:1,usage_date_already_recorded:false}]:context,error:null}}}
 const api=loadTypeScriptModule('lib/collections/access-context-server.ts')
 return {api,calls,args:{admin,supabase:{},userId:'u',tenantId:'tenant-a',now}}
}
test('free request context never folds usage claim into command transaction',async()=>{
 const s=setup(),r=await s.api.claimCollectionAccess(s.args)
 assert.deepEqual(s.calls.map(c=>c.name),['read_collection_access_context','claim_billing_usage_day'])
 assert.equal(r.entitlement.usageDate,'2026-10-07');assert.equal(r.entitlement.usageDaysConsumed,1)
 assert.equal(r.entitlement.usageDateConsumed,true);assert.equal(r.entitlement.hasActionsAccess,true)
})
test('context scope/transport failures fail closed without claiming a day',async()=>{
 for(const mutate of [c=>({...c,userId:'foreign'}),c=>({...c,sourceSystem:'other'}),c=>({...c,financialEpoch:'NaN'})]){
  const s=setup(mutate(base()));await assert.rejects(s.api.claimCollectionAccess(s.args));assert.equal(s.calls.length,1)
 }
 const s=setup(null,()=>({data:null,error:{code:'XX000'}}));await assert.rejects(s.api.claimCollectionAccess(s.args));assert.equal(s.calls.length,1)
})
test('paid Basic and Pro retain configured currency gates; no free claim for either',async()=>{
 process.env.STRIPE_PRICE_ID_BASIC='basic';process.env.STRIPE_PRICE_ID_PRO='pro'
 try{
  const {resolveCollectionsCurrencyAccess}=loadTypeScriptModule('lib/billing/collections-access.ts')
  for(const plan of ['basic','pro']){
   const c={...base(),paid:true,subscription:{status:'active',stripe_price_id:plan,current_period_end:'2027-01-01'},currencyPopulation:{relevantInvoiceCount:3,invoicedCurrencies:['GBP','USD']}}
   const s=setup(c),r=await s.api.claimCollectionAccess(s.args)
   assert.equal(s.calls.length,1);assert.equal(r.entitlement.paidPlan,plan)
   assert.equal(resolveCollectionsCurrencyAccess({entitlement:r.entitlement,currencyContext:s.api.collectionAccessCurrencyContext(c)}).allowed,plan==='pro')
  }
 }finally{delete process.env.STRIPE_PRICE_ID_BASIC;delete process.env.STRIPE_PRICE_ID_PRO}
})
test('invalid/unavailable currency context is never converted to a zero-valued healthy population',()=>{
 const s=setup();assert.throws(()=>s.api.collectionAccessCurrencyContext({...base(),currencyPopulation:null}))
 assert.throws(()=>s.api.collectionAccessCurrencyContext({...base(),invalidSnapshot:true}))
})
test('a pre-mutation context is not a post-mutation dependency authority',async()=>{
 const s=setup();const a=await s.api.readCollectionAccessDatabaseContext(s.args)
 const newer=setup({...base(),financialEpoch:'10',projectionRevision:'38'})
 const b=await newer.api.readCollectionAccessDatabaseContext(newer.args)
 assert.equal(a.financialEpoch,'9');assert.equal(b.financialEpoch,'10');assert.notEqual(a.projectionRevision,b.projectionRevision)
})
