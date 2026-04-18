import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const MANUAL_SYNC_ROUTE_PATH = new URL('../../app/api/xero/sync/route.ts', import.meta.url)
const INTERNAL_SYNC_ROUTE_PATH = new URL('../../app/api/internal/xero/sync/route.ts', import.meta.url)

test('manual sync route uses tenant auto-sync lock and returns conflict when already locked', async () => {
  const routeSource = await readFile(MANUAL_SYNC_ROUTE_PATH, 'utf8')

  assert.match(routeSource, /acquireXeroTenantSyncLock/)
  assert.match(routeSource, /releaseXeroTenantSyncLock/)
  assert.match(routeSource, /XERO_TENANT_AUTO_SYNC_LOCKED/)
  assert.match(routeSource, /status:\s*409/)
  assert.match(routeSource, /finally[\s\S]*releaseXeroTenantSyncLock/)
})

test('internal sync route uses tenant auto-sync lock and returns conflict when already locked', async () => {
  const routeSource = await readFile(INTERNAL_SYNC_ROUTE_PATH, 'utf8')

  assert.match(routeSource, /acquireXeroTenantSyncLock/)
  assert.match(routeSource, /releaseXeroTenantSyncLock/)
  assert.match(routeSource, /XERO_TENANT_AUTO_SYNC_LOCKED/)
  assert.match(routeSource, /status:\s*409/)
  assert.match(routeSource, /finally[\s\S]*releaseXeroTenantSyncLock/)
})
