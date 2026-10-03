import assert from 'node:assert/strict'
import test, { before, after, beforeEach } from 'node:test'
import { randomUUID } from 'node:crypto'
import * as db from './test-helpers/dependency-database-fixture.mjs'
const enabled = process.env.RUN_SUPABASE_INTEGRATION === '1'
const check = (name, fn) => test(name, { skip: !enabled }, fn)
before(() => { if (enabled) db.setup() })
after(() => { if (enabled) db.cleanup() })
beforeEach(() => { if (enabled) db.reset() })
const versions = (customer = 'c1') => {
  const h = db.head(customer)
  return [h.customerFinancialRevision, h.financialEpoch, h.projectionRevision].map(BigInt)
}
const delta = (before, expected, customer = 'c1') => assert.deepEqual(versions(customer), before.map((v,i) => v + BigInt(expected[i])))
check('sparse absence is zero; publication advances F/P, not customer revision', () => {
  assert.deepEqual(versions(), [0n,0n,0n])
  assert.equal(db.head().generationId,null)
  const run = db.ready()
  assert.equal(db.head().generationId,run.run)
  assert.equal(db.head().generationStatus,'succeeded')
  assert.deepEqual(versions(),[0n,1n,1n])
  assert.equal(db.psql('select count(*) from public.collection_customer_financial_revisions;'),'0')
})
check('dispute amount/resolve/reactivate advance financial versions; notes/review are projection only', () => {
  db.ready(); let before = versions(); const id = db.dispute(); delta(before,[1,1,1])
  for (const sql of ['recorded_disputed_amount_native=3000','is_active=false,resolved_at=now()','is_active=true,resolved_at=null']) {
    before = versions(); db.psql(`update public.invoice_disputes set ${sql} where id='${id}';`); delta(before,[1,1,1])
  }
  for (const sql of ["note='reviewed'",'amount_due_at_last_review_native=8000','amount_due_at_last_review_native=9000']) {
    before = versions(); db.psql(`update public.invoice_disputes set ${sql} where id='${id}';`); delta(before,[0,0,1])
  }
  before = versions(); db.psql(`update public.invoice_disputes set amount_due_at_last_review_native=9000 where id='${id}';`); delta(before,[0,0,0])
})
check('priority and Action History insert/delete invalidate P only; repeats do not churn', () => {
  db.ready(); let before = versions(); db.psql(db.override()); delta(before,[0,0,1])
  before = versions(); db.psql(db.override()); delta(before,[0,0,0])
  before = versions(); db.psql(`delete from public.customer_overrides where user_id='${db.user}';`); delta(before,[0,0,1])
  before = versions(); db.psql(`delete from public.customer_overrides where user_id='${db.user}';`); delta(before,[0,0,0])
  const id = randomUUID(); before = versions(); db.psql(db.action(id)); delta(before,[0,0,1])
  before = versions(); db.psql(`delete from public.collection_actions where id='${id}';`); delta(before,[0,0,1])
  before = versions(); db.psql(`delete from public.collection_actions where id='${id}';`); delta(before,[0,0,0])
})
check('Promise request creation, amount, date, note, cancellation and replay classify atomically', () => {
  db.ready(); let before = versions(); const command = randomUUID(), intent = { operation:'create',invoiceSourceId:'i1',amount:'4000',promisedDate:'2099-12-31' }
  const made = db.promiseRequest(intent,command); delta(before,[1,1,1])
  before = versions(); assert.deepEqual(db.promiseRequest(intent,command),{...made,replayed:true}); delta(before,[0,0,0])
  const id = made.promise.id
  before = versions(); db.promiseRequest({operation:'edit',promiseId:id,amount:'3000'}); delta(before,[1,1,1])
  before = versions(); db.promiseRequest({operation:'edit',promiseId:id,promisedDate:'2099-12-30'}); delta(before,[0,0,1])
  before = versions(); db.promiseRequest({operation:'edit',promiseId:id,note:'reviewed'}); delta(before,[0,0,1])
  before = versions(); db.promiseRequest({operation:'cancel',promiseId:id}); delta(before,[1,1,1])
})
check('dispute caps/full mode and effective no-op writes do not churn F', () => {
  db.ready(); const id = db.dispute('i1',9000); let before = versions()
  db.psql(`update public.invoice_disputes set recorded_disputed_amount_native=10000 where id='${id}';`); delta(before,[0,0,1])
  before = versions(); db.psql(`update public.invoice_disputes set dispute_mode='full' where id='${id}';`); delta(before,[0,0,1])
  before = versions(); db.psql(`update public.invoice_disputes set recorded_disputed_amount_native=10000 where id='${id}';`); delta(before,[0,0,0])
  before = versions(); db.psql(`delete from public.invoice_disputes where id='${id}';`); delta(before,[1,1,1])
})
check('Promise amount changes above the disputed cap affect projection, not financial coverage', () => {
  db.ready(); db.dispute('i1',6000); const {promise} = db.createPromise({amount:'5000'}); const before = versions()
  db.promiseRequest({operation:'edit',promiseId:promise.id,amount:'6000'}); delta(before,[0,0,1])
  const unchanged = versions(); assert.throws(()=>db.promiseRequest({operation:'edit',promiseId:promise.id,note:null})); delta(unchanged,[0,0,0])
})
check('domain/version writes both roll back if either authoritative or metadata write fails', () => {
  db.ready(); const id = db.dispute(); const before = versions()
  assert.throws(()=>db.psql(`begin;update public.invoice_disputes set recorded_disputed_amount_native=3000 where id='${id}';select 1/0;commit;`))
  delta(before,[0,0,0]); assert.equal(db.psql(`select recorded_disputed_amount_native from public.invoice_disputes where id='${id}';`),'2000')
  db.psql(`create function public.dependency_test_failure() returns trigger language plpgsql as $$begin raise exception 'forced_version_failure';end$$;
    create trigger dependency_test_failure before update on public.collection_dependency_heads for each row execute function public.dependency_test_failure();`)
  try { assert.throws(()=>db.psql(`update public.invoice_disputes set recorded_disputed_amount_native=3000 where id='${id}';`),/forced_version_failure/); delta(before,[0,0,0]) }
  finally { db.psql('drop trigger dependency_test_failure on public.collection_dependency_heads;drop function public.dependency_test_failure();') }
  assert.equal(db.psql(`select recorded_disputed_amount_native from public.invoice_disputes where id='${id}';`),'2000')
})
check('bulk disputes invalidate each changed customer and roll back completely on revision conflict', () => {
  db.ready({extraInvoices:[{source_id:'i2',customer_source_id:'c2'}]}); const before = versions()
  const rows = [{invoice_source_id:'i1',amount_due_native:'9000',expected_revision:null},{invoice_source_id:'i2',amount_due_native:'9000',expected_revision:null}]
  db.rpc(`select count(*) from public.apply_invoice_disputes_bulk_full('${db.user}','tenant-a','xero',${db.json(rows)});`)
  delta(before,[1,2,2]); assert.deepEqual(versions('c2'),[1n,3n,3n])
  const unchanged = versions(); rows[0].expected_revision=1; rows[1].expected_revision=999
  assert.throws(()=>db.rpc(`select count(*) from public.apply_invoice_disputes_bulk_full('${db.user}','tenant-a','xero',${db.json(rows)});`),/revision_conflict/)
  delta(unchanged,[0,0,0])
})
check('same-customer and different-customer simultaneous financial writes lose no increments', async () => {
  db.ready({extraInvoices:[{source_id:'i2'},{source_id:'i3',customer_source_id:'c2'}]})
  const insert = invoice => `begin;insert into public.invoice_disputes(user_id,tenant_id,source_system,invoice_source_id,dispute_mode,recorded_disputed_amount_native,amount_due_at_last_review_native)
    values('${db.user}','tenant-a','xero','${invoice}','partial',2000,9000);select pg_sleep(0.1);commit;`
  await Promise.all(['i1','i2','i3'].map(i=>db.psqlAsync(insert(i))))
  assert.deepEqual(versions(),[2n,4n,4n]); assert.deepEqual(versions('c2'),[1n,4n,4n])
})
check('concurrent priority/financial and Action History/priority changes preserve F/P', async () => {
  db.ready(); const id = db.dispute(); let before = versions()
  await Promise.all([db.psqlAsync(db.override()),db.psqlAsync(`update public.invoice_disputes set recorded_disputed_amount_native=3000 where id='${id}';`)])
  delta(before,[1,1,2]); before = versions()
  await Promise.all([db.psqlAsync(db.override('safe')),db.psqlAsync(db.action())]); delta(before,[0,0,2])
})
check('pending preparation and promotion replay preserve dependency authority', () => {
  const first = db.ready(); const run = db.candidate(), before = db.head()
  assert.equal(before.generationId,first.run)
  assert.deepEqual(db.head(),before)
  const result = db.promote(run); assert.equal(result.promoted,true)
  delta([BigInt(before.customerFinancialRevision),BigInt(before.financialEpoch),BigInt(before.projectionRevision)],[0,1,1])
  const current = db.head(); assert.equal(db.promote(run).result_code,'already_promoted'); assert.deepEqual(db.head(),current)
})
check('Promise provenance evaluation during promotion is not a customer financial change', () => {
  const first=db.ready(); const promise={id:db.historicalPromise(first,'2026-10-30')}; const run = db.candidate(), before = versions()
  assert.equal(db.promote(run).promoted,true); delta(before,[0,1,1])
  const row = db.promiseState(promise.id), current = versions()
  assert.equal(db.rpc(`select public.record_invoice_promise_evaluation('${db.user}','tenant-a','${promise.id}',${row.revision},'${run.run}','0',${db.quote(row.evaluated_at)});`),'f')
  delta(current,[0,0,0])
})
check('promotion rollback includes collection versions and Promise state', () => {
  const first = db.ready(); const promise={id:db.historicalPromise(first,'2026-10-30')}; const run = db.candidate(), proposal = db.proposalFor(run), before = db.head(), state = db.promiseState(promise.id)
  db.psql(`create function public.dependency_promotion_failure() returns trigger language plpgsql as $$begin raise exception 'forced_promotion_failure';end$$;
    create trigger dependency_promotion_failure before update on public.invoice_promises for each row execute function public.dependency_promotion_failure();`)
  try { assert.throws(()=>db.promote(run,proposal),/forced_promotion_failure/); assert.deepEqual(db.head(),before); assert.deepEqual(db.promiseState(promise.id),state) }
  finally { db.psql('drop trigger dependency_promotion_failure on public.invoice_promises;drop function public.dependency_promotion_failure();') }
  assert.equal(db.head().generationId,first.run); assert.equal(db.promote(run).promoted,true)
})
check('generation promotion cannot consume a stale Promise proposal after a user mutation', () => {
  db.ready(); const {promise} = db.createPromise(); const run = db.candidate(), proposal = db.proposalFor(run)
  db.promiseRequest({operation:'edit',promiseId:promise.id,amount:'3000'}); const before = db.head()
  assert.equal(db.promote(run,proposal).result_code,'promise_state_changed'); assert.deepEqual(db.head(),before)
  assert.equal(db.promote(run).promoted,true)
})
check('financial mutation waiting for publication reads the committed new generation', async () => {
  db.ready(); const id = db.dispute('i1',10000); const run = db.candidate({invoiceChanges:{total:'20000',total_native:'20000',total_base:'20000',amount_due:'20000',amount_due_native:'20000',amount_due_base:'20000',amount_paid:'0',amount_paid_native:'0',amount_paid_base:'0'}}), proposal = db.proposalFor(run)
  const barrier=await db.holdBarrier()
  const promotion = db.psqlAsync(`begin;set local application_name='dependency-promotion';select 1 from public.xero_sync_tenant_state where user_id='${db.user}' for update;
    select pg_advisory_xact_lock(${barrier.key});set local role service_role;select * from public.promote_xero_sync_run_with_promises('${run.run}','${db.owner}',${run.fence},null,${proposal===null?'null':db.json(proposal)});commit;`)
  let mutation
  try {
    await db.waitForLock('dependency-promotion')
    mutation=db.psqlAsync(`set application_name='dependency-financial';update public.invoice_disputes set recorded_disputed_amount_native=11000 where id='${id}';`)
    await db.waitForLock('dependency-financial')
  } finally {await barrier.release()}
  await Promise.all([promotion,mutation]); assert.equal(db.head().generationId,run.run); assert.deepEqual(versions(),[2n,4n,4n])
})
check('scope identity includes owner, tenant and provider; user erasure cannot resurrect metadata', () => {
  db.ready(); db.dispute(); db.psql(db.override()); assert.deepEqual(versions(),[1n,2n,3n])
  for (const [user,tenant,source] of [[db.other,'tenant-a','xero'],[db.user,'tenant-b','xero'],[db.user,'tenant-a','other']]) {
    const h=db.head('c1',user,tenant,source); assert.equal(h.financialEpoch,'0'); assert.equal(h.projectionRevision,'0'); assert.equal(h.customerFinancialRevision,'0'); assert.equal(h.generationId,null)
  }
  db.psql(`delete from auth.users where id='${db.user}';`)
  assert.equal(db.psql(`select count(*) from public.collection_dependency_heads where user_id='${db.user}';`),'0')
  assert.equal(db.psql(`select count(*) from public.collection_customer_financial_revisions where user_id='${db.user}';`),'0')
})
check('browser roles cannot read/write counters, call reader or advance another owner', () => {
  db.ready()
  for (const role of ['anon','authenticated']) for (const sql of [
    'select * from public.collection_dependency_heads;',
    `select public.read_collection_dependencies('${db.other}','tenant-a','xero','c1');`,
    `select collection_dependency_private.advance_financial('${db.other}','tenant-a','xero',array['c1']);`,
    `insert into public.collection_dependency_heads(user_id,tenant_id,source_system) values('${db.other}','tenant-a','xero');`,
  ]) assert.throws(()=>db.psql(`set role ${role};${sql}`),/permission denied/)
  assert.throws(()=>db.rpc(`update public.collection_dependency_heads set financial_epoch=99;`),/permission denied/)
  assert.throws(()=>db.rpc(`select collection_dependency_private.advance_projection('${db.user}','tenant-a','xero');`),/permission denied/)
  assert.equal(db.psql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='collection_dependency_private' and (p.proconfig is null or not p.proconfig @> array['search_path=pg_catalog'] or pg_get_userbyid(p.proowner)<>'postgres');"),'0')
  assert.equal(db.psql("select count(*) from pg_class where relname in ('collection_dependency_heads','collection_customer_financial_revisions') and not relrowsecurity;"),'0')
})
check('bigint revisions are lossless decimal strings beyond JavaScript safe integer', () => {
  db.ready(); db.psql(`update public.collection_dependency_heads set financial_epoch=9007199254740993,projection_revision=9007199254740993;`)
  db.psql(db.override()); assert.equal(db.head().projectionRevision,'9007199254740994'); assert.equal(db.head().financialEpoch,'9007199254740993')
})
for(const [status,payments,cashRows,options] of [
  ['kept',[db.payment('4000')],[],{start:'2026-09-23T00:00:00Z',end:'2026-09-23T00:01:00Z'}],
  ['missed',[db.payment()],[],{}],['unclear',[db.payment()],[db.cash()],{}],
]) check(`accounting-driven ${status} transition advances only the affected customer plus publication F/P`,()=>{
  const first=db.ready(); const id=db.historicalPromise(first), run=db.candidate({payments,cashRows,...options}), before=versions()
  assert.equal(db.promote(run).promoted,true); assert.equal(db.promiseState(id).status,status); delta(before,[1,2,2])
  const current=versions();assert.equal(db.promote(run).result_code,'already_promoted');delta(current,[0,0,0])
})
check('partial payment evaluation changes active coverage and replay creates no false invalidation',()=>{
  const first=db.ready();const id=db.historicalPromise(first,'2026-10-30'),run=db.candidate({payments:[db.payment()]}),before=versions()
  assert.equal(db.promote(run).promoted,true);delta(before,[1,2,2]);assert.equal(db.promiseState(id).qualifying_paid_amount_native,'1000')
  const saved=db.promiseState(id),current=versions()
  assert.equal(db.rpc(`select public.record_invoice_promise_evaluation('${db.user}','tenant-a','${id}',${saved.revision},'${run.run}','1000',${db.quote(saved.evaluated_at)});`),'f');delta(current,[0,0,0])
})
check('failed reconciliation leaves G/F/P/r and Promise state at the prior valid publication',()=>{
  const first=db.ready();const id=db.historicalPromise(first),run=db.candidate({incomplete:'prepayments'}),before=db.head(),saved=db.promiseState(id)
  const result=db.promote(run);assert.equal(result.promoted,false);assert.equal(result.result_code,'promise_evidence_not_ready')
  assert.deepEqual(db.head(),before);assert.deepEqual(db.promiseState(id),saved)
})
check('candidate credit certification does not invalidate active state; active availability does',()=>{
  db.ready();const run=db.candidate({extraInvoices:[{source_id:'i2',customer_source_id:'c2'}]}),before=db.head()
  // Synthetic certificate written only in this disposable database. The real
  // fenced writer cannot change certificates belonging to a published run.
  db.psql(`insert into public.xero_customer_credit_validations(sync_run_id,user_id,tenant_id,reason_code,credit_notes_started_at,credit_notes_completed_at,
    credit_notes_page_requests,credit_notes_populated_pages,credit_notes_source_count,credit_notes_mapped_count,credit_notes_invalid_count,credit_notes_complete)
    values('${run.run}','${db.user}','tenant-a','credit_notes_incomplete','2026-09-25','2026-09-25',1,0,0,0,0,true);`)
  assert.deepEqual(db.head(),before)
  assert.equal(db.promote(run).promoted,true);let current=versions()
  db.psql(`update public.xero_customer_credit_validations set readiness_state='ready',reason_code='stable_observation',consistency_result='matched',validation_started_at='2026-09-25',validation_completed_at='2026-09-25',validation_fencing_token=${run.fence} where sync_run_id='${run.run}';`)
  delta(current,[1,1,1]);assert.equal(db.head('c2').customerFinancialRevision,'1');current=versions()
  db.psql(`update public.xero_customer_credit_validations set resource_observations='{"display":"changed"}' where sync_run_id='${run.run}';`);delta(current,[0,0,0])
  db.psql(`update public.xero_customer_credit_validations set readiness_state='unavailable',reason_code='evidence_changed_after_validation',consistency_result='changed' where sync_run_id='${run.run}';`);delta(current,[1,1,1]);current=versions()
  db.psql(`update public.xero_customer_credit_validations set readiness_state='unavailable' where sync_run_id='${run.run}';`);delta(current,[0,0,0])
})
check('domain financial classifiers preserve exact decimal clipping, active flags and terminal states',async()=>{
  const {loadTypeScriptModule}=await import('../xero/test-helpers/ts-module-loader.mjs')
  const {deriveInvoiceDispute}=loadTypeScriptModule('lib/collections/invoice-disputes.ts')
  const {deriveInvoicePromise}=loadTypeScriptModule('lib/collections/invoice-promises.ts')
  const comparisons=[]
  for(const due of ['0','1.1234567890123456789','9000.000000000000000001']) for(const active of [true,false]) for(const mode of ['partial','full']) {
    const d={user_id:db.user,tenant_id:'tenant-a',source_system:'xero',invoice_source_id:'i1',is_active:active,dispute_mode:mode,recorded_disputed_amount_native:'2.999999999999999999',amount_due_at_last_review_native:'9000'}
    const invoice={...d,source_id:'i1',customer_source_id:'c1',type:'ACCREC',status:'AUTHORISED',amount_due_native:due,transaction_currency_code:'GBP',organisation_base_currency_code:'GBP',amount_due_base:due,xero_currency_rate:null,currency_conversion_status:'identity'}
    const amount=deriveInvoiceDispute(invoice,d).effectiveDisputedAmountNative
    comparisons.push(`collection_dependency_private.dispute_coverage(${db.json(d)},${due},${due!=='0'})=${amount}`)
    for(const status of ['active','kept','missed','unclear','cancelled']) {
      const p={...d,customer_source_id:'c1',currency_code:'GBP',status,promised_amount_native:'10',qualifying_paid_amount_native:'1.000000000000000001'}
      const eligible=db.psql(`select trim_scale(greatest(${due}-${amount},0))::text;`)
      const result=deriveInvoicePromise(p,eligible)
      const activeFeature=status==='active'&&due!=='0'
      // JSON equality compares PostgreSQL numerics exactly; expected coverage
      // comes from the domain's decimal text without a JS Number conversion.
      comparisons.push(`collection_dependency_private.promise_signature(${db.json(p)},${due},${amount},${due!=='0'})=jsonb_build_array(${activeFeature},${result.activePromisedCoverageAmountNative})`)
    }
  }
  assert.equal(db.psql(`select bool_and(value) from unnest(array[${comparisons.join(',')}]) value;`),'t')
})
check('single-statement dependency reads cannot observe uncommitted mutation versions',async()=>{
  db.ready();const id=db.dispute(),before=db.head()
  const barrier=await db.holdBarrier()
  const mutation=db.psqlAsync(`begin;set local application_name='dependency-mutation';update public.invoice_disputes set recorded_disputed_amount_native=3000 where id='${id}';select pg_advisory_xact_lock(${barrier.key});commit;`)
  try {await db.waitForLock('dependency-mutation');assert.deepEqual(db.head(),before)}
  finally {await barrier.release()}
  await mutation;delta([BigInt(before.customerFinancialRevision),BigInt(before.financialEpoch),BigInt(before.projectionRevision)],[1,1,1])
})
check('local SQL trigger overhead is measured without altering committed domain data',t=>{
  db.ready();const id=db.dispute(),before=db.head(),sql=`update public.invoice_disputes set recorded_disputed_amount_native=3000 where id='${id}'`
  const timings=[]
  for(let n=0;n<5;n++) {
    const result=JSON.parse(db.psql(`begin;explain(analyze,format json) ${sql};rollback;`))[0]
    timings.push({executionMs:result['Execution Time'],dependencyTriggerMs:result.Triggers.find(v=>v['Trigger Name']==='collection_dependency_disputes').Time})
  }
  assert.deepEqual(db.head(),before)
  t.diagnostic(`LOCAL ONLY, small synthetic tenant, five fresh SQL sessions: ${JSON.stringify(timings)}`)
})
check('zero-covered active Promise still invalidates the customer feature active flag',()=>{
  db.ready();db.dispute('i1',9000);let before=versions();const {promise}=db.createPromise();delta(before,[1,1,1])
  before=versions();db.promiseRequest({operation:'edit',promiseId:promise.id,amount:'5000'});delta(before,[0,0,1])
  before=versions();db.promiseRequest({operation:'cancel',promiseId:promise.id});delta(before,[1,1,1])
})
