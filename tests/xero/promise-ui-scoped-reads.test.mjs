import assert from 'node:assert/strict'
import test from 'node:test'
import { createDisputesJourney, journeyInvoice, USER_ID, TENANT_ID, daysAgo } from './test-helpers/disputes-journey-fixture.mjs'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
// Fixtures run the production reader/DTO/aggregation paths, mocking only the database transport.
function commitment(app, fields = {}) {
  app.tables.invoice_promises.push({ id: 'promise-a', user_id: USER_ID, tenant_id: TENANT_ID, source_system: 'xero',
    invoice_source_id: 'a', customer_source_id: 'acme', currency_code: 'GBP', status: 'active', revision: '4',
    promised_amount_native: '4000', qualifying_paid_amount_native: '1000', promised_date: '2026-09-30',
    note: 'Call agreement', created_at: '2026-09-28T11:00:00Z', payment_baseline: { secret: 'baseline-private' },
    resolution_reason_code: 'internal-private', ...fields })
}
const scoped = async app => app.customers('scopeCustomerSourceId=acme')

test('customer refresh reads and derives only that customer, preserving recency invoice fallback', async () => {
  const app = createDisputesJourney({ invoices: [journeyInvoice('a', 'acme', 9000), journeyInvoice('b', 'baker', 8000)] })
  commitment(app)
  app.tables.canonical_payments.push({ user_id: USER_ID, tenant_id: TENANT_ID, source_system: 'xero', sync_run_id: 'generation-1', source_id: 'p-a',
    invoice_source_id: 'a', customer_source_id: null, payment_date: daysAgo(1) },
  { user_id: USER_ID, tenant_id: TENANT_ID, source_system: 'xero', sync_run_id: 'generation-1', source_id: 'p-b',
    invoice_source_id: 'b', customer_source_id: 'baker', payment_date: daysAgo(0) })
  const full = await app.customers()
  const before = app.calls.length
  const result = await scoped(app)
  assert.equal(result.status, 200); assert.equal(result.body.rows.length, 1)
  const row = result.body.rows[0]
  assert.equal(row.customer_source_id, 'acme'); assert.equal(row.to_chase_outstanding_base_decimal, '6000')
  assert.equal(row.last_payment_date, daysAgo(1)); assert.deepEqual(row, full.body.rows.find(row => row.customer_source_id === 'acme'))
  assert.equal(app.calls.slice(before).filter(table => table === 'invoice_promises').length, 1)
  assert.equal(app.calls.slice(before).includes('invoice_promise_events'), false)
  assert.equal(app.calls.slice(before).includes('collection_actions'), false)
})

test('scoped refresh cannot bypass global gross multicurrency entitlement', async () => {
  const app = createDisputesJourney({ invoices: [journeyInvoice('a', 'acme', 9000), journeyInvoice('b', 'baker', 100, {
    transaction_currency_code: 'EUR', amount_due_base: '80', xero_currency_rate: '1.25', currency_conversion_status: 'converted' })] })
  commitment(app); app.setPlan('basic')
  assert.equal((await scoped(app)).status, 402)
})

test('scoped refresh cannot switch tenant or read another owner', async () => {
  const app = createDisputesJourney(); app.setUser('other-user')
  assert.equal((await scoped(app)).status, 403)
})

test('single-invoice refresh retains canonical overlap, note and public promise context', async () => {
  const app = createDisputesJourney({ invoices: [journeyInvoice('a', 'acme', 10000), journeyInvoice('a2', 'acme', 5000)] })
  commitment(app, { qualifying_paid_amount_native: '0' })
  await app.mutate({ operation: 'partial', invoiceSourceId: 'a', disputedAmountNative: '8000' })
  const { GET } = loadTypeScriptModule('app/api/collections/invoice-disputes/route.ts', { mocks: {
    '@/lib/collections/invoice-disputes-server': {
      ...loadTypeScriptModule('lib/collections/invoice-disputes-server.ts', { mocks: {
        '@/lib/supabase-server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) } }) },
        '@/lib/supabase-admin': { createSupabaseAdminClient: () => app.admin },
        '@/lib/billing/entitlements': { claimActionsEntitlementStatus: async () => ({ tenantId: TENANT_ID, hasActionsAccess: true, isPaid: true, paidPlan: 'pro' }) },
      } }),
    },
    'next/server': { NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), { status: options.status ?? 200 }) } },
  } })
  const response = await GET({ nextUrl: new URL(`http://localhost/?tenantId=${TENANT_ID}&customerSourceId=acme&invoiceSourceId=a`) })
  const body = await response.json()
  assert.equal(response.status, 200); assert.equal(body.invoices.length, 1)
  const row = body.invoices[0]
  assert.equal(row.activePromise.note, 'Call agreement'); assert.equal(row.activePromisedCoverageAmountNative, '2000')
  assert.equal(row.toChaseAmountNative, '0'); assert.equal(row.latestPromise.id, 'promise-a')
  assert.doesNotMatch(JSON.stringify(body), /baseline-private|internal-private/)
})

for (const status of ['kept', 'missed', 'unclear', 'cancelled']) test(`terminal ${status} remains visible for settled invoice, with no active coverage`, async () => {
  const app = createDisputesJourney({ invoices: [journeyInvoice('a', 'acme', 0, { status: 'PAID' })] })
  commitment(app, { status, resolved_at: '2026-10-01T00:10:00Z' })
  const result = await app.invoices()
  assert.equal(result.status, 200); assert.equal(result.body.invoices.length, 1)
  assert.equal(result.body.invoices[0].latestPromise.status, status)
  assert.equal(result.body.invoices[0].activePromise, null); assert.equal(result.body.invoices[0].activePromisedCoverageAmountNative, '0')
})

test('latest commitment wins presentation while multiple historic Promise IDs are retained', async () => {
  const app = createDisputesJourney()
  commitment(app, { id: 'old', status: 'cancelled', created_at: '2026-09-27T10:00:00Z' })
  commitment(app, { id: 'new', created_at: '2026-09-28T10:00:00Z' })
  const result = await app.invoices()
  assert.equal(result.body.invoices[0].latestPromise.id, 'new')
  assert.equal(result.body.invoices[0].activePromise.id, 'new')
  assert.equal(app.tables.invoice_promises.length, 2)
})

test('missing accounting invoice retains Promise history as unavailable rather than paid/zero', async () => {
  const app = createDisputesJourney({ invoices: [journeyInvoice('b', 'acme', 1000)] })
  commitment(app, { status: 'missed', resolved_at: '2026-10-01T00:10:00Z' })
  const result = await app.invoices()
  const absent = result.body.invoices.find(row => row.invoiceSourceId === 'a')
  assert.ok(absent); assert.equal(absent.invoiceState, 'unavailable')
  assert.equal(absent.currentAmountDueNative, null); assert.equal(absent.toChaseAmountNative, null)
  assert.equal(absent.latestPromise.status, 'missed'); assert.equal(absent.activePromise, null)
})

test('large scoped refresh uses bounded identity batches, not per-invoice Promise/history reads', async () => {
  const app = createDisputesJourney({ invoices: Array.from({ length: 250 }, (_, index) => journeyInvoice(`a-${index}`, 'acme', 100)) })
  const batches = []
  const original = app.admin.from
  app.admin.from = table => {
    const query = original(table), filter = query.in
    query.in = function(column, values) { batches.push({ table, column, size: values.length }); return filter.call(this, column, values) }
    return query
  }
  const result = await scoped(app)
  assert.equal(result.status, 200); assert.equal(result.body.rows[0].to_chase_outstanding_base_decimal, '25000')
  assert.deepEqual(batches.filter(batch => batch.table === 'invoice_disputes').map(batch => batch.size), [100, 100, 50])
  assert.deepEqual(batches.filter(batch => batch.table === 'canonical_payments').map(batch => batch.size), [100, 100, 50])
  assert.equal(app.calls.filter(table => table === 'invoice_promises').length, 1)
  assert.equal(app.calls.includes('invoice_promise_events'), false)
})
