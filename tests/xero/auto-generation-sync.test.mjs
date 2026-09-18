import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const ROUTE_PATH = new URL('../../app/api/xero/sync/auto/route.ts', import.meta.url)

function nextServerMock() {
  return {
    NextResponse: {
      json(body, init = {}) {
        return new Response(JSON.stringify(body), {
          status: init.status ?? 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    },
  }
}

function createHarness({
  syncDelayMs = 0,
  withinCooldown = false,
  lastSyncedAt = '2026-09-16T12:00:00Z',
  latestRunStatus = 'failed',
} = {}) {
  let locked = false
  const syncCalls = []
  const supabaseAdmin = {
    from(table) {
      const query = {
        select() { return query },
        eq() { return query },
        order() {
          assert.equal(table, 'xero_connections_public')
          return Promise.resolve({
            data: [{
              tenant_id: 'tenant-1',
              auth_state: 'active',
              updated_at: '2026-09-16T12:00:00Z',
              last_auto_sync_triggered_at: null,
            }],
            error: null,
          })
        },
        maybeSingle() {
          if (table === 'xero_sync_tenant_state') {
            return Promise.resolve({ data: { latest_sync_run_id: 'run-failed' }, error: null })
          }
          if (table === 'xero_sync_runs') {
            return Promise.resolve({
              data: {
                status: latestRunStatus,
                lease_expires_at: '2026-09-17T10:00:00Z',
              },
              error: null,
            })
          }
          throw new Error(`unexpected maybeSingle table ${table}`)
        },
      }
      return query
    },
    async rpc(functionName) {
      if (functionName === 'acquire_xero_tenant_auto_sync_lock') {
        if (locked) return { data: false, error: null }
        locked = true
        return { data: true, error: null }
      }
      if (functionName === 'release_xero_tenant_auto_sync_lock') {
        locked = false
        return { data: true, error: null }
      }
      throw new Error(`unexpected RPC ${functionName}`)
    },
  }
  const route = loadTypeScriptModule(ROUTE_PATH, {
    mocks: {
      'next/server': nextServerMock(),
      '@/lib/supabase-server': {
        async createServerSupabaseClient() {
          return { auth: { async getUser() { return { data: { user: { id: 'user-1' } }, error: null } } } }
        },
      },
      '@/lib/supabase-admin': { createSupabaseAdminClient: () => supabaseAdmin },
      '@/lib/xero/auto-sync': {
        XERO_AUTO_SYNC_LOCK_TTL_SECONDS: 180,
        XERO_AUTO_SYNC_STALE_MINUTES: 60,
        isXeroDataStale: () => true,
        isWithinXeroAutoSyncCooldown: () => withinCooldown,
      },
      '@/lib/xero/sync': {
        parseTenantId(value) { return typeof value === 'string' && value ? value : null },
      },
      '@/lib/billing/entitlements': {
        async claimActionsEntitlementStatus() {
          return { hasActionsAccess: true, tenantId: 'tenant-1' }
        },
      },
      '@/lib/xero/authoritative-snapshot': {
        async resolveXeroAuthoritativeSnapshot() {
          return lastSyncedAt
            ? { mode: 'generation', syncRunId: 'generation-a', lastSuccessfulSyncAt: lastSyncedAt }
            : { mode: 'legacy', syncRunId: null, lastSuccessfulSyncAt: null }
        },
        async loadXeroAuthoritativeFreshness() { return lastSyncedAt },
        toXeroSnapshotReference(snapshot) {
          return { mode: snapshot.mode, syncRunId: snapshot.syncRunId }
        },
      },
      '@/lib/xero/generation-sync': {
        async syncXeroAuthoritatively(params) {
          syncCalls.push(params)
          if (syncDelayMs) await new Promise((resolve) => setTimeout(resolve, syncDelayMs))
          return new Response(JSON.stringify({
            ok: true,
            lastSyncedAt: '2026-09-16T13:00:00Z',
            snapshot: { mode: 'generation', syncRunId: 'generation-b' },
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        },
      },
    },
  })
  return { route, syncCalls }
}

function request(overrides = {}) {
  return new Request('http://localhost/api/xero/sync/auto', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tenantId: 'tenant-1', surface: 'dashboard', ...overrides }),
  })
}

test('Dashboard auto-sync uses authoritative generation sync and reports the promoted snapshot', async () => {
  const harness = createHarness()
  const response = await harness.route.POST(request())
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.triggered, true)
  assert.equal(payload.syncSucceeded, true)
  assert.equal(payload.lastSyncedAt, '2026-09-16T13:00:00Z')
  assert.deepEqual(payload.snapshot, { mode: 'generation', syncRunId: 'generation-b' })
  assert.equal(harness.syncCalls.length, 1)
})

test('two Dashboard requests cannot start two same-tenant generation imports', async () => {
  const harness = createHarness({ syncDelayMs: 100 })
  const first = harness.route.POST(request())
  await new Promise((resolve) => setTimeout(resolve, 10))
  const second = harness.route.POST(request())
  const [firstResponse, secondResponse] = await Promise.all([first, second])
  const firstPayload = await firstResponse.json()
  const secondPayload = await secondResponse.json()

  assert.equal(firstPayload.syncSucceeded, true)
  assert.equal(secondPayload.reason, 'auto_sync_in_progress')
  assert.equal(harness.syncCalls.length, 1)
})

test('focused retry bypasses cooldown only for a failed first preparation', async () => {
  const harness = createHarness({ withinCooldown: true, lastSyncedAt: null })
  const response = await harness.route.POST(request({ surface: 'start', retry: true }))
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.triggered, true)
  assert.equal(harness.syncCalls.length, 1)
})

test('ordinary observation cannot bypass the server cooldown', async () => {
  const harness = createHarness({ withinCooldown: true, lastSyncedAt: null })
  const response = await harness.route.POST(request({ surface: 'start' }))
  const payload = await response.json()

  assert.equal(payload.triggered, false)
  assert.equal(payload.reason, 'auto_sync_cooldown_active')
  assert.equal(harness.syncCalls.length, 0)
})
