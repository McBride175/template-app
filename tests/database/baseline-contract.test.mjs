import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationsUrl = new URL('../../supabase/migrations/', import.meta.url)
const legacyMigrationsUrl = new URL('../../supabase/migrations_legacy/', import.meta.url)
const contactRouteUrl = new URL('../../app/api/contact/route.ts', import.meta.url)
const billingEntitlementsUrl = new URL('../../lib/billing/entitlements.ts', import.meta.url)
const baselineMigrationName = '20260813205201_baseline_current_schema.sql'
const migrationNamePattern = /^(\d{14})_[a-z0-9_]+\.sql$/

async function readMigrationNames(directoryUrl) {
  return (await readdir(directoryUrl))
    .filter((name) => name.endsWith('.sql'))
    .sort()
}

async function readBaseline() {
  return (await readFile(new URL(baselineMigrationName, migrationsUrl), 'utf8')).toLowerCase()
}

test('active migration chain starts with one canonical baseline and ordered forward migrations', async () => {
  const migrationNames = await readMigrationNames(migrationsUrl)
  const baselineNames = migrationNames
    .filter((name) => /^\d{14}_baseline_current_schema\.sql$/.test(name))

  assert.deepEqual(baselineNames, [baselineMigrationName])
  assert.equal(migrationNames[0], baselineMigrationName)

  const timestampedMigrations = migrationNames.map((name) => {
    const match = name.match(migrationNamePattern)
    assert.ok(match, `Active migration must use a 14-digit timestamp: ${name}`)
    return { name, timestamp: match[1] }
  })
  const uniqueTimestamps = new Set(timestampedMigrations.map(({ timestamp }) => timestamp))
  assert.equal(uniqueTimestamps.size, timestampedMigrations.length)

  const baselineTimestamp = baselineMigrationName.slice(0, 14)
  for (const { name, timestamp } of timestampedMigrations.slice(1)) {
    assert.ok(
      timestamp > baselineTimestamp,
      `Forward migration must be later than the canonical baseline: ${name}`
    )
  }
})

test('legacy SQL remains archived outside the active migration directory', async () => {
  const [activeNames, legacyNames] = await Promise.all([
    readMigrationNames(migrationsUrl),
    readMigrationNames(legacyMigrationsUrl),
  ])

  assert.equal(legacyNames.length, 25)
  assert.ok(legacyNames.includes('20260127182739_make_current_period_end_nullable.sql'))
  assert.ok(legacyNames.includes('20260603120000_create_billing_usage_days.sql'))
  assert.deepEqual(activeNames.filter((name) => legacyNames.includes(name)), [])
})

test('baseline contains the complete final table set', async () => {
  const sql = await readBaseline()
  const expectedTables = [
    'subscriptions',
    'stripe_customers',
    'notes',
    'support_tickets',
    'user_privacy_preferences',
    'privacy_requests',
    'privacy_request_events',
    'privacy_exports',
    'xero_raw',
    'canonical_customers',
    'canonical_invoices',
    'canonical_payments',
    'customer_overrides',
    'xero_oauth_grants',
    'xero_connections_public',
    'xero_scheduled_sync_runs',
    'collection_actions',
    'billing_usage_days',
  ]

  for (const table of expectedTables) {
    assert.match(sql, new RegExp(`create table public\\.${table}\\s*\\(`))
  }
})

test('known schema corrections are represented', async () => {
  const sql = await readBaseline()

  assert.match(sql, /current_period_end\s+timestamptz\s*,/)
  assert.doesNotMatch(sql, /current_period_end\s+timestamptz\s+not null/)
  assert.match(sql, /unique\s*\(tenant_id,\s*usage_date\)/)
  assert.match(sql, /alter table public\.billing_usage_days enable row level security/)

  assert.doesNotMatch(sql, /\bsent_at\b/)
  assert.doesNotMatch(sql, /\bresend_message_id\b/)
  assert.doesNotMatch(sql, /\bemail_error\b/)
})

test('support email metadata scaffolding is absent from schema and code', async () => {
  const sql = await readBaseline()
  const contactRoute = (await readFile(contactRouteUrl, 'utf8')).toLowerCase()

  for (const field of ['sent_at', 'resend_message_id', 'email_error']) {
    assert.doesNotMatch(sql, new RegExp(`\\b${field}\\b`))
    assert.doesNotMatch(contactRoute, new RegExp(`\\b${field}\\b`))
  }
})

test('billing uses the canonical table and fails closed without legacy schema fallbacks', async () => {
  const billingSource = await readFile(billingEntitlementsUrl, 'utf8')

  assert.match(billingSource, /\.from\('billing_usage_days'\)/)
  assert.match(billingSource, /onConflict: 'tenant_id,usage_date'/)
  assert.doesNotMatch(billingSource, /\.from\('xero_connections'\)/)
  assert.doesNotMatch(billingSource, /isMissingRelationError/)
})

test('baseline contains only final-state Xero structures', async () => {
  const sql = await readBaseline()

  assert.doesNotMatch(sql, /create table public\.xero_connections\s*\(/)
  assert.doesNotMatch(sql, /create table public\.xero_connection_secrets\s*\(/)
  assert.doesNotMatch(sql, /function public\.set_updated_at_xero_connections\s*\(/)
  assert.doesNotMatch(sql, /function public\.acquire_xero_refresh_lock\s*\(/)

  assert.match(sql, /function public\.acquire_xero_grant_refresh_lock\s*\(/)
  assert.match(sql, /function public\.acquire_xero_tenant_auto_sync_lock\s*\(/)
  assert.match(sql, /function public\.acquire_xero_scheduled_sync_run_lock\s*\(/)
  assert.match(sql, /function public\.list_xero_scheduled_sync_candidates\s*\([\s\S]*p_stale_minutes/)
})

test('internal scheduler state and elevated functions are hardened', async () => {
  const sql = await readBaseline()
  const securityDefinerCount = (sql.match(/^\s*security definer\s*$/gm) ?? []).length
  const safeSearchPathCount = (sql.match(/^\s*set search_path = pg_catalog, public\s*$/gm) ?? []).length

  assert.equal(securityDefinerCount, 7)
  assert.equal(safeSearchPathCount, securityDefinerCount)
  assert.match(sql, /alter table public\.xero_scheduled_sync_runs enable row level security/)
  assert.match(sql, /revoke all on table[\s\S]*public\.xero_scheduled_sync_runs[\s\S]*from anon, authenticated/)
  assert.match(sql, /grant select, insert, update, delete on table[\s\S]*public\.xero_scheduled_sync_runs[\s\S]*to service_role/)
  assert.doesNotMatch(sql, /grant [^;]*xero_scheduled_sync_runs[^;]*to authenticated/)
})

test('every application table has RLS enabled', async () => {
  const sql = await readBaseline()
  const createdTables = [...sql.matchAll(/create table public\.([a-z0-9_]+)\s*\(/g)]
    .map((match) => match[1])
    .sort()
  const rlsTables = [...sql.matchAll(/alter table public\.([a-z0-9_]+) enable row level security/g)]
    .map((match) => match[1])
    .sort()

  assert.equal(createdTables.length, 18)
  assert.deepEqual(rlsTables, createdTables)
})
