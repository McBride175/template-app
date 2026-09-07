import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const projectFile = (path) => new URL(`../../${path}`, import.meta.url)

const exhaustedEntitlement = {
  plan: 'free',
  isPaid: false,
  tenantId: 'tenant_test',
  usageDaysConsumed: 5,
  usageDaysRemaining: 0,
  freeUsageDaysLimit: 5,
  hasActionsAccess: false,
  usageDate: '2026-09-06',
  usageDateConsumed: false,
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

function authenticatedSupabaseMock() {
  return {
    auth: {
      async getUser() {
        return { data: { user: { id: 'user_test', email: 'user@example.test' } }, error: null }
      },
    },
  }
}

function commonMocks() {
  return {
    'next/server': nextServerMock(),
    '@/lib/supabase-server': {
      async createServerSupabaseClient() {
        return authenticatedSupabaseMock()
      },
    },
    '@/lib/supabase-admin': {
      createSupabaseAdminClient() {
        throw new Error('protected data access must not run after entitlement denial')
      },
    },
    '@/lib/billing/entitlements': {
      async claimActionsEntitlementStatus() {
        return exhaustedEntitlement
      },
    },
  }
}

test('direct collection queue API request is rejected before protected queries', async () => {
  const route = loadTypeScriptModule(projectFile('app/api/collections/actions/route.ts'), {
    mocks: {
      ...commonMocks(),
      '@/lib/collections/customer-summary': {
        async loadCustomerCollectionsSummaryWithMetadata() {
          throw new Error('customer summary must not load')
        },
      },
      '@/lib/collections/prioritization': {
        prioritiseCustomer() {
          throw new Error('prioritization must not run')
        },
      },
      '@/lib/collections/tenant-context': { isMissingRelationError: () => false },
    },
  })

  const response = await route.GET({
    nextUrl: new URL('http://localhost/api/collections/actions?tenantId=tenant_test'),
  })
  const payload = await response.json()

  assert.equal(response.status, 402)
  assert.equal(payload.code, 'ACTION_USAGE_LIMIT_REACHED')
  assert.equal(payload.entitlement.hasActionsAccess, false)
})

test('direct collection action mutation is rejected before database insertion', async () => {
  const route = loadTypeScriptModule(
    projectFile('app/api/collections/action-with-outcome/route.ts'),
    {
      mocks: {
        ...commonMocks(),
        '@/lib/collections/tenant-context': { isMissingRelationError: () => false },
      },
    }
  )

  const response = await route.POST({
    async json() {
      return {
        customer_source_id: 'contact_test',
        action_type: 'called',
        outcome: 'no_response',
        tenant_id: 'tenant_test',
      }
    },
  })
  const payload = await response.json()

  assert.equal(response.status, 402)
  assert.equal(payload.code, 'ACTION_USAGE_LIMIT_REACHED')
})

test('direct customer-data API request is rejected before aggregation', async () => {
  const route = loadTypeScriptModule(projectFile('app/api/collections/customers/route.ts'), {
    mocks: {
      ...commonMocks(),
      '@/lib/collections/customer-summary': {
        async loadCustomerCollectionsSummary() {
          throw new Error('customer aggregation must not run')
        },
      },
    },
  })

  const response = await route.GET({
    nextUrl: new URL('http://localhost/api/collections/customers?tenantId=tenant_test'),
  })
  const payload = await response.json()

  assert.equal(response.status, 402)
  assert.equal(payload.code, 'ACTION_USAGE_LIMIT_REACHED')
})

test('direct manual Xero sync request is rejected before lock or provider work', async () => {
  let syncCalled = false
  const route = loadTypeScriptModule(projectFile('app/api/xero/sync/route.ts'), {
    mocks: {
      ...commonMocks(),
      '@/lib/xero/tenant-sync-lock': {
        async acquireXeroTenantSyncLock() {
          throw new Error('sync lock must not be acquired')
        },
        async releaseXeroTenantSyncLock() {},
      },
      '@/lib/xero/sync': {
        parseTenantId(value) {
          return typeof value === 'string' ? value : null
        },
        async syncXeroTenantForUser() {
          syncCalled = true
        },
      },
    },
  })

  const response = await route.POST({
    async json() {
      return { tenantId: 'tenant_test' }
    },
  })
  const payload = await response.json()

  assert.equal(response.status, 402)
  assert.equal(payload.code, 'ACTION_USAGE_LIMIT_REACHED')
  assert.equal(syncCalled, false)
})

test('every directly callable billable surface uses the common claim boundary', async () => {
  const protectedFiles = [
    'app/api/collections/actions/route.ts',
    'app/api/collections/action/route.ts',
    'app/api/collections/action-with-outcome/route.ts',
    'app/api/collections/customers/route.ts',
    'app/api/collections/override/route.ts',
    'app/api/xero/raw/route.ts',
    'app/api/xero/sync/route.ts',
    'app/api/xero/sync/auto/route.ts',
    'app/api/xero/map-canonical/route.ts',
    'app/xero/canonical/customers/page.tsx',
    'app/xero/canonical/invoices/page.tsx',
    'app/xero/canonical/payments/page.tsx',
  ]

  for (const path of protectedFiles) {
    const source = await readFile(projectFile(path), 'utf8')
    assert.match(source, /claimActionsEntitlementStatus/, path)
  }
})

test('auth, billing management, OAuth callbacks, and Stripe webhooks stay outside the paywall', async () => {
  const legitimatePublicOrManagementFiles = [
    'app/api/webhooks/stripe/route.ts',
    'app/auth/callback/route.ts',
    'app/api/xero/connect/route.ts',
    'app/api/xero/callback/route.ts',
    'app/api/xero/disconnect/route.ts',
    'app/api/checkout/route.ts',
    'app/api/portal/route.ts',
  ]

  for (const path of legitimatePublicOrManagementFiles) {
    const source = await readFile(projectFile(path), 'utf8')
    assert.doesNotMatch(source, /claimActionsEntitlementStatus/, path)
  }
})
