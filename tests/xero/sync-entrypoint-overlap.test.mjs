import test from 'node:test'
import assert from 'node:assert/strict'
import { createRouteHarness, sleep } from './test-helpers/xero-sync-harness.mjs'

const MANUAL_SYNC_ROUTE_PATH = new URL('../../app/api/xero/sync/route.ts', import.meta.url)
const INTERNAL_SYNC_ROUTE_PATH = new URL('../../app/api/internal/xero/sync/route.ts', import.meta.url)

function jsonRequest(url, body, headers = {}) {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

test('manual sync returns conflict when tenant lock is already held (auto/scheduled overlap)', async () => {
  const harness = createRouteHarness({
    manualUserId: 'user-1',
  })
  harness.tenantLocks.set('user-1:tenant-1', 'pre-held-lock')

  const manualRoute = harness.loadRoute(MANUAL_SYNC_ROUTE_PATH)
  const response = await manualRoute.POST(
    jsonRequest('http://localhost/api/xero/sync', { tenantId: 'tenant-1' })
  )
  const payload = await response.json()

  assert.equal(response.status, 409)
  assert.equal(payload.code, 'XERO_TENANT_AUTO_SYNC_LOCKED')
  assert.equal(harness.inflightSyncCalls.length, 0)
})

test('manual and internal overlap on same tenant results in one sync and one conflict', async () => {
  const previousSecret = process.env.XERO_SYNC_INTERNAL_SECRET
  process.env.XERO_SYNC_INTERNAL_SECRET = 'test-secret'

  try {
    const harness = createRouteHarness({
      manualUserId: 'user-1',
      syncDelayMs: 120,
    })
    const manualRoute = harness.loadRoute(MANUAL_SYNC_ROUTE_PATH)
    const internalRoute = harness.loadRoute(INTERNAL_SYNC_ROUTE_PATH)

    const manualPromise = manualRoute.POST(
      jsonRequest('http://localhost/api/xero/sync', { tenantId: 'tenant-1' })
    )

    await sleep(10)

    const internalPromise = internalRoute.POST(
      jsonRequest(
        'http://localhost/api/internal/xero/sync',
        { userId: 'user-1', tenantId: 'tenant-1' },
        { authorization: 'Bearer test-secret' }
      )
    )

    const [manualResponse, internalResponse] = await Promise.all([manualPromise, internalPromise])
    const statuses = [manualResponse.status, internalResponse.status].sort((a, b) => a - b)

    assert.deepEqual(statuses, [200, 409])
    assert.equal(harness.inflightSyncCalls.length, 1)
  } finally {
    if (typeof previousSecret === 'string') {
      process.env.XERO_SYNC_INTERNAL_SECRET = previousSecret
    } else {
      delete process.env.XERO_SYNC_INTERNAL_SECRET
    }
  }
})

test('concurrent manual sync requests on same user+tenant do not run duplicate sync work', async () => {
  const harness = createRouteHarness({
    manualUserId: 'user-1',
    syncDelayMs: 120,
  })
  const manualRoute = harness.loadRoute(MANUAL_SYNC_ROUTE_PATH)

  const firstPromise = manualRoute.POST(
    jsonRequest('http://localhost/api/xero/sync', { tenantId: 'tenant-1' })
  )
  await sleep(10)
  const secondPromise = manualRoute.POST(
    jsonRequest('http://localhost/api/xero/sync', { tenantId: 'tenant-1' })
  )

  const [firstResponse, secondResponse] = await Promise.all([firstPromise, secondPromise])
  const statuses = [firstResponse.status, secondResponse.status].sort((a, b) => a - b)

  assert.deepEqual(statuses, [200, 409])
  assert.equal(harness.inflightSyncCalls.length, 1)
})
