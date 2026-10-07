import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/legacy-collection-access-mock.mjs'

const userId = '00000000-0000-4000-8000-000000003601'
const generationId = '00000000-0000-4000-8000-000000003602'
const rows = [
  { customer_source_id: 'a', customer_name: 'Alpha', overdue_invoices_count: 1,
    overdue_outstanding_base_decimal: '100.00', total_outstanding_base_decimal: '100.00', oldest_overdue_days: 10 },
  { customer_source_id: 'b', customer_name: 'Beta', overdue_invoices_count: 0,
    overdue_outstanding_base_decimal: '0', total_outstanding_base_decimal: '200.00', oldest_overdue_days: null },
  { customer_source_id: 'c', customer_name: 'Gamma', overdue_invoices_count: 1,
    overdue_outstanding_base_decimal: '300.00', total_outstanding_base_decimal: '300.00', oldest_overdue_days: 30 },
]
const summary = { rows, organisationBaseCurrency: 'GBP',
  currencyHealth: { status: 'healthy' }, currencyEvaluation: { currencyHealth: { status: 'healthy' }, currencyIssues: [] },
  currencyContext: { mode: 'single_currency', invoicedCurrencies: ['GBP'], relevantInvoiceCount: 2 },
  reviewRequiredCustomers: [], snapshot: { mode: 'generation', syncRunId: generationId } }

test('materialized customer list preserves legacy sorting, filtering, limits and overrides', async () => {
  let mode = 'materialized', oldReads = 0, featureReads = 0
  const admin = { from(table) {
    assert.equal(table, 'customer_overrides')
    return { select() { return this }, eq() { return this },
      then(resolve) { return Promise.resolve({ data: [{ customer_source_id: 'c', override_level: 'priority' }], error: null }).then(resolve) } }
  } }
  const route = loadTypeScriptModule('app/api/collections/customers/route.ts', { mocks: {
    'next/server': { NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), { status: options.status ?? 200 }) } },
    '@/lib/supabase-server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) } }) },
    '@/lib/supabase-admin': { createSupabaseAdminClient: () => admin },
    '@/lib/billing/entitlements': { claimActionsEntitlementStatus: async () => ({ tenantId: 'tenant-a', hasActionsAccess: true }) },
    '@/lib/billing/collections-access': { MULTI_CURRENCY_REQUIRES_PRO_CODE: 'MULTI_CURRENCY_REQUIRES_PRO',
      resolveCollectionsCurrencyAccess: () => ({ allowed: true }) },
    '@/lib/collections/customer-materialization-server': {
      CustomerMaterializationNotReady: class CustomerMaterializationNotReady extends Error {
        constructor(reason) { super(reason); this.reason = reason }
      },
      ensureCustomerFinancialFeaturesForPortfolioWithIdentity: async () => {
        featureReads++
        if (mode === 'legacy') {
          // The route requires the actual error class, so the branch below returns
          // a missing-RPC shape as would an unapplied staged migration.
          throw new Error('PGRST202 missing materialization RPC')
        }
        return { result: summary, identity: { generationId } }
      },
    },
    '@/lib/collections/customer-summary': { loadCustomerCollectionsSummaryWithMetadata: async () => {
      oldReads++; return structuredClone(summary)
    } },
    '@/lib/collections/currency-health': { logCollectionsCurrencyHealth() {} },
    '@/lib/collections/tenant-context': { isMissingRelationError: () => false },
  } })
  for (const query of [
    'sortBy=overdue_outstanding&sortDir=desc&limit=2',
    'sortBy=total_outstanding&sortDir=asc&limit=2&customerSourceId=c',
    'sortBy=customer_name&sortDir=desc&limit=2',
    'overdueOnly=true&sortBy=oldest_overdue_days&sortDir=asc&limit=2',
  ]) {
    const request = { nextUrl: new URL(`http://localhost/api/collections/customers?tenantId=tenant-a&${query}`) }
    mode = 'legacy'
    const old = await route.GET(request)
    mode = 'materialized'
    const current = await route.GET(request)
    assert.equal(old.status, 200)
    assert.equal(current.status, 200)
    assert.deepEqual(await current.json(), await old.json())
  }
  assert.equal(oldReads, 4)
  assert.equal(featureReads, 8)
})
