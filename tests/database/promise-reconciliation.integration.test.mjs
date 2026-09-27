import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import test, { before, after, beforeEach } from 'node:test'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'
const { preparePromiseReconciliation } = loadTypeScriptModule('lib/xero/promise-reconciliation.ts')
const { deriveInvoiceActionability } = loadTypeScriptModule('lib/collections/invoice-actionability.ts')
const enabled = process.env.RUN_SUPABASE_INTEGRATION === '1'
const container = 'supabase_db_template-app'
const database = `promise_phase5b_${randomUUID().replaceAll('-', '')}`
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
const cash = (amount = '3500', overrides = {}) => ({ source_kind: 'overpayment', source_id: 'cash1', customer_source_id: 'c1', provider_type: 'RECEIVE-OVERPAYMENT',
  remaining_credit_native: amount, currency_code: 'GBP', accounting_date: '2026-09-22', status: 'AUTHORISED', source_updated_at: null,
  organisation_base_currency_code: 'GBP', xero_currency_rate: null, remaining_credit_base: amount, currency_conversion_status: 'identity', currency_conversion_failure_reason: null, ...overrides })
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
function command(id, operation, payload = {}, revision = 1) { return rpc(`select public.apply_invoice_promise_command('${user}','tenant-a',gen_random_uuid(),'${operation}','${id}',${revision},'user','${user}',${json(payload)});`) }
function state(id) { return JSON.parse(psql(`select to_jsonb(p)||jsonb_build_object('promised_amount_native',trim_scale(promised_amount_native)::text,'qualifying_paid_amount_native',trim_scale(qualifying_paid_amount_native)::text) from public.invoice_promises p where id='${id}';`)) }
function eventCount(id) { return Number(psql(`select count(*) from public.invoice_promise_events where promise_id='${id}';`)) }
function proposalFor(run) { const held = prepare(run); return held.empty_active_set ? null : preparePromiseReconciliation(held) }
function reconcile(run) { return commit(run, proposalFor(run)) }
function published(run) { return psql(`select status from public.xero_sync_runs where id='${run.run}';`) === 'succeeded' }
const check = (name, fn) => test(name, { skip: !enabled }, fn)

check('partial evaluation is event-free, exact, revision-safe and fixes payment double subtraction', () => {
  const id = createPromise(), run = candidate({ payments: [payment()], start: '2026-09-23T00:00:00Z', end: '2026-09-23T00:01:00Z' })
  assert.equal(reconcile(run).promoted, true)
  const saved = state(id); assert.equal(saved.status, 'active'); assert.equal(saved.qualifying_paid_amount_native, '1000'); assert.equal(saved.revision, 2)
  assert.equal(saved.evaluated_sync_run_id, run.run); assert.equal(eventCount(id), 1)
  const invoice = { ...run.canonicalInvoice, user_id: user, tenant_id: 'tenant-a', source_system: 'xero' }
  const result = deriveInvoiceActionability(invoice, null, saved)
  assert.equal(result.activePromisedCoverageAmountNative, '3000'); assert.equal(result.toChaseAmountNative, '6000')
  assert.equal(commit(run, { evidence_digest: 'a'.repeat(64), proposals: [] }).result_code, 'already_promoted')
  assert.equal(state(id).revision, 2); assert.equal(eventCount(id), 1)
  assert.equal(rpc(`select public.record_invoice_promise_evaluation('${user}','tenant-a','${id}',1,'${run.run}','1000','2026-09-23T00:01:00Z');`), 'f')
  assert.equal(state(id).revision, 2)
})
for (const [status, payments, cashRows, options] of [
  ['kept', [payment('4000')], [], { start: '2026-09-23T00:00:00Z', end: '2026-09-23T00:01:00Z' }],
  ['missed', [payment()], [], {}], ['unclear', [payment()], [cash()], {}],
]) check(`${status} commits promotion and exactly one immutable matching terminal event`, () => {
  const id = createPromise(), run = candidate({ payments, cashRows, ...options })
  const prepared = preparePromiseReconciliation(prepare(run)), originalEvidence = prepared.proposals[0].result.evidence
  assert.equal(commit(run, prepared).promoted, true); assert.equal(state(id).status, status); assert.equal(eventCount(id), 2)
  const event = JSON.parse(psql(`select to_jsonb(e) from public.invoice_promise_events e where promise_id='${id}' and event_sequence=2;`))
  assert.equal(event.event_type, status); assert.deepEqual(event.evidence, originalEvidence)
  assert.equal(commit(run, prepared).result_code, 'already_promoted'); assert.equal(eventCount(id), 2)
  const later = candidate({ payments: [payment('5000', { payment_date: '2026-09-26' })] })
  assert.deepEqual(prepare(later).promises, []); assert.equal(reconcile(later).promoted, true)
  assert.equal(state(id).status, status); assert.equal(eventCount(id), 2)
})
for (const [label, options] of [
  ['before promised date ends', { start: '2026-09-24T21:00:00Z', end: '2026-09-24T22:00:00Z' }],
  ['straddling observation', { start: '2026-09-24T22:59:59Z', end: '2026-09-24T23:01:00Z' }],
  ['one old stream', { starts: { prepayments: '2026-09-24T22:59:59Z' } }],
]) check(`${label} retains Active through actual atomic integration`, () => {
  const id = createPromise(), run = candidate(options); assert.equal(reconcile(run).promoted, true); assert.equal(state(id).status, 'active'); assert.equal(eventCount(id), 1)
})
for (const [label, options] of [['failed cash stream', { incomplete: 'overpayments' }], ['failed prepayment stream', { incomplete: 'prepayments' }], ['missing timezone', { timezone: null }], ['failed payments', { incomplete: 'payments' }]]) {
  check(`${label} blocks promotion with an Active Promise and retains prior authority`, () => {
    const id = createPromise(), run = candidate({ payments: [payment('4000')], ...options })
    const before = state(id), result = reconcile(run)
    assert.equal(result.promoted, false); assert.equal(result.result_code, 'promise_evidence_not_ready')
    assert.deepEqual(state(id), before); assert.equal(eventCount(id), 1); assert.equal(published(run), false)
    assert.equal(psql(`select active_sync_run_id from public.xero_sync_tenant_state where user_id='${user}' and tenant_id='tenant-a';`), previous)
  })
}
check('cash-only FX deferral persists independently certified payment facts without terminal event', () => {
  const id = createPromise(), run = candidate({ payments: [payment()], cashRows: [cash('3500', { currency_code: 'USD', remaining_credit_base: null, currency_conversion_status: 'incomplete', currency_conversion_failure_reason: 'missing_rate' })] })
  const result = preparePromiseReconciliation(prepare(run)).proposals[0].result
  assert.equal(result.decision, 'defer'); assert.equal(result.payment_evaluation_valid, true)
  assert.equal(reconcile(run).promoted, true); assert.equal(state(id).qualifying_paid_amount_native, '1000'); assert.equal(eventCount(id), 1)
})
check('deleted payment recomputes Active paid total downward on later successful generation', () => {
  const id = createPromise({ due: '2026-10-30' }), options = { start: '2026-09-23T00:00:00Z', end: '2026-09-23T00:01:00Z' }
  assert.equal(reconcile(candidate({ payments: [payment()], ...options })).promoted, true); assert.equal(state(id).qualifying_paid_amount_native, '1000')
  assert.equal(reconcile(candidate({ payments: [payment('1000', { payment_status: 'DELETED' })], ...options })).promoted, true)
  assert.equal(state(id).qualifying_paid_amount_native, '0'); assert.equal(state(id).status, 'active'); assert.equal(eventCount(id), 1)
})
for (const [label, operation, payload] of [['edit', 'change_terms', { promised_amount_native: '3000', promised_date: '2026-09-24' }], ['cancel', 'cancel', {}]]) {
  check(`prepared reconciliation cannot overwrite concurrent ${label}; recompute uses same generation`, () => {
    const id = createPromise(), run = candidate({ payments: [payment('4000')] }), proposal = preparePromiseReconciliation(prepare(run))
    command(id, operation, payload)
    assert.equal(commit(run, proposal).result_code, 'promise_state_changed'); assert.equal(published(run), false)
    assert.equal(reconcile(run).promoted, true)
    assert.equal(state(id).status, operation === 'cancel' ? 'cancelled' : 'kept')
    assert.equal(eventCount(id), operation === 'cancel' ? 2 : 3)
  })
}
check('new Promise after preparation invalidates Active set; old observation cannot resolve new commitment', () => {
  const run = candidate({ payments: [payment('4000')] }), proposal = proposalFor(run)
  // Actual creation command is timestamped now, after this candidate collection.
  const created = JSON.parse(rpc(`select public.apply_invoice_promise_command('${user}','tenant-a',gen_random_uuid(),'create',null,null,'user','${user}',
    ${json({ source_system: 'xero', invoice_source_id: 'i1', customer_source_id: 'c1', currency_code: 'GBP', promised_amount_native: '4000', promised_date: '2026-10-30', creation_sync_run_id: previous,
      payment_baseline: { version: 1, payment_ids: [], observation_started_at: '2026-09-20T08:00:00Z', observation_completed_at: '2026-09-20T08:01:00Z' } })});`))
  assert.equal(commit(run, proposal).result_code, 'promise_preparation_required'); assert.equal(published(run), false)
  assert.equal(reconcile(run).promoted, true); assert.equal(state(created.promise_id).status, 'active'); assert.equal(state(created.promise_id).revision, 1)
})
check('omitted Active Promise or changed evidence digest cannot publish', () => {
  createPromise(); const run = candidate(), proposal = preparePromiseReconciliation(prepare(run))
  assert.equal(commit(run, { ...proposal, proposals: [] }).result_code, 'promise_state_changed')
  assert.equal(commit(run, { ...proposal, evidence_digest: '0'.repeat(64) }).result_code, 'promise_evidence_changed'); assert.equal(published(run), false)
})
for (const table of ['invoice_promise_events', 'invoice_promises']) check(`forced ${table} failure rolls back publication and all Promise writes`, () => {
  const id = createPromise(), run = candidate({ payments: [payment('4000')] }), proposal = preparePromiseReconciliation(prepare(run))
  psql(`create function public.phase5b_force_failure() returns trigger language plpgsql as $$begin raise exception 'forced phase5b failure';end $$;
    create trigger phase5b_force_failure before ${table === 'invoice_promises' ? 'update' : 'insert'} on public.${table} for each row execute function public.phase5b_force_failure();`)
  try { assert.throws(() => commit(run, proposal)); assert.equal(published(run), false); assert.equal(state(id).status, 'active'); assert.equal(state(id).revision, 1); assert.equal(eventCount(id), 1) }
  finally { psql(`drop trigger phase5b_force_failure on public.${table};drop function public.phase5b_force_failure();`) }
})
check('failed candidate and invalid cross-owner evaluation cannot mutate Promises', () => {
  const id = createPromise(), run = candidate()
  assert.throws(() => rpc(`select public.record_invoice_promise_evaluation('${other}','tenant-a','${id}',1,'${run.run}','1000',now());`))
  assert.throws(() => rpc(`select public.record_invoice_promise_evaluation('${user}','other-tenant','${id}',1,'${run.run}','1000',now());`))
  psql(`update public.xero_sync_runs set status='failed',lease_owner=null,lease_expires_at=null,failed_at=now(),error_code='fixture_failure' where id='${run.run}';`)
  assert.equal(commit(run, { evidence_digest: 'a'.repeat(64), proposals: [] }).promoted, false); assert.equal(state(id).revision, 1)
})
check('internal functions are private, browser execution denied, bounded evaluation has no terms inputs', () => {
  for (const signature of ['apply_invoice_promise_command_internal(uuid,text,uuid,text,uuid,bigint,text,uuid,jsonb)', 'promote_xero_sync_run_internal(uuid,uuid,bigint,timestamptz)', 'invoice_promise_reconciliation_snapshot(uuid,uuid,text)']) {
    assert.equal(psql(`select has_function_privilege('service_role', 'public.${signature}', 'execute');`), 'f')
  }
  for (const name of ['prepare_invoice_promise_reconciliation', 'promote_xero_sync_run_with_promises', 'record_invoice_promise_evaluation']) {
    assert.equal(psql(`select bool_and(not has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute') and proconfig @> array['search_path=pg_catalog']) from pg_proc where proname='${name}';`), 't')
  }
  assert.equal(psql(`select proargnames::text from pg_proc where proname='record_invoice_promise_evaluation';`).includes('promised_date'), false)
})
check('simultaneous identical promotions commit exactly once', async () => {
  const id = createPromise(), run = candidate({ payments: [payment('4000')] }), proposal = preparePromiseReconciliation(prepare(run))
  const sql = `set role service_role;select result_code from public.promote_xero_sync_run_with_promises('${run.run}','${owner}',${run.fence},null,${json(proposal)});`
  const results = await Promise.all([psqlAsync(sql), psqlAsync(sql)])
  assert.deepEqual(results.sort(), ['already_promoted', 'promoted']); assert.equal(eventCount(id), 2)
})
check('tenant lock serializes a real concurrent cancellation ahead of promotion', async () => {
  const id = createPromise(), run = candidate({ payments: [payment('4000')] }), proposal = preparePromiseReconciliation(prepare(run))
  const cancelling = psqlAsync(`begin;select public.lock_invoice_promise_tenant('${user}','tenant-a');
    select public.apply_invoice_promise_command('${user}','tenant-a',gen_random_uuid(),'cancel','${id}',1,'user','${user}','{}');select pg_sleep(0.6);commit;`)
  // Wait for the database lock itself, not an assumed host timing race.
  for (let i = 0; i < 100; i++) {
    if (psql(`select exists(select 1 from pg_locks where locktype='advisory' and granted and database=(select oid from pg_database where datname=current_database()));`) === 't') break
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  const promoted = JSON.parse(await psqlAsync(`set role service_role;select to_jsonb(p) from public.promote_xero_sync_run_with_promises('${run.run}','${owner}',${run.fence},null,${json(proposal)}) p;`)); await cancelling
  assert.equal(promoted.result_code, 'promise_state_changed'); assert.equal(published(run), false); assert.equal(state(id).status, 'cancelled')
})
check('bare legacy promotion cannot bypass a nonempty Active set', () => {
  createPromise(); const run = candidate()
  assert.equal(rpc(`select result_code from public.promote_xero_sync_run('${run.run}','${owner}',${run.fence});`), 'promise_preparation_required'); assert.equal(published(run), false)
})

check('bounded Active evaluation preserves all commitment terms and rejects stale changed facts', () => {
  const id = createPromise({ due: '2026-10-30' }), run = candidate({ payments: [payment()] })
  const before = state(id); assert.equal(reconcile(run).promoted, true); const after = state(id)
  for (const key of ['id','user_id','tenant_id','source_system','invoice_source_id','customer_source_id','promised_amount_native','promised_date','note','currency_code','status','created_at','creation_sync_run_id','payment_baseline']) assert.deepEqual(after[key], before[key])
  assert.throws(() => rpc(`select public.record_invoice_promise_evaluation('${user}','tenant-a','${id}',1,'${run.run}','2000','2026-09-25T00:01:00Z');`))
  assert.throws(() => rpc(`select public.record_invoice_promise_evaluation('${user}','tenant-a','${id}',2,'${run.run}','-1','2026-09-25T00:01:00Z');`))
  assert.throws(() => rpc(`select public.record_invoice_promise_evaluation('${user}','tenant-a','${id}',2,'${run.run}','1000','2026-09-24T00:01:00Z');`))
  assert.equal(state(id).revision, 2); assert.equal(eventCount(id), 1)
})
check('persisted zero-paid Active Promise preserves dispute precedence in Phase 4', () => {
  const id = createPromise({ due: '2026-10-30' }), run = candidate(); assert.equal(reconcile(run).promoted, true)
  const invoice = { ...run.canonicalInvoice, user_id: user, tenant_id: 'tenant-a', source_system: 'xero', amount_due_native: '10000', amount_due_base: '10000' }
  const dispute = { user_id: user, tenant_id: 'tenant-a', source_system: 'xero', invoice_source_id: 'i1', dispute_mode: 'partial',
    recorded_disputed_amount_native: '8000', amount_due_at_last_review_native: '10000', is_active: true, resolved_at: null }
  const result = deriveInvoiceActionability(invoice, dispute, state(id))
  assert.equal(result.activePromisedCoverageAmountNative, '2000'); assert.equal(result.toChaseAmountNative, '0')
})
check('numeric evidence and Promise projection stay exact through reconciliation and event JSON', () => {
  const id = createPromise({ due: '2026-10-30' }), amount = '1000.1234567890123456789', run = candidate({ payments: [payment(amount)] })
  const held = prepare(run); assert.equal(held.facts.payments[0].amount_native, amount)
  assert.equal(typeof held.promises[0].promised_amount_native, 'string'); assert.equal(reconcile(run).promoted, true)
  assert.equal(state(id).qualifying_paid_amount_native, amount); assert.equal(eventCount(id), 1)
})
check('forced nonterminal evaluation failure rolls back accounting publication', () => {
  const id = createPromise({ due: '2026-10-30' }), run = candidate({ payments: [payment()] }), proposal = preparePromiseReconciliation(prepare(run))
  psql(`create function public.phase5b_force_failure() returns trigger language plpgsql as $$begin raise exception 'forced phase5b failure';end $$;
    create trigger phase5b_force_failure before update on public.invoice_promises for each row execute function public.phase5b_force_failure();`)
  try { assert.throws(() => commit(run, proposal)); assert.equal(published(run), false); assert.equal(state(id).qualifying_paid_amount_native, '0'); assert.equal(state(id).revision, 1) }
  finally { psql(`drop trigger phase5b_force_failure on public.invoice_promises;drop function public.phase5b_force_failure();`) }
})
check('mismatched resolver generation and evidence summary abort the entire transaction', () => {
  const id = createPromise(), run = candidate({ payments: [payment('4000')] }), proposal = preparePromiseReconciliation(prepare(run))
  const bad = structuredClone(proposal); bad.proposals[0].result.source_sync_run_id = previous
  assert.throws(() => commit(run, bad)); assert.equal(published(run), false); assert.equal(state(id).status, 'active')
  const wrongTerms = structuredClone(proposal); wrongTerms.proposals[0].result.evidence.promised_amount_native = '5000'
  assert.throws(() => commit(run, wrongTerms)); assert.equal(published(run), false); assert.equal(eventCount(id), 1)
})

for (const incomplete of ['payments','overpayments','prepayments']) check(`zero Active Promises permits ordinary promotion with incomplete ${incomplete}`, () => {
  const run = candidate({ incomplete }); assert.equal(prepare(run).empty_active_set, true)
  assert.equal(reconcile(run).promoted, true); assert.equal(published(run), true)
  assert.equal(psql(`select active_sync_run_id from public.xero_sync_tenant_state where user_id='${user}' and tenant_id='tenant-a';`), run.run)
})
check('unready £9k candidate cannot pair with stale paid zero; ready replacement yields £6k To chase', () => {
  const id = createPromise({ due: '2026-10-30' })
  psql(`insert into public.canonical_customers(sync_run_id,user_id,tenant_id,source_id,name) values('${previous}','${user}','tenant-a','c1','Synthetic');
    insert into public.canonical_invoices(sync_run_id,user_id,tenant_id,source_id,customer_source_id,type,status,
      transaction_currency_code,organisation_base_currency_code,currency_conversion_status,amount_due_native,amount_due_base)
    values('${previous}','${user}','tenant-a','i1','c1','ACCREC','AUTHORISED','GBP','GBP','identity',10000,10000);`)
  const authoritativeInvoice = () => JSON.parse(psql(`select to_jsonb(i)||jsonb_build_object('amount_due_native',trim_scale(amount_due_native)::text,'amount_due_base',trim_scale(amount_due_base)::text)
    from public.canonical_invoices i join public.xero_sync_tenant_state s on s.active_sync_run_id=i.sync_run_id and s.user_id=i.user_id and s.tenant_id=i.tenant_id
    where i.user_id='${user}' and i.tenant_id='tenant-a' and i.source_id='i1';`))
  assert.equal(authoritativeInvoice().amount_due_native, '10000'); assert.equal(state(id).qualifying_paid_amount_native, '0')
  const unready = candidate({ payments: [payment()], incomplete: 'payments' }), before = state(id)
  assert.equal(unready.canonicalInvoice.amount_due_native, '9000')
  assert.equal(reconcile(unready).result_code, 'promise_evidence_not_ready')
  assert.equal(authoritativeInvoice().amount_due_native, '10000'); assert.deepEqual(state(id), before)
  assert.equal(deriveInvoiceActionability(authoritativeInvoice(), null, state(id)).toChaseAmountNative, '6000')
  // Same safe fenced failure operation used by generation-sync releases the candidate.
  assert.match(rpc(`select failed::text || '|' || result_code from public.fail_xero_sync_run('${unready.run}','${owner}',${unready.fence},'promotion_failed','promise_evidence_not_ready');`), /^true\|/)
  assert.equal(authoritativeInvoice().amount_due_native, '10000'); assert.deepEqual(state(id), before)
  const ready = candidate({ payments: [payment()] }); assert.equal(reconcile(ready).promoted, true)
  assert.equal(authoritativeInvoice().sync_run_id, ready.run); assert.equal(authoritativeInvoice().amount_due_native, '9000')
  assert.equal(state(id).qualifying_paid_amount_native, '1000'); assert.equal(state(id).evaluated_sync_run_id, ready.run)
  const result = deriveInvoiceActionability(authoritativeInvoice(), null, state(id))
  assert.equal(result.activePromisedCoverageAmountNative, '3000'); assert.equal(result.toChaseAmountNative, '6000')
})
check('creation after empty preparation cannot publish an evidence-unready generation', () => {
  const run = candidate({ incomplete: 'overpayments' }), empty = proposalFor(run); assert.equal(empty, null)
  const created = JSON.parse(rpc(`select public.apply_invoice_promise_command('${user}','tenant-a',gen_random_uuid(),'create',null,null,'user','${user}',
    ${json({ source_system: 'xero', invoice_source_id: 'i1', customer_source_id: 'c1', currency_code: 'GBP', promised_amount_native: '4000', promised_date: '2026-10-30', creation_sync_run_id: previous,
      payment_baseline: { version: 1, payment_ids: [], observation_started_at: '2026-09-20T08:00:00Z', observation_completed_at: '2026-09-20T08:01:00Z' } })});`))
  const id = created.promise_id, before = state(id)
  assert.equal(commit(run, empty).result_code, 'promise_preparation_required'); assert.equal(published(run), false)
  assert.equal(reconcile(run).result_code, 'promise_evidence_not_ready'); assert.equal(published(run), false)
  assert.deepEqual(state(id), before); assert.equal(eventCount(id), 1)
  assert.equal(psql(`select active_sync_run_id from public.xero_sync_tenant_state where user_id='${user}' and tenant_id='tenant-a';`), previous)
})
