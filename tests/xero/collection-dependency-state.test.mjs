import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
const {readCollectionDependencyState:read} = loadTypeScriptModule('lib/collections/dependency-state-server.ts')
const scope={userId:'00000000-0000-4000-8000-000000003201',tenantId:'tenant-a',sourceSystem:'xero'}
const response={...scope,generationId:null,generationStatus:null,financialEpoch:'0',projectionRevision:'0',customerFinancialRevision:'0',customerSourceId:'c1'}
function fixture(overrides={}, error=null) {
  const calls=[]; return {calls,admin:{rpc:async(...args)=>{calls.push(args);return {data:{...response,...overrides},error}}}}
}
test('reader obtains scoped G/F/P/r in exactly one RPC; absence is explicitly legacy',async()=>{
  const f=fixture(), result=await read({...scope,customerSourceId:'c1',admin:f.admin})
  assert.deepEqual(result,{...scope,accounting:{mode:'legacy',generationId:null},financialEpoch:'0',projectionRevision:'0',customer:{sourceId:'c1',financialRevision:'0'}})
  assert.deepEqual(f.calls,[['read_collection_dependencies',{p_user_id:scope.userId,p_tenant_id:'tenant-a',p_source_system:'xero',p_customer_source_id:'c1'}]])
})
test('reader retains exact bigint precision and verifies published generation',async()=>{
  const id='00000000-0000-4000-8000-000000003205',f=fixture({generationId:id,generationStatus:'succeeded',financialEpoch:'9007199254740993',projectionRevision:'9223372036854775807'})
  const result=await read({...scope,customerSourceId:'c1',admin:f.admin});assert.equal(result.financialEpoch,'9007199254740993');assert.deepEqual(result.accounting,{mode:'generation',generationId:id})
})
test('tenant-only read has no fabricated customer identity',async()=>{
  const f=fixture({customerFinancialRevision:null,customerSourceId:null})
  assert.equal((await read({...scope,admin:f.admin})).customer,null)
})
for(const [key,value] of [['userId','other'],['tenantId','other'],['sourceSystem','other'],['customerSourceId','other'],['generationId','invalid'],['generationId',undefined],['generationStatus','running']]) {
  test(`reader fails closed for mismatched ${key}`,async()=>{const f=fixture({[key]:value});await assert.rejects(read({...scope,customerSourceId:'c1',admin:f.admin}))})
}
for(const value of [0,-1,'-1','1.0','01',null,undefined,'9223372036854775808']) {
  test(`reader rejects noncanonical/unsafe revision ${String(value)}`,async()=>{const f=fixture({financialEpoch:value});await assert.rejects(read({...scope,customerSourceId:'c1',admin:f.admin}),/revision/)})
}
test('missing migration/RPC remains an error rather than a false zero revision',async()=>{
  const f=fixture({}, {message:'function not found'});await assert.rejects(read({...scope,admin:f.admin}),/function not found/)
})
test('invalid scope is rejected without a database request',async()=>{
  const f=fixture();await assert.rejects(read({...scope,tenantId:' ',admin:f.admin}));assert.equal(f.calls.length,0)
})
test('dependency reader is not activated in current queue or customer hot paths',()=>{
  for(const file of ['app/api/collections/actions/route.ts','lib/collections/customer-summary.ts','app/api/collections/customers/route.ts']) {
    assert.doesNotMatch(readFileSync(file,'utf8'),/readCollectionDependencyState|read_collection_dependencies/)
  }
})
