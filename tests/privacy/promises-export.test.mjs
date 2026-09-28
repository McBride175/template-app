import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'
import { getSafeAuthUser } from '../../lib/privacy-utils.mjs'

function exporter({ failTable } = {}) {
  const records = {
    invoice_promises: Array.from({ length: 1001 }, (_, index) => ({ id: String(index).padStart(4, '0'), user_id: 'owner',
      tenant_id: 'tenant-a', invoice_source_id: 'invoice-a', customer_source_id: 'customer-a', promised_amount_native: '4000.00000001',
      currency_code: 'GBP', promised_date: '2026-09-30', qualifying_paid_amount_native: '1000', note: `User note ${index}`,
      status: index % 2 ? 'active' : 'missed', created_at: '2026-09-28T12:00:00Z', resolved_at: index % 2 ? null : '2026-10-01T00:01:00Z',
      payment_baseline: { payment_ids: ['private-payment-id'] }, revision: 4, resolution_reason_code: 'internal-reason' })),
    invoice_promise_events: Array.from({ length: 1002 }, (_, index) => ({ id: String(index).padStart(4, '0'), user_id: 'owner',
      promise_id: '0001', tenant_id: 'tenant-a', event_sequence: String(index + 1), event_type: 'changed', actor_kind: 'user',
      occurred_at: '2026-09-28T12:00:00Z', effective_at: null,
      before_terms: { version: 1, promised_amount_native: '4000', promised_date: '2026-09-30', note: 'Before', status: 'active' },
      after_terms: { version: 1, promised_amount_native: '3000', promised_date: '2026-10-02', note: 'After', status: 'active' },
      command_fingerprint: 'private-fingerprint', command_id: 'private-command', evidence: { secret: 'resolver-private' } })),
  }
  for (const rows of Object.values(records)) rows.push({ id: 'other-owner', user_id: 'other', note: 'Other user private note' })
  const calls = []
  const admin = {
    auth: { admin: { getUserById: async id => ({ data: { user: { id } }, error: null }) } },
    from(table) {
      let columns = [], owner, page = [0, 999]
      return {
        select(value) { columns = value.split(',').map(column => column.trim().split('::')[0]); return this },
        eq(column, value) { assert.equal(column, 'user_id'); owner = value; return this },
        order() { return this },
        range(from, to) { page = [from, to]; calls.push({ table, owner, from, to, columns }); return this },
        maybeSingle() { return Promise.resolve({ data: null, error: null }) },
        then(resolve, reject) {
          const result = table === failTable ? { data: null, error: new Error('Resource unavailable') }
            : { data: (records[table] ?? []).filter(row => row.user_id === owner).slice(page[0], page[1] + 1)
              .map(row => Object.fromEntries(columns.filter(column => column in row).map(column => [column, row[column]]))), error: null }
          return Promise.resolve(result).then(resolve, reject)
        },
      }
    },
  }
  return { calls, ...loadTypeScriptModule('lib/privacy-export.ts', { mocks: {
    '@/lib/supabase-admin': { createSupabaseAdminClient: () => admin }, '@/lib/privacy-utils.mjs': { getSafeAuthUser },
  } }) }
}

test('privacy export includes all owned commitments, notes, terminal states and meaningful immutable history', async () => {
  const app = exporter(), bundle = await app.buildUserExportBundle('owner')
  assert.equal(bundle.data.invoice_promises.length, 1001)
  assert.equal(bundle.data.invoice_promise_events.length, 1002)
  assert.equal(bundle.data.invoice_promises[0].promised_amount_native, '4000.00000001')
  assert.equal(bundle.data.invoice_promises[0].note, 'User note 0')
  assert.equal(bundle.data.invoice_promises[0].status, 'missed')
  assert.equal(bundle.data.invoice_promise_events[0].before_terms.note, 'Before')
  assert.equal(bundle.data.invoice_promise_events[0].after_terms.note, 'After')
  assert.deepEqual(app.calls.map(call => [call.table, call.owner, call.from]), [
    ['invoice_promises', 'owner', 0], ['invoice_promise_events', 'owner', 0],
    ['invoice_promises', 'owner', 1000], ['invoice_promise_events', 'owner', 1000],
  ])
  const text = JSON.stringify(bundle)
  for (const internal of ['private-payment-id', 'private-fingerprint', 'private-command', 'resolver-private', 'internal-reason', 'Other user private note']) assert.equal(text.includes(internal), false)
  assert.ok(bundle.metadata.includes.includes('invoice_promises'))
  assert.ok(bundle.metadata.includes.includes('invoice_promise_events'))
})

for (const failTable of ['invoice_promises', 'invoice_promise_events']) test(`${failTable} failure is not silently exported as absence`, async () => {
  await assert.rejects(exporter({ failTable }).buildUserExportBundle('owner'), /Resource unavailable/)
})
