import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../../supabase/migrations/20260915060609_xero_sync_generation_contract.sql',
  import.meta.url
)
const liveSyncUrl = new URL('../../lib/xero/sync.ts', import.meta.url)
const collectionsSummaryUrl = new URL('../../lib/collections/customer-summary.ts', import.meta.url)

async function readMigration() {
  return (await readFile(migrationUrl, 'utf8')).toLowerCase()
}

test('generation migration is additive and leaves legacy live conflict targets intact', async () => {
  const [sql, liveSync] = await Promise.all([
    readMigration(),
    readFile(liveSyncUrl, 'utf8'),
  ])

  for (const table of [
    'xero_raw',
    'canonical_organisations',
    'canonical_customers',
    'canonical_invoices',
    'canonical_payments',
  ]) {
    assert.match(
      sql,
      new RegExp(`alter table public\\.${table}[\\s\\S]*?add column sync_run_id uuid`)
    )
    assert.match(sql, new RegExp(`create unique index idx_${table}_generation_source`))
  }

  assert.doesNotMatch(sql, /drop constraint/)
  assert.doesNotMatch(sql, /alter column sync_run_id set not null/)
  assert.doesNotMatch(sql, /update public\.(xero_raw|canonical_)/)
  assert.match(liveSync, /onConflict: 'user_id,tenant_id,resource_type,source_id'/)
  assert.doesNotMatch(liveSync, /xero_sync_runs|sync_run_id/)
})

test('tenant state, runs, and manifest establish a versioned fenced lifecycle', async () => {
  const sql = await readMigration()

  for (const table of [
    'xero_sync_tenant_state',
    'xero_sync_runs',
    'xero_sync_run_steps',
  ]) {
    assert.match(sql, new RegExp(`create table public\\.${table}\\s*\\(`))
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`))
  }

  assert.match(sql, /current_fencing_token bigint not null default 0/)
  assert.match(sql, /unique \(user_id, tenant_id, fencing_token\)/)
  assert.match(sql, /status in \('running', 'succeeded', 'failed', 'abandoned'\)/)
  assert.match(sql, /scope_version = 'collections_v1'/)
  for (const step of [
    'organisation',
    'contacts',
    'authorised_accrec_invoices',
    'paid_accrec_invoices',
    'authorised_accrec_payments',
    'canonical_mapping',
    'validation',
  ]) {
    assert.match(sql, new RegExp(`'${step}'`))
  }

  assert.match(sql, /terminal xero sync runs are immutable/)
  assert.match(sql, /active_sync_run_id/)
  assert.match(sql, /latest_sync_run_id/)
  assert.match(sql, /last_successful_sync_at/)
})

test('all run mutations are fenced service-role-only SECURITY DEFINER functions', async () => {
  const sql = await readMigration()
  const functions = [
    'acquire_xero_sync_run\\(uuid, text, uuid, text, integer\\)',
    'heartbeat_xero_sync_run\\(uuid, uuid, bigint, integer\\)',
    'complete_xero_sync_run_step\\(uuid, uuid, bigint, text, bigint\\)',
    'fail_xero_sync_run\\(uuid, uuid, bigint, text, text\\)',
    'abandon_xero_sync_run\\(uuid, uuid, bigint, text\\)',
    'promote_xero_sync_run\\(uuid, uuid, bigint, timestamptz\\)',
  ]

  for (const signature of functions) {
    assert.match(sql, new RegExp(
      `revoke all on function public\\.${signature}[\\s\\S]*?from public, anon, authenticated, service_role`
    ))
    assert.match(sql, new RegExp(
      `grant execute on function public\\.${signature}[\\s\\S]*?to service_role`
    ))
  }

  const securityDefinerCount = (sql.match(/^security definer$/gm) ?? []).length
  const fixedSearchPathCount = (
    sql.match(/^set search_path = pg_catalog, public$/gm) ?? []
  ).length
  assert.equal(securityDefinerCount, 6)
  assert.equal(fixedSearchPathCount, 8)

  assert.match(
    sql,
    /grant select on table[\s\S]*xero_sync_tenant_state[\s\S]*xero_sync_runs[\s\S]*xero_sync_run_steps[\s\S]*to service_role/
  )
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*xero_sync_(tenant_state|runs|run_steps)/)
  assert.doesNotMatch(sql, /grant [^;]*xero_sync_(tenant_state|runs|run_steps)[^;]*to (anon|authenticated)/)
})

test('promotion validates current ownership and the complete required-step manifest', async () => {
  const sql = await readMigration()

  assert.match(sql, /v_state\.latest_sync_run_id is distinct from p_sync_run_id/)
  assert.match(sql, /v_state\.current_fencing_token <> p_fencing_token/)
  assert.match(sql, /v_run\.lease_owner <> p_lease_owner/)
  assert.match(sql, /v_run\.lease_expires_at <= v_now/)
  assert.match(sql, /count\(\*\) = cardinality\(v_run\.required_steps\)/)
  assert.match(sql, /'manifest_incomplete'/)
  assert.match(sql, /set status = 'succeeded'/)
  assert.match(sql, /set active_sync_run_id = p_sync_run_id/)
  assert.match(sql, /last_successful_sync_at = v_now/)
})

test('application readers and unrelated product contracts remain generation-unaware', async () => {
  const [liveSync, collectionsSummary] = await Promise.all([
    readFile(liveSyncUrl, 'utf8'),
    readFile(collectionsSummaryUrl, 'utf8'),
  ])

  assert.doesNotMatch(liveSync, /acquire_xero_sync_run|promote_xero_sync_run|sync_run_id/)
  assert.doesNotMatch(collectionsSummary, /active_sync_run_id|sync_run_id/)
})
