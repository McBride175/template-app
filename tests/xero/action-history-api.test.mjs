import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

function route({ error, projectionError = false, currencyAllowed = true } = {}) {
  const calls = []
  class InputError extends Error {}
  class OperationError extends Error { constructor(code) { super(code); this.code = code } }
  const handlers = loadTypeScriptModule('app/api/collections/action-history/route.ts', { mocks: {
    'next/server': { NextResponse: { json: (data, options = {}) => ({ data, status: options.status ?? 200 }) } },
    '@/lib/collections/action-history-server': {
      ActionHistoryInputError: InputError,
      ActionHistoryOperationError: OperationError,
      createActionHistory: async (body, _now, afterCommit) => { calls.push(['create', body]); if (error) throw new OperationError(error); return {
        action: { id: body.action_id, nextActionDate: '2026-10-01' }, replayed: false,
        ...await afterCommit({ admin: {}, userId: 'owner', tenantId: 'tenant-a',
          entitlement: { hasActionsAccess: true, tenantId: 'tenant-a', usageDate: '2026-10-01' } }),
      } },
      readLatestActionHistory: async input => { calls.push(['latest', input]); if (error) throw new OperationError(error); return null },
      readCustomerActionHistory: async input => { calls.push(['history', input]); if (error) throw new OperationError(error); return { actions: [], nextCursor: null } },
      deleteActionHistory: async (body, afterCommit) => { calls.push(['delete', body]); if (error) throw new OperationError(error); return {
        deleted: false, actionId: body.action_id,
        ...await afterCommit({ admin: {}, userId: 'owner', tenantId: 'tenant-a',
          entitlement: { hasActionsAccess: true, tenantId: 'tenant-a', usageDate: '2026-10-01' } }),
      } },
    },
    '@/lib/collections/fast-queue-projection-server': { readCollectionQueueProjection: async () => {
      if (projectionError) throw new Error('Projection unavailable')
      return { rows: [{ customer_source_id: 'next' }], actionsTakenByCustomerId: {},
        queue: { returnedCustomerCount: 1 }, portfolio: null,
        version: { projectionRevision: '2' }, experience: { hasPriorCollectionActivity: true },
        reviews: [], metadata: { organisationBaseCurrency: 'GBP', currencyContext: {}, currencyHealth: {} },
        followUpSchedule: null }
    } },
    '@/lib/billing/collections-access': { resolveCollectionsCurrencyAccess: () => ({ allowed: currencyAllowed }) },
  } })
  return { ...handlers, calls, InputError, OperationError }
}

test('HTTP create, latest, history and idempotent delete expose distinct contracts', async () => {
  const app = route(), input = { action_id: 'stable-id', outcome: 'message_sent', tenant_id: 'tenant-a' }
  const created = await app.POST({ json: async () => input })
  assert.equal(created.status, 201)
  assert.equal(created.data.action.nextActionDate, '2026-10-01')
  assert.equal(created.data.committed, true)
  assert.equal(created.data.projection.rows[0].customer_source_id, 'next')
  const url = path => ({ nextUrl: new URL(path, 'https://example.test') })
  assert.deepEqual((await app.GET(url('/?view=latest&tenantId=t&sourceSystem=xero&customerSourceId=c'))).data, { ok: true, action: null })
  assert.deepEqual((await app.GET(url('/?view=history&tenantId=t&sourceSystem=xero&customerSourceId=c&limit=10&cursor=abc'))).data, { ok: true, actions: [], nextCursor: null })
  const deleted = (await app.DELETE({ json: async () => input })).data
  assert.equal(deleted.committed, true)
  assert.equal(deleted.deleted, false)
  assert.equal(deleted.projection.version.projectionRevision, '2')
  assert.deepEqual(app.calls.map(([operation]) => operation), ['create', 'latest', 'history', 'delete'])
  assert.equal(app.calls[2][1].limit, '10')
})

test('a committed mutation is reported as committed if projection fails afterwards', async () => {
  const app = route({ projectionError: true })
  const response = await app.POST({ json: async () => ({ action_id: 'stable-id', tenant_id: 'tenant-a' }) })
  assert.equal(response.status, 201)
  assert.equal(response.data.committed, true)
  assert.equal(response.data.projectionUnavailable, true)
})

test('a committed action never returns a queue projection when currency view access is denied', async () => {
  const app = route({ currencyAllowed: false })
  const response = await app.POST({ json: async () => ({ action_id: 'stable-id', tenant_id: 'tenant-a' }) })
  assert.equal(response.status, 201)
  assert.equal(response.data.committed, true)
  assert.equal(response.data.projectionUnavailable, true)
  assert.equal(response.data.projection, undefined)
})

test('malformed JSON and unsupported view fail before any server operation', async () => {
  const app = route()
  assert.equal((await app.POST({ json: async () => { throw Error('malformed') } })).status, 400)
  assert.equal((await app.DELETE({ json: async () => [] })).status, 400)
  assert.equal((await app.GET({ nextUrl: new URL('https://example.test/?view=all') })).status, 400)
  assert.equal(app.calls.length, 0)
})

for (const [code, status] of [['unauthorized', 401], ['forbidden', 403], ['not_found', 404], ['conflict', 409]]) {
  test(`HTTP ${code} is mapped without leaking persistence details`, async () => {
    const app = route({ error: code })
    const response = await app.POST({ json: async () => ({ action_id: 'x' }) })
    assert.equal(response.status, status)
    assert.deepEqual(response.data, { ok: false, code })
  })
}
