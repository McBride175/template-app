import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import test, { before, after, beforeEach } from 'node:test'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'
const { preparePromiseReconciliation } = loadTypeScriptModule('lib/xero/promise-reconciliation.ts')
const enabled = process.env.RUN_SUPABASE_INTEGRATION === '1'
const container = 'supabase_db_template-app'
const database = `promise_phase6_${randomUUID().replaceAll('-', '')}`
const user = '00000000-0000-4000-8000-000000005b01'
const other = '00000000-0000-4000-8000-000000005b02'
const owner = '00000000-0000-4000-8000-000000005b03'
const grant = '00000000-0000-4000-8000-000000005b04'
const previous = '00000000-0000-4000-8000-000000005b05'
let created = false
const quote = value => `'${String(value).replaceAll("'", "''")}'`
const json = value => `${quote(JSON.stringify(value))}::jsonb`
const dockerArgs = ['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database, '-At']
function psql(sql) { return execFileSync('docker', dockerArgs, { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
function psqlAsync(sql) { return new Promise((resolve, reject) => {
  const child = spawn('docker', dockerArgs); let out = '', err = ''
  child.stdout.on('data', chunk => { out += chunk }); child.stderr.on('data', chunk => { err += chunk })
  child.on('error', reject); child.on('close', code => code ? reject(new Error(err)) : resolve(out.trim())); child.stdin.end(sql)
}) }
function rpc(sql) { return psql(`set role service_role;${sql}`) }
before(() => {
  if (!enabled) return
  execFileSync('docker', ['exec', container, 'createdb', '-U', 'postgres', database]); created = true
  psql(execFileSync('docker', ['exec', container, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema=auth', '--schema-only', '--no-owner', '--no-privileges'], { encoding: 'utf8' }))
  const dir = new URL('../../supabase/migrations/', import.meta.url)
  for (const file of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) psql(readFileSync(new URL(file, dir), 'utf8'))
})
after(() => { if (created) execFileSync('docker', ['exec', container, 'dropdb', '-U', 'postgres', database]) })
beforeEach(() => {
  if (!enabled) return
  psql(`delete from auth.users where id in ('${user}','${other}');
    insert into auth.users(id,aud,role,email,created_at,updated_at) values ('${user}','authenticated','authenticated','phase5b@example.test',now(),now()),('${other}','authenticated','authenticated','phase5b-other@example.test',now(),now());
    insert into public.xero_oauth_grants(id,user_id,xero_user_id,scopes,refresh_token_encrypted) values('${grant}','${user}','synthetic',array['accounting.transactions.read'],'synthetic');
    insert into public.xero_connections_public(user_id,tenant_id,tenant_name,auth_state,grant_id) values('${user}','tenant-a','synthetic','active','${grant}');
    insert into public.xero_sync_tenant_state(user_id,tenant_id) values('${user}','tenant-a');
    insert into public.xero_sync_runs(id,user_id,tenant_id,fencing_token,status,scope_version,required_steps,completed_at)
      values('${previous}','${user}','tenant-a',1,'succeeded','collections_v1',array['organisation','contacts','authorised_accrec_invoices','paid_accrec_invoices','authorised_accrec_payments','canonical_mapping','validation'],now());
    update public.xero_sync_tenant_state set current_fencing_token=1,latest_sync_run_id='${previous}',active_sync_run_id='${previous}',last_successful_sync_at=now() where user_id='${user}' and tenant_id='tenant-a';`)
})
function createPromise(overrides = {}) {
  const id = randomUUID(), invoice = overrides.invoice ?? 'i1', due = overrides.due ?? '2026-09-24'
  // Historical creation fixture uses the actual row/event guards and deferred
  // history consistency checks. No trigger or integrity constraint is disabled.
  psql(`begin;
    insert into public.invoice_promises(id,user_id,tenant_id,source_system,invoice_source_id,customer_source_id,currency_code,
      promised_amount_native,promised_date,creation_sync_run_id,payment_baseline,created_at)
    values('${id}','${user}','tenant-a','xero',${quote(invoice)},'c1','GBP',4000,${quote(due)},'${previous}',
      ${json({ version: 1, payment_ids: ['old-payment'], observation_started_at: '2026-09-20T08:00:00Z', observation_completed_at: '2026-09-20T08:01:00Z' })},'2026-09-20T09:00:00Z');
    insert into public.invoice_promise_events(promise_id,user_id,tenant_id,event_sequence,promise_revision,event_type,actor_kind,actor_user_id,after_terms,command_id,command_fingerprint)
      select id,user_id,tenant_id,1,1,'created','user',user_id,public.invoice_promise_terms(p),gen_random_uuid(),repeat('a',64) from public.invoice_promises p where id='${id}';commit;`)
  return id
}
const payment = (amount = '1000', overrides = {}) => ({ source_id: 'p1', invoice_source_id: 'i1', customer_source_id: 'c1', amount_native: amount,
  currency_code: 'GBP', payment_date: '2026-09-22', payment_type: 'ACCRECPAYMENT', payment_status: 'AUTHORISED', source_updated_at: '2026-09-22T00:00:00Z', ...overrides })

function candidate({ payments = [], cashRows = [], start = '2026-09-25T00:00:00Z', end = '2026-09-25T00:01:00Z', timezone = 'Europe/London', incomplete = null, starts = {} } = {}) {
  const [run, fence] = rpc(`select sync_run_id::text || '|' || fencing_token from public.acquire_xero_sync_run('${user}','tenant-a','${owner}','collections_v1',300);`).split('|')
  const args = `'${run}','${user}','tenant-a','${owner}',${fence}`
  const rawInvoice = { InvoiceID: 'i1', Contact: { ContactID: 'c1' }, Type: 'ACCREC', Status: 'AUTHORISED', CurrencyCode: 'GBP', Total: 10000, AmountDue: 9000, AmountPaid: 1000, AmountCredited: 0 }
  for (const [kind, rows] of [['organisations', [{ source_id: 'tenant-a', raw_json: { OrganisationID: 'tenant-a', BaseCurrency: 'GBP' } }]],
    ['contacts', [{ source_id: 'c1', raw_json: { ContactID: 'c1', Name: 'Synthetic' } }]], ['invoices', [{ source_id: 'i1', raw_json: rawInvoice }]], ['payments', []]]) {
    rpc(`select public.upsert_xero_generation_raw_batch(${args},${quote(kind)},now(),${json(rows)});`)
  }
  const canonicalInvoice = { source_id: 'i1', customer_source_id: 'c1', type: 'ACCREC', status: 'AUTHORISED', currency_code: 'GBP',
    total: '10000', amount_due: '9000', amount_paid: '1000', amount_credited: '0', transaction_currency_code: 'GBP', organisation_base_currency_code: 'GBP', xero_currency_rate: null,
    total_native: '10000', amount_due_native: '9000', amount_paid_native: '1000', amount_credited_native: '0', total_base: '10000', amount_due_base: '9000', amount_paid_base: '1000', amount_credited_base: '0', currency_conversion_status: 'identity', currency_conversion_failure_reason: null }
  for (const [kind, rows] of [['organisations', [{ source_organisation_id: 'tenant-a', base_currency_code: 'GBP', source_retrieved_at: start }]],
    ['customers', [{ source_id: 'c1', name: 'Synthetic' }]], ['invoices', [canonicalInvoice]]]) {
    rpc(`select public.upsert_xero_generation_canonical_batch(${args},${quote(kind)},${json(rows)});`)
  }
  for (const [resource, rows] of [['payments', payments], ['overpayments', cashRows.filter(r => r.source_kind === 'overpayment')], ['prepayments', cashRows.filter(r => r.source_kind === 'prepayment')]]) {
    const obs = { resource, started_at: starts[resource] ?? start, completed_at: incomplete === resource ? null : end,
      page_requests: rows.length ? 2 : 1, populated_pages: rows.length ? 1 : 0, source_count: rows.length, complete: incomplete !== resource }
    rpc(`select public.persist_xero_accounting_evidence(${args},${json(obs)},${json(rows)},${timezone ? quote(timezone) : 'null'});`)
  }
  for (const [step, count] of [['organisation', 1], ['contacts', 1], ['authorised_accrec_invoices', 1], ['paid_accrec_invoices', 0], ['authorised_accrec_payments', 0], ['canonical_mapping', 3], ['validation', 1]]) {
    rpc(`select * from public.complete_xero_sync_run_step('${run}','${owner}',${fence},'${step}',${count});`)
  }
  const recorded = rpc(`select validated::text || '|' || result_code from public.record_xero_sync_run_readiness(${args},'collections_readiness_v2');`)
  assert.equal(recorded, 'true|validated')
  return { run, fence: Number(fence), canonicalInvoice }
}
function prepare(run) { return JSON.parse(rpc(`select public.prepare_invoice_promise_reconciliation('${run.run}','${owner}',${run.fence});`)) }
function commit(run, proposal) { return JSON.parse(rpc(`select to_jsonb(p) from public.promote_xero_sync_run_with_promises('${run.run}','${owner}',${run.fence},null,${proposal === null ? 'null' : json(proposal)}) p;`)) }

function state(id) { return JSON.parse(psql(`select to_jsonb(p)||jsonb_build_object('promised_amount_native',trim_scale(promised_amount_native)::text,'qualifying_paid_amount_native',trim_scale(qualifying_paid_amount_native)::text) from public.invoice_promises p where id='${id}';`)) }
function eventCount(id) { return Number(psql(`select count(*) from public.invoice_promise_events where promise_id='${id}';`)) }
function proposalFor(run) { const held = prepare(run); return held.empty_active_set ? null : preparePromiseReconciliation(held) }
function reconcile(run) { return commit(run, proposalFor(run)) }
function published(run) { return psql(`select status from public.xero_sync_runs where id='${run.run}';`) === 'succeeded' }
const check = (name, fn) => test(name, { skip: !enabled }, fn)


const serverMocks = {
 '@/lib/supabase-server': {}, '@/lib/supabase-admin': {}, '@/lib/billing/entitlements': {},
 '@/lib/billing/collections-access': {}, '@/lib/collections/currency-context-server': {}, '@/lib/xero/authoritative-snapshot': {},
}
const { planPromiseMutation, parsePromiseRequest, promiseDTO } = loadTypeScriptModule('lib/collections/invoice-promises-server.ts', { mocks: serverMocks })
function requestHeld(intent) { return JSON.parse(rpc(`select public.prepare_invoice_promise_request('${user}','tenant-a',${intent.invoiceSourceId ? quote(intent.invoiceSourceId) : 'null'},${intent.promiseId ? quote(intent.promiseId) : 'null'},${intent.operation==='edit' && ('amount' in intent || 'promisedDate' in intent)});`)) }
function requestCommit(intent, held, plan, commandId = randomUUID()) {
 return JSON.parse(rpc(`select public.commit_invoice_promise_request('${user}','tenant-a','${commandId}',${json(intent)},'${held.sync_run_id}','${held.digest}',${json(plan.steps)},${plan.evaluation ? json(plan.evaluation) : 'null'});`))
}
const creationIntent = (changes={}) => ({ operation: 'create', invoiceSourceId: 'i1', amount: '4000', promisedDate: '2099-12-31', ...changes })
function ready(options={}) { const run=candidate(options); assert.equal(reconcile(run).promoted,true);return run }
function createRequest(intent=creationIntent(), commandId=randomUUID()) {
 const held=requestHeld(intent);return requestCommit(intent,held,planPromiseMutation(held,intent,new Date().toISOString()),commandId)
}
check('authenticated-server create baseline is exact scoped, generation-bound and initial paid zero',()=>{
 const run=ready({ payments:[payment()] });const result=createRequest()
 assert.equal(result.promise.promised_amount_native,'4000');assert.equal(result.promise.qualifying_paid_amount_native,'0')
 assert.deepEqual(result.promise.payment_baseline.payment_ids,['p1']);assert.equal(result.promise.creation_sync_run_id,run.run)
 assert.equal(result.events.length,1);assert.equal(result.events[0].event_type,'created')
 assert.equal('payment_baseline' in promiseDTO(result.promise),false)
 assert.throws(()=>createRequest());assert.equal(psql(`select count(*) from public.invoice_promises where user_id='${user}';`),'1')
})
check('create replay survives changed accounting and same request ID rejects changed user intent',()=>{
 ready();const commandId=randomUUID(),intent=creationIntent(),held=requestHeld(intent),plan=planPromiseMutation(held,intent,new Date().toISOString())
 const first=requestCommit(intent,held,plan,commandId)
 const replay=requestCommit(intent,{...held,digest:'0'.repeat(64)},plan,commandId)
 assert.equal(replay.promise.id,first.promise.id);assert.equal(replay.replayed,true);assert.equal(eventCount(first.promise.id),1)
 assert.throws(()=>requestCommit({...intent,amount:'3000'},held,plan,commandId))
})
check('held accounting promotion race rejects stale create without a record',()=>{
 ready();const intent=creationIntent(),held=requestHeld(intent),plan=planPromiseMutation(held,intent,new Date().toISOString())
 ready();assert.throws(()=>requestCommit(intent,held,plan));assert.equal(psql(`select count(*) from public.invoice_promises where user_id='${user}';`),'0')
})
check('terms edit already satisfied produces ordered changed and kept in one atomic command',()=>{
 const id=createPromise({due:'2026-10-30'});ready({payments:[payment()],start:'2026-09-23T00:00:00Z',end:'2026-09-23T00:01:00Z'})
 assert.equal(state(id).qualifying_paid_amount_native,'1000')
 const intent={operation:'edit',promiseId:id,expectedRevision:String(state(id).revision),amount:'1000',note:'agreed'}
 const held=requestHeld(intent),plan=planPromiseMutation(held,intent,new Date().toISOString()),commandId=randomUUID()
 const result=requestCommit(intent,held,plan,commandId)
 assert.equal(result.promise.status,'kept');assert.equal(result.promise.promised_amount_native,'1000');assert.equal(result.promise.qualifying_paid_amount_native,'1000')
 assert.deepEqual(result.events.map(e=>e.event_type),['changed','note_changed','kept'])
 assert.deepEqual(result.events.map(e=>e.event_sequence),['2','3','4'])
 assert.equal(result.events[0].before_terms.promised_amount_native,'4000')
 assert.deepEqual(result.promise.payment_baseline,held.promise.payment_baseline)
 assert.equal(requestCommit(intent,held,plan,commandId).events.length,3);assert.equal(eventCount(id),4)
 assert.throws(()=>requestCommit({...intent,expectedRevision:result.promise.revision},requestHeld({...intent,expectedRevision:result.promise.revision}),plan))
})
check('forced kept-event failure rolls back terms, note and outcome together',()=>{
 const id=createPromise({due:'2026-10-30'});ready({payments:[payment()],start:'2026-09-23T00:00:00Z',end:'2026-09-23T00:01:00Z'})
 const intent={operation:'edit',promiseId:id,expectedRevision:String(state(id).revision),amount:'1000'}
 const held=requestHeld(intent),plan=planPromiseMutation(held,intent,new Date().toISOString()),before=state(id)
 psql(`create function public.phase6_fail() returns trigger language plpgsql as $$begin if new.event_type='kept' then raise exception 'forced';end if;return new;end $$;create trigger phase6_fail before insert on public.invoice_promise_events for each row execute function public.phase6_fail();`)
 try {assert.throws(()=>requestCommit(intent,held,plan));assert.deepEqual(state(id),before);assert.equal(eventCount(id),1)}
 finally {psql(`drop trigger phase6_fail on public.invoice_promise_events;drop function public.phase6_fail();`)}
})
check('note-only is event-only intent, no terms/baseline/evaluation change',()=>{
 ready();const created=createRequest(),id=created.promise.id,intent={operation:'edit',promiseId:id,expectedRevision:'1',note:'new'}
 const held=requestHeld(intent);assert.equal(held.evidence,null)
 const result=requestCommit(intent,held,planPromiseMutation(held,intent,new Date().toISOString()))
 assert.equal(result.promise.status,'active');assert.equal(result.promise.note,'new');assert.equal(result.promise.qualifying_paid_amount_native,'0')
 assert.deepEqual(result.promise.payment_baseline,created.promise.payment_baseline);assert.deepEqual(result.events.map(e=>e.event_type),['note_changed'])
})
for(const amount of [0,'0','','   ',null]) check(`API cancellation ${JSON.stringify(amount)} preserves terms and permits new commitment`,()=>{
 ready({payments:[payment()]});const first=createRequest(),id=first.promise.id,commandId=randomUUID()
 const intent=parsePromiseRequest({tenantId:'tenant-a',commandId,operation:'edit',promiseId:id,expectedRevision:'1',amount}).intent
 const held=requestHeld(intent),plan=planPromiseMutation(held,intent,new Date().toISOString())
 const cancelled=requestCommit(intent,held,plan,commandId)
 assert.equal(cancelled.promise.status,'cancelled');assert.equal(cancelled.promise.promised_amount_native,'4000');assert.equal(eventCount(id),2)
 assert.equal(requestCommit(intent,held,plan,commandId).promise.id,id);assert.equal(eventCount(id),2)
 const second=createRequest();assert.notEqual(second.promise.id,id);assert.deepEqual(second.promise.payment_baseline.payment_ids,['p1'])
 const rows=JSON.parse(rpc(`select public.read_invoice_promises('${user}','tenant-a','i1',true,50);`));assert.equal(rows.length,2)
})
check('owned reads and event history are bounded and do not expose evidence payloads',()=>{
 ready();const result=createRequest(),id=result.promise.id
 for(const [u,t] of [[other,'tenant-a'],[user,'other-tenant']]) {
  assert.deepEqual(JSON.parse(rpc(`select public.read_invoice_promises('${u}','${t}','i1',true,50);`)),[])
  assert.deepEqual(JSON.parse(rpc(`select public.read_invoice_promise_history('${u}','${t}','${id}',100);`)),[])
  assert.throws(()=>rpc(`select public.prepare_invoice_promise_request('${u}','${t}',null,'${id}',false);`))
 }
 const history=JSON.parse(rpc(`select public.read_invoice_promise_history('${user}','tenant-a','${id}',100);`))
 assert.equal(history.length,1);assert.equal(history[0].event_type,'created');assert.equal('evidence' in history[0],false)
})
check('evidence-unready creation blocked in commit even if a server plan bypassed validation',()=>{
 const run=candidate({incomplete:'payments'});assert.equal(reconcile(run).promoted,true)
 const intent=creationIntent(),held=requestHeld(intent)
 assert.throws(()=>planPromiseMutation(held,intent,new Date().toISOString()))
 assert.throws(()=>requestCommit(intent,held,{steps:[{operation:'create',payload:{}}],evaluation:null}))
 assert.equal(psql(`select count(*) from public.invoice_promises;`),'0')
})
check('user edit/cancel prepared before system reconciliation cannot overwrite terminal state',()=>{
 const id=createPromise({due:'2026-10-30'});ready({payments:[payment()],start:'2026-09-23T00:00:00Z',end:'2026-09-23T00:01:00Z'})
 const intent={operation:'edit',promiseId:id,expectedRevision:String(state(id).revision),amount:'3000'},held=requestHeld(intent),plan=planPromiseMutation(held,intent,new Date().toISOString())
 const cancellation={operation:'cancel',promiseId:id,expectedRevision:intent.expectedRevision},cancelHeld=requestHeld(cancellation),cancelPlan=planPromiseMutation(cancelHeld,cancellation,new Date().toISOString())
 ready({payments:[payment('4000')],start:'2026-09-23T00:00:00Z',end:'2026-09-23T00:01:00Z'})
 assert.equal(state(id).status,'kept');assert.throws(()=>requestCommit(intent,held,plan));assert.throws(()=>requestCommit(cancellation,cancelHeld,cancelPlan));assert.equal(eventCount(id),2)
})
check('request cancellation invalidates prepared sync proposal; cancellation wins',()=>{
 const id=createPromise({due:'2026-10-30'});ready({payments:[payment()],start:'2026-09-23T00:00:00Z',end:'2026-09-23T00:01:00Z'})
 const run=candidate({payments:[payment('4000')]}),proposal=proposalFor(run)
 const intent={operation:'cancel',promiseId:id,expectedRevision:String(state(id).revision)},held=requestHeld(intent)
 requestCommit(intent,held,planPromiseMutation(held,intent,new Date().toISOString()))
 assert.equal(commit(run,proposal).result_code,'promise_state_changed');assert.equal(reconcile(run).promoted,true);assert.equal(state(id).status,'cancelled');assert.equal(eventCount(id),2)
})
check('new authenticated Promise invalidates previously prepared empty Active set',()=>{
 ready();const run=candidate({incomplete:'payments'}),proposal=proposalFor(run),created=createRequest()
 assert.equal(commit(run,proposal).result_code,'promise_preparation_required');assert.equal(reconcile(run).result_code,'promise_evidence_not_ready')
 assert.equal(state(created.promise.id).status,'active');assert.equal(published(run),false)
})
check('simultaneous server create requests cannot create two Active commitments',async()=>{
 ready();const intent=creationIntent(),held=requestHeld(intent),plan=planPromiseMutation(held,intent,new Date().toISOString())
 const sql=()=>`set role service_role;select public.commit_invoice_promise_request('${user}','tenant-a',gen_random_uuid(),${json(intent)},'${held.sync_run_id}','${held.digest}',${json(plan.steps)},null);`
 const outcomes=await Promise.allSettled([psqlAsync(sql()),psqlAsync(sql())]);assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1)
 assert.equal(psql(`select count(*) from public.invoice_promises where status='active';`),'1')
})
check('privileged server operations and multi-event executor have no browser grants',()=>{
 for(const name of ['commit_invoice_promise_request','prepare_invoice_promise_request','read_invoice_promise_request','read_invoice_promises','read_invoice_promise_history','apply_invoice_promise_request_step']) assert.equal(psql(`select bool_and(not has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute') and proconfig @> array['search_path=pg_catalog']) from pg_proc where proname='${name}';`),'t')
 assert.equal(psql(`select has_function_privilege('service_role','public.apply_invoice_promise_request_step(uuid,text,uuid,text,uuid,bigint,text,uuid,jsonb,text,bigint)','execute');`),'f')
})
check('simultaneous identical HTTP-command retries return one commitment and event',async()=>{
 ready();const intent=creationIntent(),held=requestHeld(intent),plan=planPromiseMutation(held,intent,new Date().toISOString()),commandId=randomUUID()
 const sql=`set role service_role;select public.commit_invoice_promise_request('${user}','tenant-a','${commandId}',${json(intent)},'${held.sync_run_id}','${held.digest}',${json(plan.steps)},null);`
 const results=await Promise.all([psqlAsync(sql),psqlAsync(sql)]),rows=results.map(value=>JSON.parse(value))
 assert.equal(rows[0].promise.id,rows[1].promise.id);assert.equal(eventCount(rows[0].promise.id),1)
 assert.equal(psql(`select count(*) from public.invoice_promises;`),'1')
})
check('simultaneous prepared edits cannot both win the held revision',async()=>{
 ready();const row=createRequest().promise
 const intents=['first','second'].map(note=>({operation:'edit',promiseId:row.id,expectedRevision:'1',note}))
 const held=intents.map(requestHeld),plans=intents.map((intent,index)=>planPromiseMutation(held[index],intent,new Date().toISOString()))
 const sql=index=>`set role service_role;select public.commit_invoice_promise_request('${user}','tenant-a',gen_random_uuid(),${json(intents[index])},'${held[index].sync_run_id}','${held[index].digest}',${json(plans[index].steps)},null);`
 const outcomes=await Promise.allSettled([psqlAsync(sql(0)),psqlAsync(sql(1))])
 assert.equal(outcomes.filter(outcome=>outcome.status==='fulfilled').length,1);assert.equal(state(row.id).revision,2);assert.equal(eventCount(row.id),2)
})
for(const outcome of ['missed','unclear'])check(`elapsed date edit atomically applies existing resolver ${outcome} decision`,()=>{
 const id=createPromise({due:'2026-10-30'})
 const cashRows=outcome==='unclear'?[{source_kind:'overpayment',source_id:'cash-edit',customer_source_id:'c1',provider_type:'RECEIVE-OVERPAYMENT',remaining_credit_native:'3500',currency_code:'GBP',accounting_date:'2026-09-22',status:'AUTHORISED',source_updated_at:null,organisation_base_currency_code:'GBP',xero_currency_rate:null,remaining_credit_base:'3500',currency_conversion_status:'identity',currency_conversion_failure_reason:null}]:[]
 ready({payments:[payment()],cashRows})
 const intent={operation:'edit',promiseId:id,expectedRevision:String(state(id).revision),promisedDate:'2026-09-24'}
 const held=requestHeld(intent),plan=planPromiseMutation(held,intent,new Date().toISOString())
 const result=requestCommit(intent,held,plan)
 assert.equal(result.promise.status,outcome);assert.deepEqual(result.events.map(event=>event.event_type),['changed',outcome])
 assert.equal(result.promise.qualifying_paid_amount_native,'1000');assert.equal(eventCount(id),3)
})
