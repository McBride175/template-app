import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import test, { after, before } from 'node:test'

const enabled = process.env.RUN_SUPABASE_INTEGRATION === '1'
const container = 'supabase_db_template-app'
// This suite never applies migrations to the existing local application DB.
// Only the auth SCHEMA (no data) is copied into this uniquely named database.
const database = `promise_phase2_${randomUUID().replaceAll('-', '')}`
const user = '00000000-0000-4000-8000-00000000a201'
const otherUser = '00000000-0000-4000-8000-00000000a202'
const run = '00000000-0000-4000-8000-00000000a203'
const otherRun = '00000000-0000-4000-8000-00000000a204'
const migrationDir = new URL('../../supabase/migrations/', import.meta.url)
const signature = 'public.apply_invoice_promise_command(uuid,text,uuid,text,uuid,bigint,text,uuid,jsonb)'
let createdDatabase = false

function args() {
  return ['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database, '-At']
}
function psql(sql) {
  return execFileSync('docker', args(), { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}
function psqlAsync(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args())
    let out = ''; let error = ''
    child.stdout.on('data', chunk => { out += chunk })
    child.stderr.on('data', chunk => { error += chunk })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(error)))
    child.stdin.end(sql)
  })
}
const baseline = { version: 1, payment_ids: [], observation_started_at: '2026-09-25T09:00:00Z', observation_completed_at: '2026-09-25T09:01:00Z' }
function createPayload(invoice = 'invoice-a', overrides = {}) {
  return { source_system: 'xero', invoice_source_id: invoice, customer_source_id: 'customer-a', currency_code: 'GBP',
    promised_amount_native: '4000.00', promised_date: '2026-09-30', note: ' Initial ', creation_sync_run_id: run,
    payment_baseline: baseline, ...overrides }
}
function quote(value) { return `'${String(value).replaceAll("'", "''")}'` }
function commandSql(operation, { id = null, revision = null, payload = {}, command = randomUUID(), owner = user, tenant = 'tenant-a' } = {}) {
  const system = operation === 'resolve'
  return `select public.apply_invoice_promise_command(${quote(owner)}::uuid,${quote(tenant)},${quote(command)}::uuid,
    ${quote(operation)},${id ? `${quote(id)}::uuid` : 'null'},${revision ?? 'null'},${quote(system ? 'system' : 'user')},
    ${system ? 'null' : `${quote(owner)}::uuid`},${quote(JSON.stringify(payload))}::jsonb);`
}
const helpers = `
create function pg_temp.assert_ok(value boolean, message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception '%', message; end if; end $$;
create function pg_temp.expect_error(statement text, code text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate <> code then raise exception 'Expected %, got %: %',code,sqlstate,sqlerrm; end if;
    return;
  end;
  raise exception 'Expected % but operation succeeded: %',code,statement;
end $$;
create function pg_temp.create_promise(invoice text default 'invoice-a', command uuid default gen_random_uuid())
returns uuid language plpgsql as $$
declare result jsonb;
begin
  result := public.apply_invoice_promise_command('${user}','tenant-a',command,'create',null,null,'user','${user}',
    jsonb_build_object('source_system','xero','invoice_source_id',invoice,'customer_source_id','customer-a',
      'currency_code','GBP','promised_amount_native','4000.00','promised_date','2026-09-30','note',' Initial ',
      'creation_sync_run_id','${run}','payment_baseline',${quote(JSON.stringify(baseline))}::jsonb));
  return (result->>'promise_id')::uuid;
end $$;
create function pg_temp.mutate(operation text, id uuid, revision bigint, payload jsonb default '{}', command uuid default gen_random_uuid())
returns jsonb language sql as $$
  select public.apply_invoice_promise_command('${user}','tenant-a',command,operation,id,revision,
    case when operation = 'resolve' then 'system' else 'user' end,
    case when operation = 'resolve' then null else '${user}'::uuid end,payload);
$$;
`
function contract(sql) {
  const out = psql(`begin; ${helpers} ${sql} set constraints all immediate; select 'promise_contract_ok'; rollback;`)
  assert.match(out, /promise_contract_ok/)
}

before(() => {
  if (!enabled) return
  execFileSync('docker', ['exec', container, 'createdb', '-U', 'postgres', database])
  createdDatabase = true
  const auth = execFileSync('docker', ['exec', container, 'pg_dump', '-U', 'postgres', '-d', 'postgres',
    '--schema=auth', '--schema-only', '--no-owner', '--no-privileges'], { encoding: 'utf8' })
  psql(auth)
  const files = readdirSync(migrationDir).filter(name => name.endsWith('.sql')).sort()
  for (const name of files) psql(readFileSync(new URL(name, migrationDir), 'utf8'))
  psql(`insert into auth.users(id,aud,role,email,created_at,updated_at) values
    ('${user}','authenticated','authenticated','promise-a@example.test',now(),now()),
    ('${otherUser}','authenticated','authenticated','promise-b@example.test',now(),now());
    insert into public.xero_connections_public(user_id,tenant_id,tenant_name) values
      ('${user}','tenant-a','Promise fixture A'),('${otherUser}','tenant-b','Promise fixture B');
    insert into public.xero_sync_tenant_state(user_id,tenant_id) values ('${user}','tenant-a'),('${otherUser}','tenant-b');
    insert into public.xero_sync_runs(id,user_id,tenant_id,fencing_token,status,scope_version,required_steps,completed_at)
    values ('${run}','${user}','tenant-a',1,'succeeded','collections_v1',
      array['organisation','contacts','authorised_accrec_invoices','paid_accrec_invoices','authorised_accrec_payments','canonical_mapping','validation'],now()),
    ('${otherRun}','${otherUser}','tenant-b',1,'succeeded','collections_v1',
      array['organisation','contacts','authorised_accrec_invoices','paid_accrec_invoices','authorised_accrec_payments','canonical_mapping','validation'],now());`)
})
after(() => {
  if (createdDatabase) execFileSync('docker', ['exec', container, 'dropdb', '-U', 'postgres', database])
})

test('clean migration replay, RLS and privilege boundaries expose only the service command', { skip: !enabled }, () => {
  contract(`
    select pg_temp.assert_ok((select bool_and(relrowsecurity) from pg_class where oid in
      ('public.invoice_promises'::regclass,'public.invoice_promise_events'::regclass)), 'RLS absent');
    do $$
#variable_conflict use_variable
declare role_name text; table_name text; begin
      foreach role_name in array array['anon','authenticated','service_role'] loop
        foreach table_name in array array['public.invoice_promises','public.invoice_promise_events'] loop
          perform pg_temp.assert_ok(not has_table_privilege(role_name,table_name,'INSERT,UPDATE,DELETE,TRUNCATE'), 'direct write grant');
          if role_name <> 'service_role' then perform pg_temp.assert_ok(not has_table_privilege(role_name,table_name,'SELECT'), 'browser read grant'); end if;
        end loop;
      end loop;
      perform pg_temp.assert_ok(has_function_privilege('service_role','${signature}','EXECUTE'), 'service RPC grant');
      perform pg_temp.assert_ok(not has_function_privilege('authenticated','${signature}','EXECUTE'), 'browser RPC grant');
      perform pg_temp.assert_ok(not has_function_privilege('anon','${signature}','EXECUTE'), 'anonymous RPC grant');
    end $$;
    set local role authenticated;
    select pg_temp.expect_error('select * from public.invoice_promises','42501');
    select pg_temp.expect_error('select * from public.invoice_promise_events','42501');
    select pg_temp.expect_error(${quote(commandSql('create', { payload: createPayload() }))},'42501');
    reset role;
    set local role service_role;
    select pg_temp.create_promise();
    select pg_temp.expect_error('update public.invoice_promises set note = ''bypass''','42501');
    select pg_temp.expect_error('delete from public.invoice_promise_events','42501');
    select pg_temp.expect_error('update public.invoice_promise_events set event_type = ''kept''','42501');
    select pg_temp.expect_error('insert into public.invoice_promise_events default values','42501');
    reset role;
  `)
})

test('one active commitment, fixed exact amount, cancellation and multiple retained IDs', { skip: !enabled }, () => {
  contract(`do $$
#variable_conflict use_variable
declare id uuid; next_id uuid; begin
    id := pg_temp.create_promise();
    perform pg_temp.assert_ok((select revision = 1 and promised_amount_native = 4000 and note = 'Initial'
      and qualifying_paid_amount_native = 0 from public.invoice_promises where invoice_promises.id = id),'initial terms');
    perform pg_temp.assert_ok((select count(*) = 1 from public.invoice_promise_events where promise_id = id and event_type = 'created'),'created event');
    perform pg_temp.expect_error('select pg_temp.create_promise()','23505');
    perform pg_temp.mutate('cancel',id,1);
    next_id := pg_temp.create_promise();
    perform pg_temp.assert_ok(next_id <> id,'new commitment reused ID');
    perform pg_temp.assert_ok((select status = 'cancelled' and promised_amount_native = 4000 and resolved_at is not null
      from public.invoice_promises where invoice_promises.id = id),'cancel lost commitment');
    perform pg_temp.assert_ok((select count(*) = 2 from public.invoice_promises where invoice_source_id = 'invoice-a'),'history lost');
    perform pg_temp.assert_ok((select before_terms->>'promised_amount_native' = '4000' and after_terms->>'promised_amount_native' = '4000'
      from public.invoice_promise_events where promise_id = id and event_type = 'cancelled'),'cancel terms lost');
  end $$;`)
})

test('edits preserve before/after terms, increment revisions and reject stale or terminal edits', { skip: !enabled }, () => {
  contract(`do $$
#variable_conflict use_variable
declare id uuid; begin
    id := pg_temp.create_promise();
    perform pg_temp.mutate('change_terms',id,1,'{"promised_amount_native":"3000.1234567890123456789","promised_date":"2026-10-02"}');
    perform pg_temp.assert_ok((select before_terms->>'promised_amount_native' = '4000'
      and after_terms->>'promised_amount_native' = '3000.1234567890123456789' and promise_revision = 2
      from public.invoice_promise_events where promise_id = id and event_type = 'changed'),'edit history or precision');
    perform pg_temp.expect_error(format('select pg_temp.mutate(''change_note'',%L,1,''{"note":"stale"}'')',id),'40001');
    perform pg_temp.mutate('change_note',id,2,'{"note":"  Changed  "}');
    perform pg_temp.assert_ok((select revision = 3 and note = 'Changed' from public.invoice_promises where invoice_promises.id = id),'note revision');
    perform pg_temp.mutate('cancel',id,3);
    perform pg_temp.expect_error(format('select pg_temp.mutate(''change_note'',%L,4,''{"note":"reactivate"}'')',id),'40001');
  end $$;`)
})

test('all system outcomes agree with one terminal event and cannot change or reactivate', { skip: !enabled }, () => {
  contract(`do $$
#variable_conflict use_variable
declare id uuid; outcome text; payload jsonb; begin
    foreach outcome in array array['kept','missed','unclear'] loop
      id := pg_temp.create_promise(outcome);
      payload := jsonb_build_object('status',outcome,'qualifying_paid_amount_native','1000.25',
        'evaluated_sync_run_id','${run}','evaluated_at','2026-09-25T12:00:00Z',
        'resolution_reason_code','fixture_outcome','resolution_contract_version','fixture-v1','evidence',jsonb_build_object('version',1));
      perform pg_temp.mutate('resolve',id,1,payload);
      perform pg_temp.assert_ok((select status = outcome and revision = 2 and qualifying_paid_amount_native = 1000.25
        and resolved_at is not null from public.invoice_promises where invoice_promises.id = id),'system outcome mismatch');
      perform pg_temp.assert_ok((select count(*) = 1 from public.invoice_promise_events where promise_id = id
        and event_type in ('cancelled','kept','missed','unclear')),'terminal event count');
      perform pg_temp.expect_error(format('update public.invoice_promises set status = ''active'', resolved_at = null where id = %L',id),'23514');
      perform pg_temp.expect_error(format('update public.invoice_promises set status = ''missed'' where id = %L',id),'23514');
      perform pg_temp.expect_error(format('select pg_temp.mutate(''resolve'',%L,2,%L)',id,payload::text),'40001');
    end loop;
  end $$;`)
})

test('event failure rolls back create/edit/cancel and operational failure writes no event', { skip: !enabled }, () => {
  contract(`
    create function pg_temp.reject_event() returns trigger language plpgsql as $$
    begin if new.event_type <> 'created' then raise exception 'forced event failure' using errcode = 'P0002'; end if; return new; end $$;
    create trigger reject_event_fixture after insert on public.invoice_promise_events for each row execute function pg_temp.reject_event();
    do $$
#variable_conflict use_variable
declare id uuid; begin
      id := pg_temp.create_promise();
      perform pg_temp.expect_error(format('select pg_temp.mutate(''change_note'',%L,1,''{"note":"rollback"}'')',id),'P0002');
      perform pg_temp.expect_error(format('select pg_temp.mutate(''cancel'',%L,1)',id),'P0002');
      perform pg_temp.expect_error(format('select pg_temp.mutate(''change_note'',%L,9,''{"note":"stale"}'')',id),'40001');
      perform pg_temp.assert_ok((select status = 'active' and revision = 1 and note = 'Initial' from public.invoice_promises where invoice_promises.id = id),'partial operational write');
      perform pg_temp.assert_ok((select count(*) = 1 from public.invoice_promise_events where promise_id = id),'event escaped rollback');
    end $$;
    drop trigger reject_event_fixture on public.invoice_promise_events;
    create function pg_temp.reject_created_event() returns trigger language plpgsql as $$
    begin raise exception 'forced creation failure' using errcode = 'P0002'; end $$;
    create trigger reject_created_fixture after insert on public.invoice_promise_events for each row execute function pg_temp.reject_created_event();
    select pg_temp.expect_error('select pg_temp.create_promise(''rolled-back-create'')','P0002');
    select pg_temp.assert_ok(not exists(select 1 from public.invoice_promises where invoice_source_id = 'rolled-back-create'),'create leaked');
    drop trigger reject_created_fixture on public.invoice_promise_events;
  `)
})

test('deferred integrity rejects operational-only writes and contradictory/incomplete history', { skip: !enabled }, () => {
  contract(`do $$
#variable_conflict use_variable
declare id uuid; begin
    id := pg_temp.create_promise();
    set constraints all immediate;
    set constraints all deferred;
    perform pg_temp.expect_error(format('update public.invoice_promises set note = ''orphan change'' where id = %L; set constraints all immediate',id),'23514');
    perform pg_temp.assert_ok((select note = 'Initial' and revision = 1 from public.invoice_promises where invoice_promises.id = id),'deferred failure failed rollback');
    perform pg_temp.expect_error(format('update public.invoice_promises set user_id = ''${otherUser}'' where id = %L',id),'23514');
    perform pg_temp.expect_error(format('delete from public.invoice_promises where id = %L',id),'42501');
    perform pg_temp.expect_error(format('update public.invoice_promise_events set after_terms = after_terms where promise_id = %L',id),'42501');
    perform pg_temp.expect_error(format('delete from public.invoice_promise_events where promise_id = %L',id),'42501');
    perform pg_temp.expect_error(format('insert into public.invoice_promise_events select gen_random_uuid(), promise_id, user_id, tenant_id,
      event_sequence + 1, promise_revision, ''created'', occurred_at, effective_at, actor_kind, actor_user_id,
      before_terms, after_terms, evidence, source_sync_run_id, resolver_version, gen_random_uuid(), command_fingerprint, 1
      from public.invoice_promise_events where promise_id = %L',id),'23514');
  end $$;`)
})

test('ownership checks reject cross-user/tenant mutation, events and provenance', { skip: !enabled }, () => {
  contract(`do $$
#variable_conflict use_variable
declare id uuid; begin
    id := pg_temp.create_promise();
    perform pg_temp.expect_error(format('select public.apply_invoice_promise_command(''${otherUser}'',''tenant-a'',gen_random_uuid(),''cancel'',%L,1,''user'',''${otherUser}'',''{}'')',id),'40001');
    perform pg_temp.expect_error(format('select public.apply_invoice_promise_command(''${user}'',''tenant-b'',gen_random_uuid(),''cancel'',%L,1,''user'',''${user}'',''{}'')',id),'40001');
    perform pg_temp.expect_error(format('insert into public.invoice_promise_events select gen_random_uuid(),promise_id,''${otherUser}'',tenant_id,
      2,1,''note_changed'',occurred_at,null,''user'',''${otherUser}'',after_terms,after_terms,null,null,null,gen_random_uuid(),command_fingerprint,1
      from public.invoice_promise_events where promise_id = %L',id),'23503');
  end $$;
  select pg_temp.expect_error(${quote(commandSql('create', { payload: createPayload('bad-run', { creation_sync_run_id: otherRun }) }))},'23503');
  `)
})

test('same command returns its original result after later changes; changed intent conflicts', { skip: !enabled }, () => {
  contract(`do $$
#variable_conflict use_variable
declare id uuid; cmd uuid := gen_random_uuid(); changed_cmd uuid := gen_random_uuid(); result jsonb; begin
    id := pg_temp.create_promise('invoice-a',cmd);
    perform pg_temp.assert_ok(pg_temp.create_promise('invoice-a',cmd) = id,'create replay duplicated');
    perform pg_temp.expect_error(format('select pg_temp.create_promise(''different-invoice'',%L)',cmd),'23505');
    result := pg_temp.mutate('change_note',id,1,'{"note":"first edit"}',changed_cmd);
    perform pg_temp.mutate('cancel',id,2);
    perform pg_temp.assert_ok(pg_temp.mutate('change_note',id,1,'{"note":"first edit"}',changed_cmd) = result,'replay returned current rather than original result');
    perform pg_temp.expect_error(format('select pg_temp.mutate(''change_note'',%L,1,''{"note":"other intent"}'',%L)',id,changed_cmd),'23505');
    perform pg_temp.assert_ok((select count(*) = 3 from public.invoice_promise_events where promise_id = id),'retry duplicated events');
  end $$;`)
})

test('terminal command retries append no duplicate outcome and creation provenance survives run retention', { skip: !enabled }, () => {
  contract(`do $$
#variable_conflict use_variable
declare id uuid; cmd uuid := gen_random_uuid(); payload jsonb; result jsonb; begin
    id := pg_temp.create_promise();
    result := pg_temp.mutate('cancel',id,1,'{}',cmd);
    perform pg_temp.assert_ok(pg_temp.mutate('cancel',id,1,'{}',cmd) = result,'cancel replay changed result');
    id := pg_temp.create_promise('system-retry');
    cmd := gen_random_uuid();
    payload := jsonb_build_object('status','kept','qualifying_paid_amount_native','4000',
      'evaluated_sync_run_id','${run}','evaluated_at','2026-09-25T12:00:00Z',
      'resolution_reason_code','fixture_outcome','resolution_contract_version','fixture-v1','evidence',jsonb_build_object('version',1));
    result := pg_temp.mutate('resolve',id,1,payload,cmd);
    delete from public.xero_sync_runs where xero_sync_runs.id = '${run}';
    perform pg_temp.assert_ok(pg_temp.mutate('resolve',id,1,payload,cmd) = result,'retained outcome replay failed');
    perform pg_temp.assert_ok((select count(*) = 2 from public.invoice_promise_events where promise_id = id),'terminal retry duplicated');
    perform pg_temp.assert_ok((select creation_sync_run_id = '${run}' from public.invoice_promises where invoice_promises.id = id),'provenance lost');
  end $$;`)
})

test('equivalent decimal, baseline-set and timestamp encodings replay across session timezones', { skip: !enabled }, () => {
  const cmd = randomUUID()
  const initial = createPayload('equivalent-intent', { payment_baseline: { ...baseline, payment_ids: ['payment-b', 'payment-a'] } })
  const equivalent = createPayload('equivalent-intent', { promised_amount_native: '4000', note: 'Initial',
    creation_sync_run_id: run.toUpperCase(), payment_baseline: { ...baseline, payment_ids: ['payment-a', 'payment-b'],
      observation_started_at: '2026-09-25T10:00:00+01:00', observation_completed_at: '2026-09-25T10:01:00+01:00' } })
  contract(`create temporary table replay_results(result jsonb);
    insert into replay_results ${commandSql('create', { command: cmd, payload: initial })}
    set local timezone = 'Pacific/Auckland';
    insert into replay_results ${commandSql('create', { command: cmd, payload: equivalent })}
    select pg_temp.assert_ok((select count(distinct result) = 1 from replay_results),'equivalent intent conflicted');
    select pg_temp.assert_ok((select count(*) = 1 from public.invoice_promises where invoice_source_id = 'equivalent-intent'),'equivalent retry duplicated');`)
})

test('every immutable creation fact and malformed history shape is protected', { skip: !enabled }, () => {
  contract(`do $$
#variable_conflict use_variable
declare id uuid; assignment text; begin
    id := pg_temp.create_promise();
    foreach assignment in array array[
      'id = gen_random_uuid()', 'tenant_id = ''different''', 'source_system = ''different''',
      'invoice_source_id = ''different''', 'customer_source_id = ''different''', 'currency_code = ''USD''',
      'created_at = created_at - interval ''1 hour''', 'creation_sync_run_id = gen_random_uuid()',
      'payment_baseline = jsonb_set(payment_baseline,''{payment_ids}'',''["different"]'')'
    ] loop
      perform pg_temp.expect_error(format('update public.invoice_promises set %s where id = %L',assignment,id),'23514');
    end loop;
    perform pg_temp.expect_error(format('update public.invoice_promises set status = ''cancelled'' where id = %L',id),'23514');
    perform pg_temp.expect_error(format('insert into public.invoice_promise_events(promise_id,user_id,tenant_id,event_sequence,promise_revision,
      event_type,actor_kind,actor_user_id,before_terms,after_terms,command_id,command_fingerprint)
      select promise_id,user_id,tenant_id,3,1,''note_changed'',actor_kind,actor_user_id,after_terms,after_terms,gen_random_uuid(),command_fingerprint
      from public.invoice_promise_events where promise_id = %L',id),'23514');
    perform pg_temp.assert_ok(not public.invoice_promise_terms_valid('{"version":1}') and
      not public.invoice_promise_baseline_valid('{"version":1}'),'unvalidated snapshots');
  end $$;`)
})

test('multiple events can share a resulting revision and command with deterministic sequence', { skip: !enabled }, () => {
  contract(`do $$
#variable_conflict use_variable
declare id uuid; prior jsonb; intermediate jsonb; final_terms jsonb; cmd uuid := gen_random_uuid(); stamp timestamptz := now(); begin
    id := pg_temp.create_promise();
    select after_terms into prior from public.invoice_promise_events where promise_id = id;
    update public.invoice_promises set note = 'final' where invoice_promises.id = id;
    intermediate := jsonb_set(prior,'{note}','"intermediate"');
    final_terms := jsonb_set(prior,'{note}','"final"');
    insert into public.invoice_promise_events(promise_id,user_id,tenant_id,event_sequence,promise_revision,event_type,
      occurred_at,actor_kind,actor_user_id,before_terms,after_terms,command_id,command_fingerprint,command_event_sequence)
    values (id,'${user}','tenant-a',2,2,'note_changed',stamp,'user','${user}',prior,intermediate,cmd,repeat('a',64),1),
      (id,'${user}','tenant-a',3,2,'note_changed',stamp,'user','${user}',intermediate,final_terms,cmd,repeat('a',64),2);
    perform pg_temp.assert_ok((select array_agg(event_sequence order by event_sequence) = array[1,2,3]::bigint[]
      from public.invoice_promise_events where promise_id = id),'sequence order');
    perform pg_temp.assert_ok((select count(*) = 2 from public.invoice_promise_events where promise_id = id and promise_revision = 2),'revision improperly unique');
  end $$;`)
})

test('event sequencing does not require an event for every operational revision', { skip: !enabled }, () => {
  // Administrative fixture simulates a future evidence-only update, without
  // providing any production operation or calculating payment evidence here.
  contract(`do $$
#variable_conflict use_variable
declare id uuid; begin
    id := pg_temp.create_promise();
    update public.invoice_promises set evaluated_sync_run_id = '${run}', evaluated_at = now()
      where invoice_promises.id = id;
    perform pg_temp.mutate('change_note',id,2,'{"note":"after evidence metadata"}');
    perform pg_temp.assert_ok((select array_agg(promise_revision order by event_sequence) = array[1,3]::bigint[]
      and array_agg(event_sequence order by event_sequence) = array[1,2]::bigint[] from public.invoice_promise_events where promise_id = id),'revisions became event order');
  end $$;`)
})

test('invalid money, note, baseline, identity and actor shapes fail closed', { skip: !enabled }, () => {
  for (const overrides of [
    { promised_amount_native: '0' }, { promised_amount_native: '-1' }, { promised_amount_native: 'NaN' },
    { promised_amount_native: 'Infinity' }, { promised_amount_native: 4000 }, { promised_date: '2026-02-30' },
    { currency_code: 'gbp' }, { tenant_id: 'extra-key' }, { invoice_source_id: '' }, { customer_source_id: '' },
    { note: 'x'.repeat(2001) }, { payment_baseline: { ...baseline, version: 2 } },
    { payment_baseline: { ...baseline, payment_ids: ['same','same'] } },
    { payment_baseline: { ...baseline, observation_started_at: '2026-09-25T09:00:00' } },
  ]) {
    const code = overrides.promised_date ? '22008' : overrides.currency_code || overrides.invoice_source_id === '' || overrides.customer_source_id === '' ? '23514' : '22023'
    contract(`select pg_temp.expect_error(${quote(commandSql('create', { payload: createPayload('invalid', overrides) }))},${quote(code)});
      select pg_temp.assert_ok(not exists(select 1 from public.invoice_promises where invoice_source_id = 'invalid'),'invalid create leaked');`)
  }
  contract(`select pg_temp.expect_error(${quote(commandSql('create', { payload: createPayload() }).replace(`'user',\n    '${user}'::uuid`, `'user',\n    '${otherUser}'::uuid`))},'22023');`)
})

test('account privacy deletion cascades operational and immutable history without deleting another owner', { skip: !enabled }, () => {
  contract(`select pg_temp.create_promise();
    ${commandSql('create', { owner: otherUser, tenant: 'tenant-b', payload: createPayload('other-owner', { creation_sync_run_id: otherRun }) })}
    delete from auth.users where id = '${user}';
    select pg_temp.assert_ok(not exists(select 1 from public.invoice_promises where user_id = '${user}'),'privacy promise retained');
    select pg_temp.assert_ok(not exists(select 1 from public.invoice_promise_events where user_id = '${user}'),'privacy events retained');
    select pg_temp.assert_ok(exists(select 1 from auth.users where id = '${otherUser}'),'other account erased');
    select pg_temp.assert_ok(exists(select 1 from public.invoice_promises where user_id = '${otherUser}'),'other Promise erased');
    select pg_temp.assert_ok(exists(select 1 from public.invoice_promise_events where user_id = '${otherUser}'),'other history erased');
  `)
})

test('concurrent different commands cannot create two active promises for one invoice', { skip: !enabled }, async () => {
  const call = () => `begin; set local role service_role; ${commandSql('create', { payload: createPayload('concurrent-identity') })} select pg_sleep(0.2); commit;`
  const results = await Promise.allSettled([psqlAsync(call()), psqlAsync(call())])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.match(results.find(result => result.status === 'rejected').reason.message, /idx_invoice_promises_one_active/)
  assert.equal(psql(`select count(*) from public.invoice_promises where invoice_source_id = 'concurrent-identity';`), '1')
})

test('real concurrent edits cannot both win an expected revision', { skip: !enabled }, async () => {
  const id = JSON.parse(psql(commandSql('create', { payload: createPayload('concurrent-edits') }))).promise_id
  const call = note => `begin; set local role service_role; ${commandSql('change_note', { id, revision: 1, payload: { note } })} select pg_sleep(0.2); commit;`
  const results = await Promise.allSettled([psqlAsync(call('edit-a')), psqlAsync(call('edit-b'))])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const failure = results.find(result => result.status === 'rejected')
  assert.match(failure.reason.message, /invoice_promise_revision_conflict/)
  assert.equal(psql(`select revision || '|' || (select count(*) from public.invoice_promise_events where promise_id = '${id}')
    from public.invoice_promises where id = '${id}';`), '2|2')
})

test('concurrent identical creation commands create one Promise and one event', { skip: !enabled }, async () => {
  const command = randomUUID()
  const call = `begin; set local role service_role; ${commandSql('create', { command, payload: createPayload('concurrent-retry') })} commit;`
  const results = await Promise.all([psqlAsync(call), psqlAsync(call)])
  assert.deepEqual(JSON.parse(results[0]), JSON.parse(results[1]))
  assert.equal(psql(`select count(*) from public.invoice_promises where invoice_source_id = 'concurrent-retry';`), '1')
  assert.equal(psql(`select count(*) from public.invoice_promise_events where command_id = '${command}';`), '1')
})
