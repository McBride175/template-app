import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const OWNER = '11111111-1111-4111-8111-111111111111'
const ids = [1, 2, 3].map(value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`)
const eventRows = ids.map((value, index) => ({ event_id: `action:${value}`, event_kind: 'action',
  occurred_at: `2026-09-${30 - index}T10:00:00.000Z`,
  payload: { outcome: 'no_response', note: null, nextActionDate: '2026-10-01' } }))

function setup() {
  let currentUser = OWNER
  let ownedTenant = 'tenant-a'
  const calls = []
  const historyRows = structuredClone(eventRows)
  const tables = {
    canonical_customers: [{ user_id: OWNER, tenant_id: 'tenant-a', source_system: 'xero',
      source_id: 'zero-debt-customer', name: 'Zero Debt Ltd', sync_run_id: 'run-a' }],
    canonical_invoices: [{ user_id: OWNER, tenant_id: 'tenant-a', source_system: 'xero',
      source_id: 'invoice-a', customer_source_id: 'zero-debt-customer',
      invoice_number: 'INV-104', sync_run_id: 'run-a' }],
  }
  class Query {
    constructor(table) { this.table = table; this.filters = [] }
    select() { return this }
    eq(key, value) { this.filters.push(row => row[key] === value); return this }
    in(key, values) { this.filters.push(row => values.includes(row[key])); return this }
    result(single) {
      calls.push(['table', this.table])
      const rows = tables[this.table].filter(row => this.filters.every(filter => filter(row)))
      return { data: single ? rows[0] ?? null : rows, error: null }
    }
    maybeSingle() { return Promise.resolve(this.result(true)) }
    then(resolve, reject) { return Promise.resolve(this.result(false)).then(resolve, reject) }
  }
  const admin = { from: table => new Query(table), rpc: async (name, args) => {
    calls.push(['rpc', name, args])
    let rows = historyRows
    if (args.p_before_timestamp) rows = rows.filter(row => row.occurred_at < args.p_before_timestamp ||
      (row.occurred_at === args.p_before_timestamp && row.event_id < args.p_before_event_id))
    return { data: rows.slice(0, args.p_limit), error: null }
  } }
  const domain = loadTypeScriptModule('lib/collections/customer-history-server.ts', { mocks: {
    '@/lib/supabase-server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({
      data: { user: currentUser ? { id: currentUser } : null }, error: null,
    }) } }) },
    '@/lib/supabase-admin': { createSupabaseAdminClient: () => admin },
    '@/lib/billing/entitlements': { claimActionsEntitlementStatus: async () => ({
      tenantId: ownedTenant, hasActionsAccess: true,
    }) },
    '@/lib/xero/authoritative-snapshot': {
      resolveXeroAuthoritativeSnapshot: async () => ({ syncRunId: 'run-a' }),
      applyXeroAuthoritativeSnapshot: (query, snapshot) => query.eq('sync_run_id', snapshot.syncRunId),
    },
  } })
  const input = { tenantId: 'tenant-a', sourceSystem: 'xero', customerSourceId: 'zero-debt-customer' }
  return { ...domain, input, calls, tables, historyRows,
    setUser(value) { currentUser = value }, setTenant(value) { ownedTenant = value } }
}

test('owned zero-balance customer reads bounded history independently of queue actionability', async () => {
  const app = setup()
  const first = await app.readCustomerHistory({ ...app.input, limit: '2' })
  assert.equal(first.customer.name, 'Zero Debt Ltd')
  assert.deepEqual(first.events.map(event => event.id), eventRows.slice(0, 2).map(row => row.event_id))
  assert.ok(first.nextCursor)
  assert.equal(app.calls.find(call => call[0] === 'rpc')[2].p_limit, 3)
  assert.equal(app.calls.find(call => call[0] === 'rpc')[2].p_sync_run, 'run-a')
  const second = await app.readCustomerHistory({ ...app.input, limit: '2', cursor: first.nextCursor })
  assert.deepEqual(second.events.map(event => event.id), [eventRows[2].event_id])
  assert.equal(second.nextCursor, null)
  assert.equal(app.calls.some(call => call[1] === 'collection_actions'), false)
  assert.equal(app.calls.some(call => call[1] === 'canonical_payments'), false)
})

test('authentication, tenant, provider, and current owned customer checks precede the history RPC', async () => {
  const app = setup()
  app.setUser(null)
  await assert.rejects(app.readCustomerHistory(app.input), error => error.code === 'unauthorized')
  app.setUser(OWNER); app.setTenant('tenant-b')
  await assert.rejects(app.readCustomerHistory(app.input), error => error.code === 'forbidden')
  app.setTenant('tenant-a')
  await assert.rejects(app.readCustomerHistory({ ...app.input, sourceSystem: 'other' }), error => error.code === 'invalid_input')
  await assert.rejects(app.readCustomerHistory({ ...app.input, customerSourceId: 'foreign' }), error => error.code === 'not_found')
  await assert.rejects(app.readCustomerHistory({ ...app.input, cursor: 'bad' }), error => error.code === 'invalid_input')
  assert.equal(app.calls.some(call => call[0] === 'rpc'), false)
})

test('current invoice numbers are fetched in one snapshot-scoped batch for page events', async () => {
  const app = setup()
  app.historyRows[0] = { event_id: `promise:${ids[0]}`, event_kind: 'promise',
    occurred_at: eventRows[0].occurred_at,
    payload: { eventType: 'created', beforeTerms: null,
      afterTerms: { version: 1, promised_amount_native: '1500', currency_code: 'GBP',
        promised_date: '2026-10-02', note: null, status: 'active' },
      invoiceSourceId: 'invoice-a', currencyCode: 'GBP' } }
  const result = await app.readCustomerHistory(app.input)
  assert.equal(result.events[0].invoiceReference, 'INV-104')
  assert.equal(app.calls.filter(call => call[1] === 'canonical_invoices').length, 1)
})
