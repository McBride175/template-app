import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'
const domain = loadTypeScriptModule('lib/accounting/refresh.ts')
const policy = loadTypeScriptModule('lib/accounting/refresh-policy.ts')
const { deriveAccountingRefreshStatus } = loadTypeScriptModule('lib/accounting/refresh-status.ts')
const now = new Date('2026-10-07T12:00:00.000Z')
const atAge = milliseconds => new Date(now.getTime() - milliseconds).toISOString()
const h = 3600000
for (const [age, expected] of [[0,'fresh'],[2*h-1,'fresh'],[2*h,'aging_usable'],[2*h+1,'aging_usable'],
  [6*h-1,'aging_usable'],[6*h,'materially_stale'],[6*h+1,'materially_stale'],[24*h-1,'materially_stale'],
  [24*h,'materially_stale'],[24*h+1,'very_stale'],[7*24*h-1,'very_stale'],[7*24*h,'very_stale'],[7*24*h+1,'extended_stale'],[365*24*h,'extended_stale']]) {
  test(`freshness at ${age}ms is ${expected}`, () => {
    const result = policy.classifyAccountingFreshness({ valid:true,observedAt:atAge(age),now })
    assert.equal(result.band,expected);assert.equal(result.ageSeconds,Math.floor(age/1000))
  })
}
test('missing, invalid, future and unauthoritative accounting fail closed; invalid clock rejects', () => {
  for (const observedAt of [null,'bad',new Date(now.getTime()+1).toISOString()]) assert.equal(policy.classifyAccountingFreshness({valid:true,observedAt,now}).band,'unusable')
  assert.equal(policy.classifyAccountingFreshness({valid:false,observedAt:atAge(0),now}).band,'unusable')
  assert.throws(()=>policy.classifyAccountingFreshness({valid:true,observedAt:atAge(0),now:new Date('bad')}))
})
test('provider-neutral identity accepts synthetic provider but not invalid slugs', () => {
  assert.equal(domain.accountingProvider('fixture_provider'),'fixture_provider')
  for(const value of ['', 'Xero', '__proto__', 'qbo/tenant', null]) assert.throws(()=>domain.accountingProvider(value))
  assert.equal(domain.accountingIdentity('same-external-id'),'same-external-id')
})
test('trigger priority is deterministic; only complete/cancelled are terminal', () => {
  assert.deepEqual(Object.keys(domain.ACCOUNTING_TRIGGER_PRIORITY).sort((a,b)=>domain.ACCOUNTING_TRIGGER_PRIORITY[b]-domain.ACCOUNTING_TRIGGER_PRIORITY[a]),
    ['onboarding','manual','reconnect','internal','opportunistic','scheduled'])
  for(const phase of ['queued','running','preparing','retry_wait','reconnect_required','attention_required']) assert.equal(domain.isTerminalAccountingRefresh(phase),false)
  for(const phase of ['complete','cancelled']) assert.equal(domain.isTerminalAccountingRefresh(phase),true)
  assert.throws(()=>domain.accountingRefreshTrigger('__proto__'))
})
for(const [retryCount,minutes,source] of [[0,5,'local'],[1,15,'local'],[2,60,'local'],[3,360,'probe'],[8,360,'probe']]) {
  test(`candidate failure ${retryCount+1} proposes ${minutes} minute ${source}`, () => {
    const result=policy.planAccountingRetry({failureClass:'transient',retryCount,now,random:()=>0.5})
    assert.equal(result.retryCount,retryCount+1);assert.equal(Date.parse(result.nextEligibleAt)-now.getTime(),minutes*60000);assert.equal(result.source,source)
  })
}
test('jitter is bounded, provider backoff wins and quota without reset is conservative', () => {
  for(const random of [()=>0,()=>1]) {
    const delay=Date.parse(policy.planAccountingRetry({failureClass:'transient',retryCount:0,now,random}).nextEligibleAt)-now.getTime()
    assert.ok(delay>=4.5*60000&&delay<=5.5*60000)
  }
  const providerNotBefore=new Date(now.getTime()+8*h).toISOString()
  const result=policy.planAccountingRetry({failureClass:'rate_limited',retryCount:0,now,providerNotBefore,random:()=>0.5})
  assert.equal(result.nextEligibleAt,providerNotBefore);assert.equal(result.source,'provider')
  assert.equal(Date.parse(policy.planAccountingRetry({failureClass:'quota_limited',retryCount:0,now,random:()=>0.5}).nextEligibleAt)-now.getTime(),6*h)
})
test('permanent failures pause; preparations have a finite separate retry sequence', () => {
  for(const failureClass of ['reconnect_required','deterministic_failure','unknown']) {
    const result=policy.planAccountingRetry({failureClass,retryCount:0,now})
    assert.equal(result.nextEligibleAt,null);assert.equal(result.phase,failureClass==='reconnect_required'?'reconnect_required':'attention_required')
  }
  for(const [retryCount,minutes] of [[0,1],[1,5],[2,15],[3,60]]) assert.equal(Date.parse(policy.planAccountingRetry({failureClass:'preparation_failure',retryCount,now,random:()=>0.5}).nextEligibleAt)-now.getTime(),minutes*60000)
  assert.equal(policy.planAccountingRetry({failureClass:'preparation_failure',retryCount:4,now}).phase,'attention_required')
})
test('retry rejects malformed policy input', () => {
  for(const changes of [{retryCount:-1},{retryCount:0.5},{failureClass:'invalid'},{random:()=>NaN},{providerNotBefore:'bad'},{now:new Date('bad')}]) assert.throws(()=>policy.planAccountingRetry({failureClass:'transient',retryCount:0,now,...changes}))
})
test('activity/cadence exclude polling and auth sign-in; dormant policy can defer', () => {
  for(const kind of ['dashboard','queue','customer','collection_action']) assert.equal(policy.isMeaningfulAccountingActivity(kind),true)
  for(const kind of ['status','scheduled','provider_callback','health_check','background_refresh','login']) assert.equal(policy.isMeaningfulAccountingActivity(kind),false)
  assert.equal(policy.accountingRefreshCadence({lastProductActivityAt:atAge(7*24*h),now}).intervalSeconds,3600)
  assert.equal(policy.accountingRefreshCadence({lastProductActivityAt:atAge(7*24*h+1),now}).intervalSeconds,86400)
  assert.equal(policy.accountingRefreshCadence({lastProductActivityAt:null,now,dormantIntervalHours:null}).intervalSeconds,null)
  assert.equal(policy.accountingRefreshCadence({lastProductActivityAt:null,now}).intervalSeconds,86400)
  assert.throws(()=>policy.accountingRefreshCadence({lastProductActivityAt:'bad',now}))
})
const connection={connectionId:'00000000-0000-4000-8000-000000000001',ownerId:'00000000-0000-4000-8000-000000000002',provider:'fixture_provider',providerOrganisationId:'same-id',epoch:'1'}
const authority={state:'valid',mode:'generation',activeGenerationId:'g',lastSuccessfulRefreshAt:now.toISOString(),accountingObservedAt:atAge(8*h),derivatives:{state:'preparing',generationId:'g',financialEpoch:'5',evaluationDate:'2026-10-07'}}
test('status cannot equate job completion or promotion time with fresh accounting/ready derivatives', () => {
  const status=deriveAccountingRefreshStatus({connection,health:'reconnect_required',authority,now,job:{id:'j',connection,phase:'complete',trigger:'manual',attemptNumber:1,retryCount:0,
    requestedAt:now.toISOString(),claimedAt:now.toISOString(),heartbeatAt:now.toISOString(),completedAt:now.toISOString(),workerId:'sensitive-worker',deliveryId:'sensitive-delivery'}})
  assert.equal(status.accounting.freshness,'materially_stale');assert.equal(status.accounting.derivatives.state,'preparing')
  assert.equal(status.connection.provider,'fixture_provider');assert.equal(status.connection.health,'reconnect_required')
  assert.doesNotMatch(JSON.stringify(status),/sensitive|workerId|deliveryId|ownerId|connectionId/)
})
test('status idle/failure is computed and failure codes are sanitized', () => {
  assert.equal(deriveAccountingRefreshStatus({connection,health:'healthy',authority,now,job:null}).work.phase,'idle')
  const status=deriveAccountingRefreshStatus({connection,health:'healthy',authority,now,job:{id:'j',connection,phase:'retry_wait',failureClass:'transient',failureCode:'secret raw token error',failedAt:now.toISOString(),nextEligibleAt:'2026-10-08',attemptNumber:1,retryCount:1}})
  assert.equal(status.failure.code,'unknown_failure');assert.equal(status.failure.nextRetryAt,'2026-10-08')
  assert.throws(()=>deriveAccountingRefreshStatus({connection,health:'healthy',authority,now,job:{connection:{...connection,ownerId:'other'}}}))
})
