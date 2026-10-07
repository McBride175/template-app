import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/legacy-collection-access-mock.mjs'

const userId = '00000000-0000-4000-8000-000000003601'
const detail = { row: { customer_source_id: 'c1', customer_name: 'Customer One' },
  invoices: [], currencyContext: { mode: 'single_currency', invoicedCurrencies: ['GBP'], relevantInvoiceCount: 1 },
  currencyHealth: { status: 'healthy' }, organisationBaseCurrency: 'GBP',
  version: { generationId: '00000000-0000-4000-8000-000000003602', financialEpoch: '1',
    customerRevision: '0', projectionRevision: '2', evaluationDate: '2026-10-03' },
  metrics: { roundTrips: 2, featureRebuilt: false } }

test('targeted detail enforces auth, entitlement, tenant and currency before returning one customer', async () => {
  let authenticated = true, tenant = 'tenant-a', actionsAccess = true, currencyAllowed = true, reads = 0
  const route = loadTypeScriptModule('app/api/collections/customer-detail/route.ts', { mocks: {
    'next/server': { NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), { status: options.status ?? 200 }) } },
    '@/lib/supabase-server': { createServerSupabaseClient: async () => ({ auth: {
      getUser: async () => ({ data: { user: authenticated ? { id: userId } : null }, error: null }),
    } }) },
    '@/lib/supabase-admin': { createSupabaseAdminClient: () => ({}) },
    '@/lib/billing/entitlements': { claimActionsEntitlementStatus: async () => ({ tenantId: tenant,
      hasActionsAccess: actionsAccess }) },
    '@/lib/billing/collections-access': { MULTI_CURRENCY_REQUIRES_PRO_CODE: 'MULTI_CURRENCY_REQUIRES_PRO',
      resolveCollectionsCurrencyAccess: () => ({ allowed: currencyAllowed }) },
    '@/lib/collections/customer-detail-bootstrap-server': {
      CustomerDetailBootstrapUnavailable: class CustomerDetailBootstrapUnavailable extends Error {
        constructor(reason) { super(reason); this.reason = reason }
      },
      readCustomerDetailBootstrap: async () => { reads++; return detail },
    },
  } })
  const request = { nextUrl: new URL('http://localhost/api/collections/customer-detail?tenantId=tenant-a&customerSourceId=c1') }
  authenticated = false
  assert.equal((await route.GET(request)).status, 401)
  authenticated = true; tenant = 'tenant-b'
  assert.equal((await route.GET(request)).status, 403)
  tenant = 'tenant-a'; actionsAccess = false
  assert.equal((await route.GET(request)).status, 402)
  assert.equal(reads, 0)
  actionsAccess = true; currencyAllowed = false
  const gated = await route.GET(request)
  assert.equal(gated.status, 402)
  assert.equal((await gated.json()).code, 'MULTI_CURRENCY_REQUIRES_PRO')
  currencyAllowed = true
  const allowed = await route.GET(request)
  assert.equal(allowed.status, 200)
  const payload = await allowed.json()
  assert.equal(payload.customerSourceId, 'c1')
  assert.deepEqual(payload.row, detail.row)
  assert.deepEqual(payload.invoices, [])
  assert.equal(payload.version.financialEpoch, '1')
  assert.equal(reads, 2)
})

test('unapplied materialization schema uses current authoritative legacy detail without an old-generation result', async () => {
  const run = '00000000-0000-4000-8000-000000003602'
  let snapshotReads = 0
  class Unavailable extends Error { constructor(reason) { super(reason); this.reason = reason } }
  const route = loadTypeScriptModule('app/api/collections/customer-detail/route.ts', { mocks: {
    'next/server': { NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), { status: options.status ?? 200 }) } },
    '@/lib/supabase-server': { createServerSupabaseClient: async () => ({ auth: {
      getUser: async () => ({ data: { user: { id: userId } }, error: null }),
    } }) },
    '@/lib/supabase-admin': { createSupabaseAdminClient: () => ({ from: () => ({
      select() { return this }, eq() { return this },
      maybeSingle: async () => ({ data: null, error: null }),
    }) }) },
    '@/lib/billing/entitlements': { claimActionsEntitlementStatus: async () => ({ tenantId: 'tenant-a', hasActionsAccess: true }) },
    '@/lib/billing/collections-access': { resolveCollectionsCurrencyAccess: () => ({ allowed: true }) },
    '@/lib/collections/customer-detail-bootstrap-server': {
      CustomerDetailBootstrapUnavailable: Unavailable,
      readCustomerDetailBootstrap: async () => { throw new Unavailable('schema') },
    },
    '@/lib/xero/authoritative-snapshot': { resolveXeroAuthoritativeSnapshot: async () => {
      snapshotReads++; return { mode: 'generation', syncRunId: run }
    } },
    '@/lib/collections/customer-summary': { loadCustomerCollectionsSummaryWithMetadata: async () => ({
      rows: [{ customer_source_id: 'c1', customer_name: 'Customer One' }],
      reviewRequiredCustomers: [], currencyHealth: { status: 'healthy' }, organisationBaseCurrency: 'GBP',
    }) },
    '@/lib/collections/currency-context-server': { loadCollectionsCurrencyContext: async () => detail.currencyContext },
    '@/lib/collections/invoice-disputes-server': { loadCustomerInvoiceDisputes: async () => [{ invoiceSourceId: 'i1' }] },
  } })
  const response = await route.GET({ nextUrl: new URL('http://localhost/api/collections/customer-detail?tenantId=tenant-a&customerSourceId=c1') })
  const payload = await response.json()
  assert.equal(response.status, 200)
  assert.equal(payload.version.generationId, run)
  assert.equal(payload.row.customer_source_id, 'c1')
  assert.deepEqual(payload.invoices, [{ invoiceSourceId: 'i1' }])
  assert.equal(snapshotReads, 2, 'legacy fallback validates the generation again after reading')
})
