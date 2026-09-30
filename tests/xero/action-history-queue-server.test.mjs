import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const { loadLatestQueueActions } = loadTypeScriptModule('lib/collections/action-history-queue-server.ts')

function admin({ presenceError = null, rpcError = null } = {}) {
  const calls = []
  const client = {
    from(table) {
      assert.equal(table, 'collection_actions')
      const filters = []
      const query = {
        select(columns) { assert.equal(columns, 'id'); return this },
        eq(field, value) { filters.push([field, value]); return this },
        limit(value) { assert.equal(value, 1); return this },
        then(resolve) {
          calls.push({ presence: filters })
          return Promise.resolve({ data: presenceError ? null : [{ id: 'existing' }], error: presenceError }).then(resolve)
        },
      }
      return query
    },
    async rpc(name, args) {
      calls.push({ name, args })
      return { data: [], error: rpcError }
    },
  }
  return { client, calls }
}

test('latest queue read batches owned provider/customer IDs and never reads tenant history', async () => {
  const { client, calls } = admin()
  const ids = Array.from({ length: 501 }, (_, index) => `customer-${index}`)
  const result = await loadLatestQueueActions({ admin: client, userId: 'owner', tenantId: 'tenant', customerSourceIds: ids })
  assert.equal(result.hasPriorActionActivity, true)
  assert.equal(calls.length, 3)
  assert.deepEqual(calls[0].presence, [['user_id', 'owner'], ['tenant_id', 'tenant'], ['source_system', 'xero']])
  assert.equal(calls[1].name, 'latest_collection_queue_actions')
  assert.equal(calls[1].args.p_customer_source_ids.length, 500)
  assert.equal(calls[1].args.p_source_system, 'xero')
  assert.equal(calls[2].args.p_customer_source_ids.length, 1)
})

test('presence and latest lookup errors fail closed', async () => {
  const first = admin({ presenceError: { message: 'unavailable' } })
  await assert.rejects(loadLatestQueueActions({ admin: first.client, userId: 'u', tenantId: 't',
    customerSourceIds: ['c'] }), /Failed to read collection activity/)
  const second = admin({ rpcError: { message: 'missing function' } })
  await assert.rejects(loadLatestQueueActions({ admin: second.client, userId: 'u', tenantId: 't',
    customerSourceIds: ['c'] }), /Failed to read latest collection actions/)
})
