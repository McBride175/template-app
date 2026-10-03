import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { loadTypeScriptModule } from '../../xero/test-helpers/ts-module-loader.mjs'

const { preparePromiseReconciliation } = loadTypeScriptModule('lib/xero/promise-reconciliation.ts')
const { planPromiseMutation } = loadTypeScriptModule('lib/collections/invoice-promises-server.ts', {
  mocks: { '@/lib/supabase-server': {}, '@/lib/supabase-admin': {}, '@/lib/billing/entitlements': {},
    '@/lib/billing/collections-access': {}, '@/lib/collections/currency-context-server': {}, '@/lib/xero/authoritative-snapshot': {} },
})
export const container = 'supabase_db_template-app'
export const database = `collection_dependency_${randomUUID().replaceAll('-', '')}`
export const user = '00000000-0000-4000-8000-000000003201'
export const other = '00000000-0000-4000-8000-000000003202'
export const owner = '00000000-0000-4000-8000-000000003203'
const grant = '00000000-0000-4000-8000-000000003204'
export const quote = value => `'${String(value).replaceAll("'", "''")}'`
export const json = value => `${quote(JSON.stringify(value))}::jsonb`
const args = ['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database, '-At']
export function psql(sql) { return execFileSync('docker', args, { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
export function psqlAsync(sql) { return new Promise((resolve, reject) => {
  const child = spawn('docker', args); let out = '', err = ''
  child.stdout.on('data', chunk => { out += chunk }); child.stderr.on('data', chunk => { err += chunk })
  child.on('error', reject); child.on('close', code => code ? reject(new Error(err)) : resolve(out.trim())); child.stdin.end(sql)
}) }
export const rpc = sql => psql(`set role service_role;${sql}`)
let created = false
export function setup() {
  execFileSync('docker', ['exec', container, 'createdb', '-U', 'postgres', database]); created = true
  psql(execFileSync('docker', ['exec', container, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema=auth', '--schema-only', '--no-owner', '--no-privileges'], { encoding: 'utf8' }))
  const directory = new URL('../../../supabase/migrations/', import.meta.url)
  for (const file of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) psql(readFileSync(new URL(file, directory), 'utf8'))
}
export function cleanup() { if (created) execFileSync('docker', ['exec', container, 'dropdb', '-U', 'postgres', database]) }
export function reset() {
  psql(`delete from auth.users where id in ('${user}','${other}');
    insert into auth.users(id,aud,role,email,created_at,updated_at) values
      ('${user}','authenticated','authenticated','dependency-a@example.test',now(),now()),
      ('${other}','authenticated','authenticated','dependency-b@example.test',now(),now());
    insert into public.xero_oauth_grants(id,user_id,xero_user_id,scopes,refresh_token_encrypted)
      values('${grant}','${user}','synthetic',array['accounting.transactions.read'],'synthetic');
    insert into public.xero_connections_public(user_id,tenant_id,tenant_name,auth_state,grant_id)
      values('${user}','tenant-a','synthetic','active','${grant}');`)
}
export function candidate({ payments = [], cashRows = [], start = '2026-09-25T00:00:00Z', end = '2026-09-25T00:01:00Z', timezone = 'Europe/London', incomplete = null, starts = {}, extraInvoices = [], invoiceChanges = {} } = {}) {
  const [run, fence] = rpc(`select sync_run_id::text || '|' || fencing_token from public.acquire_xero_sync_run('${user}','tenant-a','${owner}','collections_v1',300);`).split('|')
  const args = `'${run}','${user}','tenant-a','${owner}',${fence}`
  const rawInvoice = { InvoiceID: 'i1', Contact: { ContactID: 'c1' }, Type: 'ACCREC', Status: 'AUTHORISED', CurrencyCode: 'GBP', Total: Number(invoiceChanges.total_native ?? 10000), AmountDue: Number(invoiceChanges.amount_due_native ?? 9000), AmountPaid: Number(invoiceChanges.amount_paid_native ?? 1000), AmountCredited: 0 }
  for (const [kind, rows] of [['organisations', [{ source_id: 'tenant-a', raw_json: { OrganisationID: 'tenant-a', BaseCurrency: 'GBP' } }]],
    ['contacts', [...new Set(['c1',...extraInvoices.map(i=>i.customer_source_id ?? 'c1')])].map(source_id=>({source_id,raw_json:{ContactID:source_id,Name:'Synthetic'}}))], ['invoices', [{ source_id: 'i1', raw_json: rawInvoice }, ...extraInvoices.map(i => ({source_id:i.source_id, raw_json:{...rawInvoice,InvoiceID:i.source_id,Contact:{ContactID:i.customer_source_id ?? 'c1'}}}))]], ['payments', []]]) {
    rpc(`select public.upsert_xero_generation_raw_batch(${args},${quote(kind)},now(),${json(rows)});`)
  }
  const canonicalInvoice = { source_id: 'i1', customer_source_id: 'c1', type: 'ACCREC', status: 'AUTHORISED', currency_code: 'GBP',
    total: '10000', amount_due: '9000', amount_paid: '1000', amount_credited: '0', transaction_currency_code: 'GBP', organisation_base_currency_code: 'GBP', xero_currency_rate: null,
    total_native: '10000', amount_due_native: '9000', amount_paid_native: '1000', amount_credited_native: '0', total_base: '10000', amount_due_base: '9000', amount_paid_base: '1000', amount_credited_base: '0', currency_conversion_status: 'identity', currency_conversion_failure_reason: null, ...invoiceChanges }
  for (const [kind, rows] of [['organisations', [{ source_organisation_id: 'tenant-a', base_currency_code: 'GBP', source_retrieved_at: start }]],
    ['customers', [...new Set(['c1',...extraInvoices.map(i=>i.customer_source_id ?? 'c1')])].map(source_id=>({source_id,name:'Synthetic'}))], ['invoices', [canonicalInvoice,...extraInvoices.map(i=>({...canonicalInvoice,...i}))]]]) {
    rpc(`select public.upsert_xero_generation_canonical_batch(${args},${quote(kind)},${json(rows)});`)
  }
  for (const [resource, rows] of [['payments', payments], ['overpayments', cashRows.filter(r => r.source_kind === 'overpayment')], ['prepayments', cashRows.filter(r => r.source_kind === 'prepayment')]]) {
    const obs = { resource, started_at: starts[resource] ?? start, completed_at: incomplete === resource ? null : end,
      page_requests: rows.length ? 2 : 1, populated_pages: rows.length ? 1 : 0, source_count: rows.length, complete: incomplete !== resource }
    rpc(`select public.persist_xero_accounting_evidence(${args},${json(obs)},${json(rows)},${timezone ? quote(timezone) : 'null'});`)
  }
  for (const [step, count] of [['organisation', 1], ['contacts', new Set(['c1',...extraInvoices.map(i=>i.customer_source_id ?? 'c1')]).size], ['authorised_accrec_invoices', 1+extraInvoices.length], ['paid_accrec_invoices', 0], ['authorised_accrec_payments', 0], ['canonical_mapping', 2+extraInvoices.length+new Set(['c1',...extraInvoices.map(i=>i.customer_source_id ?? 'c1')]).size], ['validation', 1]]) {
    rpc(`select * from public.complete_xero_sync_run_step('${run}','${owner}',${fence},'${step}',${count});`)
  }
  const recorded = rpc(`select validated::text || '|' || result_code from public.record_xero_sync_run_readiness(${args},'collections_readiness_v2');`)
  assert.equal(recorded, 'true|validated')
  return { run, fence: Number(fence), canonicalInvoice }
}
export function prepare(run) { return JSON.parse(rpc(`select public.prepare_invoice_promise_reconciliation('${run.run}','${owner}',${run.fence});`)) }
export function proposalFor(run) { const held = prepare(run); return held.empty_active_set ? null : preparePromiseReconciliation(held) }
export function promote(run, proposal = head().generationId === run.run ? null : proposalFor(run)) { return JSON.parse(rpc(`select to_jsonb(p) from public.promote_xero_sync_run_with_promises('${run.run}','${owner}',${run.fence},null,${proposal === null ? 'null' : json(proposal)}) p;`)) }
export function ready(options = {}) { const run = candidate(options); assert.equal(promote(run).promoted,true); return run }
export function head(customer = 'c1', scopeUser = user, tenant = 'tenant-a', source = 'xero') {
  return JSON.parse(rpc(`select public.read_collection_dependencies('${scopeUser}',${quote(tenant)},${quote(source)},${customer === null ? 'null' : quote(customer)});`))
}
export function prepareRequest(intent) {
  return JSON.parse(rpc(`select public.prepare_invoice_promise_request('${user}','tenant-a',${intent.invoiceSourceId ? quote(intent.invoiceSourceId) : 'null'},${intent.promiseId ? quote(intent.promiseId) : 'null'},${intent.operation==='edit' && ('amount' in intent || 'promisedDate' in intent)});`))
}
export function commitRequest(intent, held, plan, command = randomUUID()) {
  return JSON.parse(rpc(`select public.commit_invoice_promise_request('${user}','tenant-a','${command}',${json(intent)},'${held.sync_run_id}','${held.digest}',${json(plan.steps)},${plan.evaluation ? json(plan.evaluation) : 'null'});`))
}
export function promiseRequest(intent, command = randomUUID()) {
  const held = prepareRequest(intent)
  const request = intent.operation !== 'create' && intent.expectedRevision === undefined ? {...intent,expectedRevision:held.promise.revision} : intent
  return commitRequest(request,held,planPromiseMutation(held,request,new Date().toISOString()),command)
}
export function createPromise(extra = {}, command) {
  return promiseRequest({ operation:'create', invoiceSourceId:'i1', amount:'4000', promisedDate:'2099-12-31', ...extra },command)
}
export function promiseState(id) { return JSON.parse(psql(`select public.invoice_promise_server_row(p) from public.invoice_promises p where id='${id}';`)) }
export function dispute(invoice = 'i1', amount = 2000, extra = '') {
  return psql(`insert into public.invoice_disputes(user_id,tenant_id,source_system,invoice_source_id,dispute_mode,recorded_disputed_amount_native,amount_due_at_last_review_native)
    values('${user}','tenant-a','xero',${quote(invoice)},'partial',${amount},9000) returning id;${extra}`)
}
export const override = (level = 'priority', customer = 'c1') => `insert into public.customer_overrides(user_id,tenant_id,customer_source_id,override_level)
  values('${user}','tenant-a',${quote(customer)},${quote(level)}) on conflict(user_id,tenant_id,customer_source_id) do update set override_level=excluded.override_level,updated_at=clock_timestamp();`
export const action = (id = randomUUID(), customer = 'c1') => `insert into public.collection_actions(id,user_id,tenant_id,source_system,customer_source_id,action_type,outcome,next_action_date)
  values('${id}','${user}','tenant-a','xero',${quote(customer)},'outcome','message_sent','2099-12-31');`
export function historicalPromise(run, due = '2026-09-24') {
  const id = randomUUID()
  psql(`begin;
    insert into public.invoice_promises(id,user_id,tenant_id,source_system,invoice_source_id,customer_source_id,currency_code,
      promised_amount_native,promised_date,creation_sync_run_id,payment_baseline,created_at)
    values('${id}','${user}','tenant-a','xero','i1','c1','GBP',4000,${quote(due)},'${run.run}',
      ${json({version:1,payment_ids:[],observation_started_at:'2026-09-19T08:00:00Z',observation_completed_at:'2026-09-19T08:01:00Z'})},'2026-09-20T09:00:00Z');
    insert into public.invoice_promise_events(promise_id,user_id,tenant_id,event_sequence,promise_revision,event_type,actor_kind,actor_user_id,after_terms,command_id,command_fingerprint)
      select id,user_id,tenant_id,1,1,'created','user',user_id,public.invoice_promise_terms(p),gen_random_uuid(),repeat('a',64) from public.invoice_promises p where id='${id}';commit;`)
  return id
}
export const payment = (amount='1000') => ({source_id:'p1',invoice_source_id:'i1',customer_source_id:'c1',amount_native:amount,currency_code:'GBP',payment_date:'2026-09-22',payment_type:'ACCRECPAYMENT',payment_status:'AUTHORISED',source_updated_at:'2026-09-22T00:00:00Z'})
export const cash = () => ({source_kind:'overpayment',source_id:'o1',customer_source_id:'c1',provider_type:'RECEIVE-OVERPAYMENT',status:'AUTHORISED',remaining_credit_native:'3500',remaining_credit_base:'3500',accounting_date:'2026-09-22',currency_code:'GBP',organisation_base_currency_code:'GBP',xero_currency_rate:null,source_updated_at:'2026-09-22T00:00:00Z',currency_conversion_status:'identity',currency_conversion_failure_reason:null})
// A database latch makes race ordering independent of wall-clock scheduling.
export async function holdBarrier() {
  const key = Number.parseInt(randomUUID().slice(0,8),16)
  const child = spawn('docker',args);let out='',err='',signalReady,failReady
  const held=new Promise((resolve,reject)=>{signalReady=resolve;failReady=reject})
  const done=new Promise((resolve,reject)=>{
    child.on('error',error=>{failReady(error);reject(error)})
    child.on('close',code=>{if(code){const error=new Error(err);failReady(error);reject(error)}else resolve(out.trim())})
  });done.catch(()=>{})
  child.stdout.on('data',chunk=>{out+=chunk;if(out.includes('dependency_barrier_ready'))signalReady()})
  child.stderr.on('data',chunk=>{err+=chunk})
  child.stdin.write(`select pg_advisory_lock(${key});select 'dependency_barrier_ready';\n`)
  await held
  return {key,release:()=>{child.stdin.end(`select pg_advisory_unlock(${key});\n`);return done}}
}
export async function waitForLock(applicationName) {
  for(let n=0;n<100;n++) {
    if(psql(`select count(*) from pg_stat_activity where datname=current_database() and application_name=${quote(applicationName)} and wait_event_type='Lock';`)==='1')return
    await new Promise(resolve=>setTimeout(resolve,10))
  }
  assert.fail(`database lock was not observed for ${applicationName}`)
}
