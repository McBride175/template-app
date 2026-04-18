import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const SCHEDULED_SYNC_LIB_PATH = new URL('../../lib/xero/scheduled-sync.ts', import.meta.url)
const STALE_AWARE_MIGRATION_PATH = new URL(
  '../../supabase/migrations/20260417213000_make_scheduled_sync_candidates_stale_aware.sql',
  import.meta.url
)

test('scheduled sync passes stale threshold into SQL candidate selection', async () => {
  const scheduledSyncSource = await readFile(SCHEDULED_SYNC_LIB_PATH, 'utf8')

  assert.match(scheduledSyncSource, /XERO_AUTO_SYNC_STALE_MINUTES/)
  assert.match(scheduledSyncSource, /XERO_SCHEDULED_SYNC_STALE_MINUTES/)
  assert.match(scheduledSyncSource, /p_stale_minutes:\s*config\.staleMinutes/)
})

test('scheduled sync candidate SQL filters out fresh tenants', async () => {
  const migrationSql = await readFile(STALE_AWARE_MIGRATION_PATH, 'utf8')

  assert.match(migrationSql, /p_stale_minutes integer default 60/)
  assert.match(migrationSql, /left join lateral/)
  assert.match(migrationSql, /max\(raw\.fetched_at\) as last_synced_at/)
  assert.match(migrationSql, /latest_raw\.last_synced_at is null/)
  assert.match(migrationSql, /latest_raw\.last_synced_at <= now\(\) - make_interval\(/)
})
