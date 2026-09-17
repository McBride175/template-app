import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const SCHEDULED_SYNC_LIB_PATH = new URL('../../lib/xero/scheduled-sync.ts', import.meta.url)
const STALE_AWARE_MIGRATION_PATH = new URL(
  '../../supabase/migrations/20260813205201_baseline_current_schema.sql',
  import.meta.url
)

test('scheduled sync resolves authoritative freshness after coarse SQL discovery', async () => {
  const scheduledSyncSource = await readFile(SCHEDULED_SYNC_LIB_PATH, 'utf8')

  assert.match(scheduledSyncSource, /XERO_AUTO_SYNC_STALE_MINUTES/)
  assert.match(scheduledSyncSource, /XERO_SCHEDULED_SYNC_STALE_MINUTES/)
  assert.match(scheduledSyncSource, /p_stale_minutes:\s*DISCOVERY_STALE_MINUTES/)
  assert.match(scheduledSyncSource, /resolveXeroAuthoritativeSnapshot/)
  assert.match(scheduledSyncSource, /loadXeroAuthoritativeFreshness/)
  assert.match(scheduledSyncSource, /isXeroDataStale\(authoritativeLastSyncedAt, Date\.now\(\), config\.staleMinutes\)/)
  assert.match(scheduledSyncSource, /syncXeroAuthoritatively/)
  assert.doesNotMatch(scheduledSyncSource, /syncXeroTenantForUser/)
})

test('scheduled sync candidate SQL filters out fresh tenants', async () => {
  const migrationSql = await readFile(STALE_AWARE_MIGRATION_PATH, 'utf8')

  assert.match(migrationSql, /p_stale_minutes integer default 60/)
  assert.match(migrationSql, /left join lateral/)
  assert.match(migrationSql, /max\(raw\.fetched_at\) as last_synced_at/)
  assert.match(migrationSql, /latest_raw\.last_synced_at is null/)
  assert.match(migrationSql, /latest_raw\.last_synced_at <= now\(\) - make_interval\(/)
})

test('scheduled execution ignores raw freshness and syncs only authoritative stale snapshots', async () => {
  const previousEnabled = process.env.XERO_SCHEDULED_SYNC_ENABLED
  const previousInterval = process.env.XERO_SCHEDULED_SYNC_MIN_INTERVAL_MINUTES
  process.env.XERO_SCHEDULED_SYNC_ENABLED = 'true'
  process.env.XERO_SCHEDULED_SYNC_MIN_INTERVAL_MINUTES = '1'

  const syncCalls = []
  const rpcCalls = []
  const supabaseAdmin = {
    async rpc(functionName, args) {
      rpcCalls.push([functionName, args])
      if (functionName === 'acquire_xero_scheduled_sync_run_lock') return { data: true, error: null }
      if (functionName === 'list_xero_scheduled_sync_candidates') {
        return {
          data: [
            { user_id: 'user-1', tenant_id: 'fresh', last_sign_in_at: '2026-09-16T12:00:00Z', connection_updated_at: '2026-09-16T12:00:00Z', last_synced_at: '1999-01-01T00:00:00Z' },
            { user_id: 'user-1', tenant_id: 'stale', last_sign_in_at: '2026-09-16T12:00:00Z', connection_updated_at: '2026-09-16T12:00:00Z', last_synced_at: '2026-09-16T12:59:59Z' },
          ],
          error: null,
        }
      }
      if (functionName === 'acquire_xero_tenant_auto_sync_lock') return { data: true, error: null }
      if (functionName === 'release_xero_tenant_auto_sync_lock') return { data: true, error: null }
      if (functionName === 'release_xero_scheduled_sync_run_lock') return { data: true, error: null }
      throw new Error(`unexpected RPC ${functionName}`)
    },
  }
  const scheduled = loadTypeScriptModule(SCHEDULED_SYNC_LIB_PATH, {
    mocks: {
      'next/server': {
        NextResponse: {
          json(body, init = {}) {
            return new Response(JSON.stringify(body), {
              status: init.status ?? 200,
              headers: { 'content-type': 'application/json' },
            })
          },
        },
      },
      '@/lib/supabase-admin': { createSupabaseAdminClient: () => supabaseAdmin },
      '@/lib/xero/auto-sync': {
        XERO_AUTO_SYNC_LOCK_TTL_SECONDS: 180,
        XERO_AUTO_SYNC_STALE_MINUTES: 60,
        isXeroDataStale(lastSyncedAt, nowMs, staleMinutes) {
          return !lastSyncedAt || nowMs - Date.parse(lastSyncedAt) >= staleMinutes * 60_000
        },
      },
      '@/lib/xero/authoritative-snapshot': {
        async resolveXeroAuthoritativeSnapshot({ userId, tenantId }) {
          return { mode: 'generation', syncRunId: `run-${tenantId}`, userId, tenantId }
        },
        async loadXeroAuthoritativeFreshness({ snapshot }) {
          return snapshot.tenantId === 'fresh'
            ? new Date(Date.now() - 10 * 60_000).toISOString()
            : new Date(Date.now() - 2 * 60 * 60_000).toISOString()
        },
        toXeroSnapshotReference(snapshot) {
          return { mode: snapshot.mode, syncRunId: snapshot.syncRunId }
        },
      },
      '@/lib/xero/generation-sync': {
        async syncXeroAuthoritatively(params) {
          syncCalls.push(params)
          return new Response(JSON.stringify({ ok: true, code: 'XERO_GENERATION_PROMOTED' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        },
      },
    },
  })

  try {
    const response = await scheduled.runScheduledXeroSyncJob()
    const payload = await response.json()
    assert.equal(response.status, 200)
    assert.equal(payload.synced, 1)
    assert.deepEqual(syncCalls.map((call) => call.tenantId), ['stale'])
    const discovery = rpcCalls.find(([name]) => name === 'list_xero_scheduled_sync_candidates')
    assert.equal(discovery[1].p_stale_minutes, 1)
    assert.equal(discovery[1].p_limit, 200)
  } finally {
    if (typeof previousEnabled === 'string') process.env.XERO_SCHEDULED_SYNC_ENABLED = previousEnabled
    else delete process.env.XERO_SCHEDULED_SYNC_ENABLED
    if (typeof previousInterval === 'string') process.env.XERO_SCHEDULED_SYNC_MIN_INTERVAL_MINUTES = previousInterval
    else delete process.env.XERO_SCHEDULED_SYNC_MIN_INTERVAL_MINUTES
  }
})
