import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const { parseDisputeWorklistQuery, disputeWorklistUrl } = loadTypeScriptModule('lib/collections/dispute-worklist.ts')
function appFixture() {
  const scope = { user_id: 'user-a', tenant_id: 'tenant-a', source_system: 'xero' }
  const now = new Date()
  const daysAgo = (days) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - days * 86400000).toISOString().slice(0, 10)
  const invoice = (id, extra = {}) => ({ ...scope, id: `row-${id}`, sync_run_id: 'current',
    source_id: id, customer_source_id: 'acme', invoice_number: `INV-${id}`, reference: `REF-${id}`,
    issue_date: daysAgo(100), due_date: daysAgo(20), type: 'ACCREC', status: 'AUTHORISED',
    amount_due_native: '10000', amount_due_base: '10000', transaction_currency_code: 'GBP',
    organisation_base_currency_code: 'GBP', xero_currency_rate: null,
    currency_conversion_status: 'identity', currency_conversion_failure_reason: null,
    updated_at: '2026-09-25T00:00:00Z', ...extra })
  const dispute = (id, extra = {}) => ({ ...scope, id: `dispute-${id}`, invoice_source_id: id,
    dispute_mode: 'partial', recorded_disputed_amount_native: '3000',
    amount_due_at_last_review_native: '10000', note: 'Keep me', is_active: true,
    resolved_at: null, revision: 1, created_at: '2026-09-20T00:00:00Z',
    updated_at: '2026-09-20T00:00:00Z', ...extra })
  const tables = {
    xero_sync_tenant_state: [{ ...scope, active_sync_run_id: 'current', last_successful_sync_at: '2026-09-25T00:00:00Z' }],
    xero_sync_runs: [{ ...scope, id: 'current', status: 'succeeded' }],
    canonical_organisations: [{ ...scope, sync_run_id: 'current', base_currency_code: 'GBP' }],
    canonical_customers: ['acme', 'baker'].map((id) => ({ ...scope, id: `customer-${id}`, source_id: id,
      sync_run_id: 'current', name: id === 'acme' ? 'Acme Ltd' : 'Baker Ltd' })),
    canonical_invoices: [
      invoice('partial'),
      invoice('usd', { customer_source_id: 'baker', amount_due_native: '20000', amount_due_base: '4000',
        transaction_currency_code: 'USD', xero_currency_rate: '5', currency_conversion_status: 'converted', due_date: daysAgo(60) }),
      invoice('full', { amount_due_native: '5000', amount_due_base: '5000', due_date: daysAgo(90) }),
      invoice('bad-fx', { amount_due_native: '50000', amount_due_base: null, transaction_currency_code: 'USD',
        currency_conversion_status: 'incomplete', currency_conversion_failure_reason: 'missing_rate' }),
      invoice('wrong-base', { transaction_currency_code: 'USD', organisation_base_currency_code: 'EUR',
        currency_conversion_status: 'converted', xero_currency_rate: '1' }),
      invoice('resolved', { amount_due_native: '6000', amount_due_base: '6000' }),
      invoice('settled', { status: 'PAID', amount_due_native: '0', amount_due_base: '0' }),
      invoice('missing', { sync_run_id: 'previous', amount_due_native: '7000', amount_due_base: '7000' }),
      invoice('partial', { user_id: 'foreign-user', tenant_id: 'foreign-tenant', invoice_number: 'SECRET',
        amount_due_native: '99999', amount_due_base: '99999' }),
    ],
    invoice_disputes: [
      dispute('partial'),
      dispute('usd', { recorded_disputed_amount_native: '10000', amount_due_at_last_review_native: '25000' }),
      dispute('full', { dispute_mode: 'full', recorded_disputed_amount_native: '5000', amount_due_at_last_review_native: '5000' }),
      dispute('bad-fx', { dispute_mode: 'full', recorded_disputed_amount_native: '50000', amount_due_at_last_review_native: '50000' }),
      dispute('wrong-base', { dispute_mode: 'full', recorded_disputed_amount_native: '10000' }),
      dispute('resolved', { is_active: false, resolved_at: '2026-09-24T00:00:00Z', revision: 2 }),
      dispute('settled'), dispute('missing'), dispute('orphan'),
      dispute('partial', { user_id: 'foreign-user', tenant_id: 'foreign-tenant', note: 'PRIVATE' }),
    ],
  }
  let user = 'user-a'
  const calls = []
  const admin = { from(table) {
    calls.push(table)
    const filters = [], orders = []
    let range = null, changes = null
    const run = () => {
      let rows = tables[table].filter((row) => filters.every((f) => f(row)))
      if (changes) for (const row of rows) Object.assign(row, changes, { revision: row.revision + 1 })
      rows = [...rows].sort((a, b) => {
        for (const [key, ascending] of orders) {
          const diff = String(a[key] ?? '').localeCompare(String(b[key] ?? ''))
          if (diff) return ascending ? diff : -diff
        }
        return 0
      })
      return range ? rows.slice(range[0], range[1] + 1) : rows
    }
    const query = {
      select() { return this }, eq(key, value) { filters.push((row) => String(row[key]) === String(value)); return this },
      is(key, value) { filters.push((row) => row[key] === value); return this },
      in(key, values) { filters.push((row) => values.includes(row[key])); return this },
      order(key, options) { orders.push([key, options?.ascending !== false]); return this },
      range(from, to) { range = [from, to]; return this }, update(value) { changes = value; return this },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then(resolve, reject) { return Promise.resolve({ data: run(), error: null }).then(resolve, reject) },
    }
    return query
  } }
  const mocks = {
    'next/server': { NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), { status: options.status ?? 200 }) } },
    '@/lib/supabase-server': { createServerSupabaseClient: async () => ({ auth: {
      getUser: async () => ({ data: { user: user ? { id: user } : null }, error: null }),
    } }) },
    '@/lib/supabase-admin': { createSupabaseAdminClient: () => admin },
    '@/lib/billing/entitlements': { claimActionsEntitlementStatus: async ({ userId }) => ({
      tenantId: userId === 'user-a' ? 'tenant-a' : 'foreign-tenant', hasActionsAccess: true, isPaid: true, paidPlan: 'pro',
    }) },
  }
  const { GET } = loadTypeScriptModule('app/api/collections/disputes/route.ts', { mocks })
  const { POST } = loadTypeScriptModule('app/api/collections/invoice-disputes/route.ts', { mocks })
  return { tables, calls, setUser: (value) => { user = value },
    get: async (q = '') => {
      const response = await GET({ nextUrl: new URL(`http://localhost/api/collections/disputes?${q}`) })
      return { status: response.status, body: await response.json() }
    },
    post: async (body) => {
      const response = await POST(new Request('http://localhost/api/collections/invoice-disputes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }))
      return { status: response.status, body: await response.json() }
    },
  }
}

test('default worklist joins the authoritative snapshot and keeps full and partial invoices visible', async () => {
  const app = appFixture()
  const { status, body } = await app.get()
  assert.equal(status, 200)
  assert.equal(body.query.status, 'active')
  assert.equal(body.total, 5)
  const partial = body.rows.find((row) => row.invoiceSourceId === 'partial')
  assert.equal(partial.currentAmountDueNative, '10000')
  assert.equal(partial.effectiveDisputedAmountNative, '3000')
  assert.equal(partial.collectibleAmountNative, '7000')
  assert.equal(partial.effectiveDisputedBase, '3000')
  assert.equal(partial.revision, '1')
  assert.equal(partial.customerHref, '/customers?tenantId=tenant-a&customerSourceId=acme')
  const full = body.rows.find((row) => row.invoiceSourceId === 'full')
  assert.equal(full.collectibleAmountNative, '0')
  assert.equal(full.effectiveDisputedAmountNative, '5000')
  assert.equal('user_id' in partial, false)
  assert.equal('amount_due_base' in partial, false)
  assert.ok(app.calls.length < 15, 'joins are bounded batch reads, not per-row lookups')
})

test('status, customer and invoice search remain scoped and use derived review state', async () => {
  const app = appFixture()
  assert.deepEqual((await app.get('status=needs_review')).body.rows.map((row) => row.invoiceSourceId), ['usd'])
  assert.deepEqual((await app.get('customer=baker')).body.rows.map((row) => row.invoiceSourceId), ['usd'])
  assert.equal((await app.get('q=AcMe')).body.total, 4)
  assert.equal((await app.get('q=REF-usd')).body.total, 1)
  assert.equal((await app.get('q=SECRET')).body.total, 0)
  assert.equal((await app.get('customer=foreign-customer')).body.total, 0)
  assert.equal((await app.get('tenantId=foreign-tenant')).status, 403)
  app.setUser('foreign-user')
  assert.equal((await app.get('tenantId=tenant-a')).status, 403)
  assert.doesNotMatch(JSON.stringify((await app.get('status=all')).body.rows), /Keep me/)
  app.setUser(null)
  assert.equal((await app.get()).status, 401)
})

test('amount sorting uses validated comparable base values with unknown valuations last', async () => {
  const { body } = await appFixture().get()
  assert.deepEqual(body.rows.slice(0, 3).map((row) => row.invoiceSourceId), ['full', 'partial', 'usd'])
  const usd = body.rows[2]
  assert.equal(usd.effectiveDisputedAmountNative, '10000')
  assert.equal(usd.effectiveDisputedBase, '2000')
  for (const row of body.rows.slice(3)) {
    assert.equal(row.grossOutstandingBase, null)
    assert.equal(row.effectiveDisputedBase, null)
    assert.equal(row.collectibleBase, null)
    assert.equal(row.collectibleAmountNative, '0')
  }
  const asc = (await appFixture().get('sort=amount_asc')).body
  assert.deepEqual(asc.rows.slice(0, 3).map((row) => row.invoiceSourceId), ['usd', 'partial', 'full'])
})

test('resolved, accounting-settled and missing invoices remain distinct with honest last-known context', async () => {
  const app = appFixture()
  const resolved = (await app.get('status=resolved')).body.rows
  assert.equal(resolved.length, 1)
  assert.equal(resolved[0].isResolved, true)
  assert.equal(resolved[0].collectibleAmountNative, '6000')
  const settled = (await app.get('status=settled')).body.rows
  assert.equal(settled.length, 1)
  assert.equal(settled[0].isOperationallySettled, true)
  assert.equal(settled[0].isResolved, false)
  assert.equal(settled[0].currentAmountDueNative, '0')
  const absent = (await app.get('status=unavailable')).body.rows
  assert.equal(absent.length, 2)
  const previous = absent.find((row) => row.invoiceSourceId === 'missing')
  assert.equal(previous.contextFromPreviousSnapshot, true)
  assert.equal(previous.customerName, 'Acme Ltd')
  assert.equal(previous.invoiceState, 'unavailable')
  assert.equal(previous.currentAmountDueNative, null)
  assert.equal(previous.effectiveDisputedAmountNative, null)
  assert.equal(previous.collectibleAmountNative, null)
  assert.equal(previous.recordedDisputedAmountNative, '3000')
  assert.equal(previous.isOperationallySettled, false)
  assert.equal(previous.isResolved, false)
  assert.equal(previous.note, 'Keep me')
  assert.equal(absent.find((row) => row.invoiceSourceId === 'orphan').currencyCode, null)
})

test('age sort and bounded pagination have deterministic ordering without duplicates', async () => {
  const app = appFixture()
  const oldest = (await app.get('sort=oldest')).body.rows
  assert.equal(oldest[0].invoiceSourceId, 'full')
  assert.equal(oldest[0].overdueDays, 90)
  const all = (await app.get()).body.rows.map((row) => row.disputeId)
  const paged = []
  for (const page of [1, 2, 3]) {
    const { body } = await app.get(`pageSize=2&page=${page}`)
    assert.equal(body.total, 5)
    assert.equal(body.pageCount, 3)
    paged.push(...body.rows.map((row) => row.disputeId))
  }
  assert.deepEqual(paged, all)
  assert.equal(new Set(paged).size, 5)
  assert.equal((await app.get('page=999')).body.query.page, 1)
  const query = parseDisputeWorklistQuery(new URLSearchParams('pageSize=10000&page=-1&status=wrong'))
  assert.equal(query.pageSize, 100)
  assert.equal(query.page, 1)
  assert.equal(query.status, 'active')
  assert.match(disputeWorklistUrl({ ...query, customer: 'acme', q: 'INV', page: 2 }, 'tenant-a'), /customer=acme/)
})

test('worklist revisions drive the existing resolve/reactivate/review API and reject stale or foreign writes', async () => {
  const app = appFixture()
  const row = (await app.get()).body.rows.find((row) => row.invoiceSourceId === 'partial')
  const intent = { tenantId: 'tenant-a', disputeId: row.disputeId }
  const resolved = await app.post({ ...intent, operation: 'resolve', expected_revision: row.revision })
  assert.equal(resolved.status, 200)
  assert.equal(resolved.body.dispute.revision, 2)
  const stale = await app.post({ tenantId: 'tenant-a', invoiceSourceId: row.invoiceSourceId,
    operation: 'full', expected_revision: row.revision })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.code, 'conflict')
  const current = (await app.get('status=resolved&customer=acme')).body.rows.find((item) => item.disputeId === row.disputeId)
  assert.equal(current.isResolved, true)
  const reactivated = await app.post({ ...intent, operation: 'reactivate', expected_revision: current.revision })
  assert.equal(reactivated.status, 200)
  assert.equal(reactivated.body.dispute.id, row.disputeId)
  assert.equal(reactivated.body.dispute.revision, 3)
  const review = (await app.get('status=needs_review')).body.rows[0]
  const confirmed = await app.post({ tenantId: 'tenant-a', disputeId: review.disputeId,
    operation: 'confirm', expected_revision: review.revision })
  assert.equal(confirmed.status, 200)
  assert.equal((await app.get('status=needs_review')).body.total, 0)
  const foreign = await app.post({ tenantId: 'foreign-tenant', disputeId: review.disputeId,
    operation: 'resolve', expected_revision: '1' })
  assert.equal(foreign.status, 403)
})
