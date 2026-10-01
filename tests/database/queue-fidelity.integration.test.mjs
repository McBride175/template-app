import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import test, { before, after } from 'node:test'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const enabled = process.env.RUN_SUPABASE_INTEGRATION === '1'
const container = 'supabase_db_template-app'
const database = `queue_phase4_${randomUUID().replaceAll('-', '')}`
const user = '00000000-0000-4000-8000-00000000a401'
const other = '00000000-0000-4000-8000-00000000a402'
const { resolveQueueEligibility } = loadTypeScriptModule('lib/collections/queue-eligibility.ts')
let created = false
function psql(statement) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', database, '-At'], { input: statement, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}
before(() => {
  if (!enabled) return
  execFileSync('docker', ['exec', container, 'createdb', '-U', 'postgres', database]); created = true
  psql(execFileSync('docker', ['exec', container, 'pg_dump', '-U', 'postgres', '-d', 'postgres',
    '--schema=auth', '--schema-only', '--no-owner', '--no-privileges'], { encoding: 'utf8' }))
  const directory = new URL('../../supabase/migrations/', import.meta.url)
  for (const file of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
    psql(readFileSync(new URL(file, directory), 'utf8'))
  }
  psql(`insert into auth.users(id,aud,role,email,created_at,updated_at) values
    ('${user}','authenticated','authenticated','phase4-a@example.test',now(),now()),
    ('${other}','authenticated','authenticated','phase4-b@example.test',now(),now());`)
})
after(() => { if (created) execFileSync('docker', ['exec', container, 'dropdb', '-U', 'postgres', database]) })
const insert = (id, owner, tenant, customer, type, outcome, date) => `insert into public.collection_actions
  (id,user_id,tenant_id,customer_source_id,action_type,outcome,next_action_date,action_timestamp)
  values ('00000000-0000-4000-8000-${String(id).padStart(12,'0')}','${owner}','${tenant}','${customer}',
    '${type}','${outcome}','${date}','2026-10-01T10:00:00Z');`
const read = `select coalesce(json_agg(r order by action_format),'[]') from
  public.latest_collection_queue_actions('${user}','tenant-a','xero',array['c1','c1','',null]) r;`
const decision = (rows, today) => resolveQueueEligibility({
  v1NextActionDate: rows.find(row => row.action_format === 'v1')?.next_action_date,
  legacyActionType: rows.find(row => row.action_format === 'legacy')?.action_type,
  legacyNextActionDate: rows.find(row => row.action_format === 'legacy')?.next_action_date,
  legacyActionedToday: false, organisationToday: today, legacyToday: today,
  overrideLevel: 'normal', hasActionableOverdueBalance: true, recommendedAction: 'Review now',
})

test('persisted latest V1 and legacy records remain scoped and deterministic through due-date reactivation', { skip: !enabled }, () => {
  const rows = JSON.parse(psql(`begin;
    ${insert(1,user,'tenant-a','c1','outcome','message_sent','2026-10-02')}
    ${insert(2,user,'tenant-a','c1','outcome','reviewed_no_chase','2026-10-03')}
    ${insert(3,user,'tenant-a','c1','postponed','no_response','2026-10-04')}
    ${insert(4,other,'tenant-a','c1','outcome','message_sent','2026-11-01')}
    ${insert(5,user,'tenant-b','c1','outcome','message_sent','2026-11-01')}
    ${insert(6,user,'tenant-a','c2','outcome','message_sent','2026-11-01')}
    ${read} rollback;`))
  assert.equal(rows.length, 2)
  assert.equal(rows.find(row => row.action_format === 'v1').id, '00000000-0000-4000-8000-000000000002')
  assert.deepEqual(decision(rows,'2026-10-01'), { eligible:false, reason:'v1_deferred', nextReturnDate:'2026-10-04' })
  assert.deepEqual(decision(rows,'2026-10-03'), { eligible:false, reason:'legacy_postponed', nextReturnDate:'2026-10-04' })
  assert.deepEqual(decision(rows,'2026-10-04'), { eligible:true, reason:'eligible', nextReturnDate:null })
})

test('legacy promised-to-pay remains history, not a current Promise or future deferral', { skip: !enabled }, () => {
  const rows = JSON.parse(psql(`begin;
    ${insert(7,user,'tenant-a','c1','called','promised_to_pay','2026-11-01')}
    ${read} rollback;`))
  assert.equal(rows[0].outcome, 'promised_to_pay')
  assert.deepEqual(decision(rows,'2026-10-02'), { eligible:true, reason:'eligible', nextReturnDate:null })
})

test('persisted queue read is provider-scoped and service-only; canonical customer fields cannot supply stored scores', { skip: !enabled }, () => {
  assert.equal(psql(`select has_function_privilege('authenticated',
    'public.latest_collection_queue_actions(uuid,text,text,text[])','execute');`), 'f')
  assert.equal(psql(`select has_function_privilege('service_role',
    'public.latest_collection_queue_actions(uuid,text,text,text[])','execute');`), 't')
  const result = psql(`begin;${insert(8,user,'tenant-a','c1','outcome','message_sent','2026-10-02')}
    select count(*) from public.latest_collection_queue_actions('${user}','tenant-a','other',array['c1']);rollback;`)
  assert.equal(result, '0')
  assert.equal(psql(`select count(*) from information_schema.columns where table_schema='public'
    and table_name in ('canonical_customers','collection_actions','customer_overrides')
    and column_name in ('priority_score','base_score','final_score','risk_score','collectible_overdue_base','customer_to_chase_overdue_base');`), '0')
})
