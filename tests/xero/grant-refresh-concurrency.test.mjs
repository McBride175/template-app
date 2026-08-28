import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  buildBaseSyncState,
  createSyncHarness,
  sleep,
} from './test-helpers/xero-sync-harness.mjs'

const SYNC_LIB_PATH = new URL('../../lib/xero/sync.ts', import.meta.url)
const CALLBACK_ROUTE_PATH = new URL('../../app/api/xero/callback/route.ts', import.meta.url)
const MIGRATION_PATH = new URL(
  '../../supabase/migrations/20260813205201_baseline_current_schema.sql',
  import.meta.url
)

test('grant-scoped locking primitives are present and tenant-scoped lock functions are removed', async () => {
  const migrationSql = await readFile(MIGRATION_PATH, 'utf8')

  assert.match(migrationSql, /create function public\.acquire_xero_grant_refresh_lock\(/)
  assert.match(migrationSql, /create function public\.release_xero_grant_refresh_lock\(/)
  assert.doesNotMatch(migrationSql, /function public\.acquire_xero_refresh_lock\(/)
  assert.doesNotMatch(migrationSql, /function public\.release_xero_refresh_lock\(/)
})

test('sync flow uses grant-scoped lock RPCs and shared grant token persistence', async () => {
  const syncRoute = await readFile(SYNC_LIB_PATH, 'utf8')

  assert.match(syncRoute, /acquire_xero_grant_refresh_lock/)
  assert.match(syncRoute, /release_xero_grant_refresh_lock/)
  assert.match(syncRoute, /\.from\('xero_oauth_grants'\)\s*\.update\(\{[\s\S]*refresh_token_encrypted:/)
  assert.doesNotMatch(syncRoute, /acquire_xero_refresh_lock/)
  assert.doesNotMatch(syncRoute, /release_xero_refresh_lock/)
})

test('callback upsert does not reset refresh lock columns', async () => {
  const callbackRoute = await readFile(CALLBACK_ROUTE_PATH, 'utf8')
  const grantUpsertBlockMatch = callbackRoute.match(
    /\.from\('xero_oauth_grants'\)[\s\S]*?\.upsert\(([\s\S]*?)\)\s*\.select\('id'\)/
  )

  assert.ok(grantUpsertBlockMatch, 'Expected xero_oauth_grants upsert block in callback route')
  const upsertBlock = grantUpsertBlockMatch[1]
  assert.doesNotMatch(upsertBlock, /refresh_lock_id/)
  assert.doesNotMatch(upsertBlock, /refresh_lock_acquired_at/)
  assert.doesNotMatch(upsertBlock, /refresh_lock_expires_at/)
})

test('same-tenant concurrent sync executes refresh once and avoids duplicate rotation', async () => {
  const state = buildBaseSyncState()
  const userId = 'user-1'
  const tenantId = 'tenant-1'
  const grantId = 'grant-1'
  state.connections.push({
    user_id: userId,
    tenant_id: tenantId,
    grant_id: grantId,
    auth_state: 'active',
    last_refresh_error: null,
    reauth_required_at: null,
  })
  state.grants.push({
    id: grantId,
    user_id: userId,
    xero_user_id: 'xero-user-1',
    scopes: ['accounting.transactions'],
    access_token_encrypted: 'old-access-token',
    refresh_token_encrypted: 'old-refresh-token',
    expires_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    refresh_lock_id: null,
    refresh_lock_expires_at: null,
  })

  const harness = createSyncHarness({
    syncModuleSpecifier: SYNC_LIB_PATH,
    state,
    async refreshBehavior({ callCount }) {
      await sleep(75)
      return {
        accessToken: `new-access-${callCount}`,
        refreshToken: `new-refresh-${callCount}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }
    },
  })

  const [first, second] = await Promise.all([
    harness.syncXeroTenantForUser({ userId, tenantId }),
    harness.syncXeroTenantForUser({ userId, tenantId }),
  ])

  assert.equal(harness.refreshCalls.length, 1, 'expected exactly one token refresh under contention')
  assert.equal(first.status, 200)
  assert.equal(second.status, 200)

  const grant = state.grants.find((row) => row.id === grantId)
  assert.equal(grant?.refresh_token_encrypted, 'new-refresh-1')
})

test('cross-tenant concurrent sync sharing one grant refreshes once and both complete', async () => {
  const state = buildBaseSyncState()
  const userId = 'user-1'
  const grantId = 'grant-1'
  const tenantA = 'tenant-a'
  const tenantB = 'tenant-b'
  state.connections.push(
    {
      user_id: userId,
      tenant_id: tenantA,
      grant_id: grantId,
      auth_state: 'active',
      last_refresh_error: null,
      reauth_required_at: null,
    },
    {
      user_id: userId,
      tenant_id: tenantB,
      grant_id: grantId,
      auth_state: 'active',
      last_refresh_error: null,
      reauth_required_at: null,
    }
  )
  state.grants.push({
    id: grantId,
    user_id: userId,
    xero_user_id: 'xero-user-1',
    scopes: ['accounting.transactions'],
    access_token_encrypted: 'old-access-token',
    refresh_token_encrypted: 'old-refresh-token',
    expires_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    refresh_lock_id: null,
    refresh_lock_expires_at: null,
  })

  const harness = createSyncHarness({
    syncModuleSpecifier: SYNC_LIB_PATH,
    state,
    async refreshBehavior({ callCount }) {
      await sleep(75)
      return {
        accessToken: `shared-access-${callCount}`,
        refreshToken: `shared-refresh-${callCount}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }
    },
  })

  const [a, b] = await Promise.all([
    harness.syncXeroTenantForUser({ userId, tenantId: tenantA }),
    harness.syncXeroTenantForUser({ userId, tenantId: tenantB }),
  ])

  assert.equal(harness.refreshCalls.length, 1, 'shared grant should refresh once')
  assert.equal(a.status, 200)
  assert.equal(b.status, 200)

  const grant = state.grants.find((row) => row.id === grantId)
  assert.equal(grant?.access_token_encrypted, 'shared-access-1')
  assert.equal(grant?.refresh_token_encrypted, 'shared-refresh-1')
})

test('refresh race under grant lock reloads winner token state and completes sync', async () => {
  const state = buildBaseSyncState()
  const userId = 'user-1'
  const tenantId = 'tenant-1'
  const grantId = 'grant-1'
  state.connections.push({
    user_id: userId,
    tenant_id: tenantId,
    grant_id: grantId,
    auth_state: 'active',
    last_refresh_error: null,
    reauth_required_at: null,
  })
  state.grants.push({
    id: grantId,
    user_id: userId,
    xero_user_id: 'xero-user-1',
    scopes: ['accounting.transactions'],
    access_token_encrypted: 'old-access-token',
    refresh_token_encrypted: 'old-refresh-token',
    expires_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    refresh_lock_id: null,
    refresh_lock_expires_at: null,
  })

  const harness = createSyncHarness({
    syncModuleSpecifier: SYNC_LIB_PATH,
    state,
    async refreshBehavior() {
      const grant = state.grants.find((row) => row.id === grantId)
      if (!grant) throw new Error('missing grant')
      grant.refresh_lock_id = 'other-lock-holder'
      grant.access_token_encrypted = 'winner-access-token'
      grant.refresh_token_encrypted = 'winner-refresh-token'
      grant.expires_at = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      return {
        accessToken: 'stale-loser-access-token',
        refreshToken: 'stale-loser-refresh-token',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }
    },
  })

  const response = await harness.syncXeroTenantForUser({ userId, tenantId })
  const payload = await response.json()
  const grant = state.grants.find((row) => row.id === grantId)
  const connection = state.connections.find((row) => row.user_id === userId && row.tenant_id === tenantId)

  assert.equal(response.status, 200)
  assert.equal(payload.ok, true)
  assert.equal(harness.refreshCalls.length, 1)
  assert.equal(grant?.access_token_encrypted, 'winner-access-token')
  assert.equal(grant?.refresh_token_encrypted, 'winner-refresh-token')
  assert.equal(connection?.auth_state, 'active')
  assert.equal(connection?.last_refresh_error, null)
  assert.equal(
    harness.fetchCalls.every((call) => call.accessToken === 'winner-access-token'),
    true,
    'sync should fetch resources using the winner token after a refresh race'
  )
})

test('transient refresh failure keeps auth active and remains retryable', async () => {
  const state = buildBaseSyncState()
  const userId = 'user-1'
  const tenantId = 'tenant-1'
  const grantId = 'grant-1'
  state.connections.push({
    user_id: userId,
    tenant_id: tenantId,
    grant_id: grantId,
    auth_state: 'active',
    last_refresh_error: null,
    reauth_required_at: null,
  })
  state.grants.push({
    id: grantId,
    user_id: userId,
    xero_user_id: 'xero-user-1',
    scopes: ['accounting.transactions'],
    access_token_encrypted: 'old-access-token',
    refresh_token_encrypted: 'old-refresh-token',
    expires_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    refresh_lock_id: null,
    refresh_lock_expires_at: null,
  })

  let TokenRefreshError = null
  const harness = createSyncHarness({
    syncModuleSpecifier: SYNC_LIB_PATH,
    state,
    async refreshBehavior({ callCount }) {
      if (callCount === 1) {
        throw new TokenRefreshError({
          status: 503,
          code: 'temporarily_unavailable',
          description: 'provider timeout',
          requiresReauth: false,
        })
      }
      return {
        accessToken: 'recovered-access-token',
        refreshToken: 'recovered-refresh-token',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }
    },
  })
  TokenRefreshError = harness.XeroTokenRefreshError

  const firstResponse = await harness.syncXeroTenantForUser({ userId, tenantId })
  const firstPayload = await firstResponse.json()
  const connectionAfterFailure = state.connections.find(
    (row) => row.user_id === userId && row.tenant_id === tenantId
  )

  assert.equal(firstResponse.status, 502)
  assert.equal(firstPayload.code, 'XERO_REFRESH_FAILED')
  assert.equal(firstPayload.authState, 'active')
  assert.equal(firstPayload.retryable, true)
  assert.equal(connectionAfterFailure?.auth_state, 'active')
  assert.equal(connectionAfterFailure?.last_refresh_error, 'refresh_failed')

  const secondResponse = await harness.syncXeroTenantForUser({ userId, tenantId })
  const secondPayload = await secondResponse.json()
  const connectionAfterRetry = state.connections.find((row) => row.user_id === userId && row.tenant_id === tenantId)

  assert.equal(secondResponse.status, 200)
  assert.equal(secondPayload.ok, true)
  assert.equal(harness.refreshCalls.length, 2)
  assert.equal(connectionAfterRetry?.auth_state, 'active')
  assert.equal(connectionAfterRetry?.last_refresh_error, null)
})

test('definitive refresh auth failure moves grant connections to reauth_required', async () => {
  const state = buildBaseSyncState()
  const userId = 'user-1'
  const tenantId = 'tenant-1'
  const grantId = 'grant-1'
  state.connections.push({
    user_id: userId,
    tenant_id: tenantId,
    grant_id: grantId,
    auth_state: 'active',
    last_refresh_error: null,
    reauth_required_at: null,
  })
  state.grants.push({
    id: grantId,
    user_id: userId,
    xero_user_id: 'xero-user-1',
    scopes: ['accounting.transactions'],
    access_token_encrypted: 'old-access-token',
    refresh_token_encrypted: 'old-refresh-token',
    expires_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    refresh_lock_id: null,
    refresh_lock_expires_at: null,
  })

  let TokenRefreshError = null
  const harness = createSyncHarness({
    syncModuleSpecifier: SYNC_LIB_PATH,
    state,
    async refreshBehavior() {
      throw new TokenRefreshError({
        status: 400,
        code: 'invalid_grant',
        description: 'The refresh token is invalid or revoked.',
        requiresReauth: true,
      })
    },
  })
  TokenRefreshError = harness.XeroTokenRefreshError

  const response = await harness.syncXeroTenantForUser({ userId, tenantId })
  const payload = await response.json()
  const connection = state.connections.find((row) => row.user_id === userId && row.tenant_id === tenantId)
  const grant = state.grants.find((row) => row.id === grantId)

  assert.equal(response.status, 409)
  assert.equal(payload.code, 'XERO_REAUTH_REQUIRED')
  assert.equal(payload.authState, 'reauth_required')
  assert.equal(payload.reauthRequired, true)
  assert.equal(connection?.auth_state, 'reauth_required')
  assert.equal(connection?.last_refresh_error, 'refresh_token_invalid')
  assert.ok(connection?.reauth_required_at, 'reauth timestamp should be recorded for definitive auth failures')
  assert.equal(grant?.access_token_encrypted, null)
  assert.equal(grant?.expires_at, null)
})
