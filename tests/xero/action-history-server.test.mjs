import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const OWNER = '52a4b91c-79e4-49bc-bd16-c088acb8c1d2'
const ID1 = '7957c73c-79dc-4a5d-bc9f-a6d3b6f0d851'
const ID2 = '7957c73c-79dc-4a5d-bc9f-a6d3b6f0d852'
const ID3 = '7957c73c-79dc-4a5d-bc9f-a6d3b6f0d853'
const NOW = new Date('2026-09-30T23:30:00Z')

function fixture() {
  const tables = {
    canonical_customers: [
      { user_id: OWNER, tenant_id: 'tenant-a', source_system: 'xero', source_id: 'customer-a', sync_run_id: 'run-a' },
      { user_id: OWNER, tenant_id: 'tenant-b', source_system: 'xero', source_id: 'customer-b', sync_run_id: 'run-b' },
      { user_id: 'someone-else', tenant_id: 'tenant-a', source_system: 'xero', source_id: 'foreign', sync_run_id: 'run-a' },
    ],
    canonical_organisations: [
      { user_id: OWNER, tenant_id: 'tenant-a', source_system: 'xero', sync_run_id: 'run-a', source_timezone: 'Europe/London', country_code: 'GB', source_retrieved_at: '2026-09-30T12:00:00Z' },
    ],
    collection_actions: [
      { id: 'f4e6fa56-5e7e-4b9c-9447-16b10dcc0070', user_id: OWNER, tenant_id: 'tenant-a', source_system: 'xero', customer_source_id: 'customer-a', action_type: 'postponed', outcome: 'promised_to_pay', note: null, next_action_date: '2026-10-20', action_timestamp: '2026-09-30T09:00:00.000Z', created_at: '2026-09-30T09:00:00.000Z' },
    ],
  }
  let currentUser = OWNER
  let lastLimit = null
  const calls = []
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.orderings = []; this.max = null; this.operation = 'read' }
    select() { return this }
    eq(key, value) { this.filters.push(row => row[key] === value); return this }
    is(key, value) { this.filters.push(row => row[key] === value); return this }
    order(key, { ascending }) { this.orderings.push([key, ascending]); return this }
    limit(value) { this.max = value; lastLimit = value; return this }
    or(expression) {
      const match = /^action_timestamp\.lt\.([^,]+),and\(action_timestamp\.eq\.([^,]+),id\.lt\.([^)]+)\)$/.exec(expression)
      assert.ok(match)
      this.filters.push(row => row.action_timestamp < match[1] || (row.action_timestamp === match[2] && row.id < match[3]))
      return this
    }
    insert(value) { this.operation = 'insert'; this.value = value; return this }
    delete() { this.operation = 'delete'; return this }
    result(single = false) {
      calls.push({ table: this.table, operation: this.operation, filters: this.filters.length, limit: this.max })
      if (this.operation === 'insert') {
        if (tables.collection_actions.some(row => row.id === this.value.id)) return { data: null, error: { code: '23505' } }
        const row = { ...this.value, action_timestamp: NOW.toISOString(), created_at: NOW.toISOString() }
        tables.collection_actions.push(row)
        return { data: row, error: null }
      }
      let rows = tables[this.table].filter(row => this.filters.every(filter => filter(row)))
      if (this.operation === 'delete') {
        tables[this.table] = tables[this.table].filter(row => !rows.includes(row))
        return { data: single ? rows[0] ?? null : rows, error: null }
      }
      rows = [...rows]
      rows.sort((a, b) => {
        for (const [key, ascending] of this.orderings) {
          const compared = String(a[key] ?? '').localeCompare(String(b[key] ?? ''))
          if (compared) return ascending ? compared : -compared
        }
        return 0
      })
      if (this.max !== null) rows = rows.slice(0, this.max)
      return { data: single ? rows[0] ?? null : rows, error: null }
    }
    single() { return Promise.resolve(this.result(true)) }
    maybeSingle() { return Promise.resolve(this.result(true)) }
    then(resolve, reject) { return Promise.resolve(this.result()).then(resolve, reject) }
  }
  const admin = { from: table => new Query(table) }
  const domain = loadTypeScriptModule('lib/collections/action-history-server.ts', { mocks: {
    '@/lib/supabase-server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser ? { id: currentUser } : null }, error: null }) } }) },
    '@/lib/supabase-admin': { createSupabaseAdminClient: () => admin },
    '@/lib/billing/entitlements': { claimActionsEntitlementStatus: async ({ preferredTenantId }) => ({ tenantId: preferredTenantId === 'tenant-a' ? 'tenant-a' : 'tenant-a', hasActionsAccess: true }) },
    '@/lib/xero/authoritative-snapshot': { resolveXeroAuthoritativeSnapshot: async ({ userId, tenantId }) => ({ userId, tenantId, syncRunId: tenantId === 'tenant-a' ? 'run-a' : 'run-b' }), applyXeroAuthoritativeSnapshot: (query, snapshot) => query.eq('sync_run_id', snapshot.syncRunId) },
    '@/lib/xero/organisation-timezone': { normalizeXeroOrganisationTimezone: (zone, country) => zone && country ? zone : null },
  } })
  const input = (id = ID1, extra = {}) => ({
    action_id: id, tenant_id: 'tenant-a', source_system: 'xero', customer_source_id: 'customer-a',
    outcome: 'message_sent', ...extra,
  })
  return { ...domain, input, tables, calls, get lastLimit() { return lastLimit }, setUser: value => { currentUser = value } }
}

test('create validates provider/customer ownership, returns effective date, and replays by stable UUID', async () => {
  const app = fixture()
  const created = await app.createActionHistory(app.input(), NOW)
  assert.equal(created.replayed, false)
  assert.equal(created.action.id, ID1)
  assert.equal(created.action.nextActionDate, '2026-10-02')
  assert.equal(created.action.note, null)
  const replay = await app.createActionHistory(app.input(), new Date('2026-10-03T12:00:00Z'))
  assert.equal(replay.replayed, true)
  assert.deepEqual(replay.action, created.action)
  assert.equal(app.tables.collection_actions.length, 2)
  await assert.rejects(app.createActionHistory(app.input(ID1, { outcome: 'no_response' }), NOW), error => error.code === 'conflict')
  await assert.rejects(app.createActionHistory(app.input(ID2, { customer_source_id: 'foreign' }), NOW), error => error.code === 'not_found')
  await assert.rejects(app.createActionHistory(app.input(ID2, { tenant_id: 'tenant-b', customer_source_id: 'customer-b' }), NOW), error => error.code === 'forbidden')
  await assert.rejects(app.createActionHistory(app.input(ID2, { source_system: 'other' }), NOW), /Unsupported source_system/)
  assert.equal(app.tables.collection_actions.length, 2)
})

test('new contract rejects legacy outcomes, invalid dates and overlong notes before writing', async () => {
  const app = fixture()
  for (const legacy of ['called', 'emailed', 'promised_to_pay', 'disputed', 'postpone']) {
    await assert.rejects(app.createActionHistory(app.input(ID2, { outcome: legacy }), NOW), /Unsupported outcome/)
  }
  await assert.rejects(app.createActionHistory(app.input(ID2, { next_action_date: '2026-10-01' }), NOW), /after today/)
  await assert.rejects(app.createActionHistory(app.input(ID2, { note: 'x'.repeat(2001) }), NOW), /Invalid note/)
  assert.equal(app.tables.collection_actions.length, 1)
})

test('server persists a custom date and uses UTC when organisation timezone is unavailable', async () => {
  const app = fixture()
  const custom = await app.createActionHistory(app.input(ID1, { next_action_date: '2026-10-15', note: 'Agreed to revisit' }), NOW)
  assert.equal(custom.action.nextActionDate, '2026-10-15')
  assert.equal(custom.action.note, 'Agreed to revisit')
  app.tables.canonical_organisations.length = 0
  const fallback = await app.createActionHistory(app.input(ID2), NOW)
  assert.equal(fallback.action.nextActionDate, '2026-10-01')
})

test('latest and bounded keyset history select only new-format rows in deterministic order', async () => {
  const app = fixture()
  await app.createActionHistory(app.input(ID1, { outcome: 'no_response', note: 'First' }), NOW)
  await app.createActionHistory(app.input(ID2, { outcome: 'reviewed_no_chase', next_action_date: '2026-10-10' }), NOW)
  await app.createActionHistory(app.input(ID3, { outcome: 'responded_no_commitment' }), NOW)
  const identity = { tenant_id: 'tenant-a', source_system: 'xero', customer_source_id: 'customer-a' }
  assert.equal((await app.readLatestActionHistory(identity)).id, ID3)
  assert.equal(app.lastLimit, 1)
  assert.equal(await app.readLatestActionHistory({ ...identity, customer_source_id: 'foreign' }), null)
  await assert.rejects(app.readLatestActionHistory({ ...identity, source_system: 'other' }), /Unsupported source_system/)
  await assert.rejects(app.readLatestActionHistory({ ...identity, tenant_id: 'tenant-b' }), error => error.code === 'forbidden')
  const first = await app.readCustomerActionHistory({ ...identity, limit: '2' })
  assert.deepEqual(first.actions.map(row => row.id), [ID3, ID2])
  assert.ok(first.nextCursor)
  assert.equal(app.lastLimit, 3)
  const second = await app.readCustomerActionHistory({ ...identity, limit: '2', cursor: first.nextCursor })
  assert.deepEqual(second.actions.map(row => row.id), [ID1])
  assert.equal(second.nextCursor, null)
  assert.equal(app.tables.collection_actions[0].outcome, 'promised_to_pay')
})

test('delete is scoped to owner, tenant, provider, customer and V1 format; repeats are safe', async () => {
  const app = fixture()
  await app.createActionHistory(app.input(), NOW)
  const query = { action_id: ID1, tenant_id: 'tenant-a', source_system: 'xero', customer_source_id: 'customer-a' }
  assert.equal((await app.deleteActionHistory({ ...query, customer_source_id: 'foreign' })).deleted, false)
  assert.equal((await app.deleteActionHistory({ ...query, action_id: app.tables.collection_actions[0].id })).deleted, false)
  app.setUser('someone-else')
  assert.equal((await app.deleteActionHistory(query)).deleted, false)
  app.setUser(OWNER)
  assert.equal((await app.deleteActionHistory(query)).deleted, true)
  assert.equal((await app.deleteActionHistory(query)).deleted, false)
  assert.equal(app.tables.collection_actions.length, 1)
  assert.equal(app.tables.collection_actions[0].action_type, 'postponed')
})
