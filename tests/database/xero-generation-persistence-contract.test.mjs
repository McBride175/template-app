import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../../supabase/migrations/20260915064459_xero_generation_persistence_transition.sql',
  import.meta.url
)

async function readMigration() {
  return (await readFile(migrationUrl, 'utf8')).toLowerCase()
}

test('legacy and generation source identities use complementary partial indexes', async () => {
  const sql = await readMigration()

  for (const table of [
    'xero_raw',
    'canonical_organisations',
    'canonical_customers',
    'canonical_invoices',
    'canonical_payments',
  ]) {
    assert.match(sql, new RegExp(`create unique index idx_${table}_legacy_source`))
  }
  assert.equal((sql.match(/where sync_run_id is null;/g) ?? []).length >= 5, true)
  assert.equal((sql.match(/where sync_run_id is not null/g) ?? []).length >= 2, true)

  for (const constraint of [
    'xero_raw_user_id_tenant_id_resource_type_source_id_key',
    'canonical_organisations_user_id_tenant_id_source_system_sou_key',
    'canonical_customers_user_id_tenant_id_source_system_source__key',
    'canonical_invoices_user_id_tenant_id_source_system_source_i_key',
    'canonical_payments_user_id_tenant_id_source_system_source_i_key',
  ]) {
    assert.match(sql, new RegExp(`drop constraint ${constraint}`))
  }
})

test('all persistence RPCs are fixed-path and service-role-only', async () => {
  const sql = await readMigration()
  const compactSql = sql.replace(/\s+/g, ' ')
  const signatures = [
    'upsert_xero_legacy_raw_batch( uuid, text, text, timestamptz, jsonb )',
    'upsert_xero_generation_raw_batch( uuid, uuid, text, uuid, bigint, text, timestamptz, jsonb )',
    'upsert_xero_legacy_canonical_batch( uuid, text, text, jsonb )',
    'upsert_xero_generation_canonical_batch( uuid, uuid, text, uuid, bigint, text, jsonb )',
  ]

  for (const signature of signatures) {
    assert.ok(
      compactSql.includes(
        `revoke all on function public.${signature} from public, anon, authenticated, service_role`
      )
    )
    assert.ok(
      compactSql.includes(`grant execute on function public.${signature} to service_role`)
    )
  }

  assert.equal((sql.match(/security definer/g) ?? []).length, 4)
  assert.equal((sql.match(/set search_path = pg_catalog, public/g) ?? []).length, 5)
  assert.doesNotMatch(sql, /grant execute[\s\S]*?to (anon|authenticated)/)
})

test('generation writes are fenced and raw invoice identity is stream-independent', async () => {
  const sql = await readMigration()
  const persistence = await readFile(
    new URL('../../lib/xero/persistence.ts', import.meta.url),
    'utf8'
  )

  assert.match(sql, /latest_sync_run_id = p_sync_run_id/)
  assert.match(sql, /current_fencing_token = p_fencing_token/)
  assert.match(sql, /sync_run\.status = 'running'/)
  assert.match(sql, /sync_run\.lease_owner = p_lease_owner/)
  assert.match(sql, /sync_run\.lease_expires_at > v_now/)
  assert.match(sql, /for update of tenant_state, sync_run/)
  assert.match(persistence, /invoices: 'InvoiceID'/)
  assert.doesNotMatch(persistence, /authorised_accrec_invoices.*InvoiceID/)
  assert.doesNotMatch(persistence, /paid_accrec_invoices.*InvoiceID/)
})

test('legacy-only compatibility paths still exclude generated rows', async () => {
  const legacyOnlyFiles = [
    '../../lib/xero/canonical-mapper.ts',
    '../../lib/collections/tenant-context.ts',
    '../../app/api/xero/raw/route.ts',
  ]

  for (const file of legacyOnlyFiles) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8')
    assert.match(source, /\.is\('sync_run_id', null\)/, file)
  }

  const generationAwareFiles = [
    '../../lib/collections/customer-summary.ts',
    '../../lib/collections/currency-context-server.ts',
    '../../app/api/xero/sync/auto/route.ts',
    '../../app/api/xero/status/route.ts',
    '../../app/xero/canonical/customers/page.tsx',
    '../../app/xero/canonical/invoices/page.tsx',
    '../../app/xero/canonical/payments/page.tsx',
  ]
  for (const file of generationAwareFiles) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8')
    assert.match(source, /resolveXeroAuthoritativeSnapshot/, file)
  }
})

test('new generation APIs require explicit run ownership and remain unused by live sync', async () => {
  const [persistence, generationMapper, liveSync] = await Promise.all([
    readFile(new URL('../../lib/xero/persistence.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../lib/xero/generation-mapper.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../lib/xero/sync.ts', import.meta.url), 'utf8'),
  ])

  for (const field of ['syncRunId', 'userId', 'tenantId', 'leaseOwner', 'fencingToken']) {
    assert.match(persistence, new RegExp(`${field}: string|${field}: number`))
    assert.match(generationMapper, new RegExp(`${field}: string|${field}: number`))
  }

  assert.doesNotMatch(liveSync, /persistXeroGeneration|mapXeroGenerationToCanonical/)
  assert.match(liveSync, /persistLegacyXeroRawBatch/)
})
