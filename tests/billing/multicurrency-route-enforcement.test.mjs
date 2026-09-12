import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const projectFile = (path) => new URL(`../../${path}`, import.meta.url)

const basicEntitlement = {
  plan: 'paid',
  isPaid: true,
  paidPlan: 'basic',
  tenantId: 'tenant_test',
  usageDaysConsumed: 0,
  usageDaysRemaining: null,
  freeUsageDaysLimit: 5,
  hasActionsAccess: true,
  usageDate: '2026-09-12',
  usageDateConsumed: false,
}

const multiCurrencyContext = {
  mode: 'multi_currency',
  invoicedCurrencies: ['GBP', 'USD'],
  relevantInvoiceCount: 2,
}

function nextServerMock() {
  return {
    NextResponse: {
      json(body, init = {}) {
        return new Response(JSON.stringify(body), {
          status: init.status ?? 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    },
  }
}

function commonMocks() {
  return {
    'next/server': nextServerMock(),
    '@/lib/supabase-server': {
      async createServerSupabaseClient() {
        return {
          auth: {
            async getUser() {
              return { data: { user: { id: 'user_test' } }, error: null }
            },
          },
        }
      },
    },
    '@/lib/supabase-admin': {
      createSupabaseAdminClient() {
        return {
          from() {
            throw new Error('protected database mutation must not run after currency denial')
          },
        }
      },
    },
    '@/lib/billing/entitlements': {
      async claimActionsEntitlementStatus() {
        return basicEntitlement
      },
    },
  }
}

function summaryMocks() {
  return {
    '@/lib/collections/customer-summary': {
      async loadCustomerCollectionsSummaryWithMetadata() {
        return {
          rows: [],
          sourceCounts: { customers: 0, invoices: 2, payments: 0 },
          organisationBaseCurrency: 'GBP',
          currencyContext: multiCurrencyContext,
          currencyHealth: {
            status: 'healthy',
            rankingStatus: 'complete',
            affectedInvoiceCount: 0,
            affectedCustomerCount: 0,
            failureReasons: {},
          },
          currencyEvaluation: {},
          reviewRequiredCustomers: [],
        }
      },
    },
  }
}

for (const routePath of [
  'app/api/collections/actions/route.ts',
  'app/api/collections/customers/route.ts',
]) {
  test(`paid Basic is server-gated from multi-currency access in ${routePath}`, async () => {
    const route = loadTypeScriptModule(projectFile(routePath), {
      mocks: {
        ...commonMocks(),
        ...summaryMocks(),
        '@/lib/collections/currency-health': { logCollectionsCurrencyHealth() {} },
        '@/lib/collections/tenant-context': { isMissingRelationError: () => false },
      },
    })

    const response = await route.GET({
      nextUrl: new URL('http://localhost/api/collections?tenantId=tenant_test'),
    })
    const payload = await response.json()

    assert.equal(response.status, 402)
    assert.equal(payload.code, 'MULTI_CURRENCY_REQUIRES_PRO')
    assert.deepEqual(payload.currencyContext, multiCurrencyContext)
    assert.deepEqual(payload.currencyAccess, {
      allowed: false,
      requiresPro: true,
      reason: 'multi_currency_requires_pro',
    })
  })
}

test('paid Basic cannot bypass the multi-currency gate through an action mutation', async () => {
  const route = loadTypeScriptModule(
    projectFile('app/api/collections/action-with-outcome/route.ts'),
    {
      mocks: {
        ...commonMocks(),
        '@/lib/collections/currency-context-server': {
          async loadCollectionsCurrencyContext() {
            return multiCurrencyContext
          },
        },
        '@/lib/collections/tenant-context': { isMissingRelationError: () => false },
      },
    }
  )

  const response = await route.POST({
    async json() {
      return {
        customer_source_id: 'customer_test',
        action_type: 'called',
        outcome: 'no_response',
        tenant_id: 'tenant_test',
      }
    },
  })
  const payload = await response.json()

  assert.equal(response.status, 402)
  assert.equal(payload.code, 'MULTI_CURRENCY_REQUIRES_PRO')
})

test('every collections mutation route enforces the shared currency capability', async () => {
  for (const path of [
    'app/api/collections/action/route.ts',
    'app/api/collections/action-with-outcome/route.ts',
    'app/api/collections/override/route.ts',
  ]) {
    const source = await readFile(projectFile(path), 'utf8')
    assert.match(source, /loadCollectionsCurrencyContext/, path)
    assert.match(source, /resolveCollectionsCurrencyAccess/, path)
  }
})

test('the existing server-rendered invoice surface enforces the shared currency capability', async () => {
  const source = await readFile(
    projectFile('app/xero/canonical/invoices/page.tsx'),
    'utf8'
  )

  assert.match(source, /loadCollectionsCurrencyContext/)
  assert.match(source, /resolveCollectionsCurrencyAccess/)
  assert.match(source, /pricing\?reason=multi-currency/)
})
