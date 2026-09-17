import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const ROUTE_PATH = new URL('../../app/api/xero/disconnect/route.ts', import.meta.url)

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

function createAdminHarness() {
  const operations = []

  return {
    operations,
    client: {
      from(table) {
        let action = 'select'
        let values = null
        const filters = []
        const query = {
          select() {
            action = 'select'
            return query
          },
          update(nextValues) {
            action = 'update'
            values = nextValues
            return query
          },
          delete() {
            action = 'delete'
            return query
          },
          eq(column, value) {
            filters.push([column, value])
            return query
          },
          async maybeSingle() {
            operations.push({ table, action, filters: [...filters], values })
            return {
              data: { tenant_id: 'tenant-1', grant_id: 'grant-1' },
              error: null,
            }
          },
          then(resolve, reject) {
            operations.push({ table, action, filters: [...filters], values })
            const result = action === 'select'
              ? { data: [], count: 0, error: null }
              : { data: null, error: null }
            return Promise.resolve(result).then(resolve, reject)
          },
        }
        return query
      },
    },
  }
}

function loadRoute({ authenticated = true } = {}) {
  const admin = createAdminHarness()
  let adminClientCreations = 0
  const route = loadTypeScriptModule(ROUTE_PATH, {
    mocks: {
      'next/server': nextServerMock(),
      '@/lib/supabase-server': {
        async createServerSupabaseClient() {
          return {
            auth: {
              async getUser() {
                return authenticated
                  ? { data: { user: { id: 'user-1' } }, error: null }
                  : { data: { user: null }, error: null }
              },
            },
          }
        },
      },
      '@/lib/supabase-admin': {
        createSupabaseAdminClient() {
          adminClientCreations += 1
          return admin.client
        },
      },
    },
  })

  return {
    route,
    admin,
    getAdminClientCreations: () => adminClientCreations,
  }
}

function request(body) {
  return new Request('http://localhost/api/xero/disconnect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('public purgeData request is explicitly rejected before any database access', async () => {
  const harness = loadRoute()
  const response = await harness.route.POST(request({ tenantId: 'tenant-1', purgeData: true }))
  const payload = await response.json()

  assert.equal(response.status, 400)
  assert.equal(payload.code, 'XERO_PURGE_UNSUPPORTED')
  assert.equal(harness.getAdminClientCreations(), 0)
  assert.deepEqual(harness.admin.operations, [])
})

test('ordinary tenant disconnect preserves data and removes only connection grant linkage', async () => {
  const harness = loadRoute()
  const response = await harness.route.POST(request({ tenantId: 'tenant-1', purgeData: false }))
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(payload, {
    ok: true,
    tenantId: 'tenant-1',
    disconnectAll: false,
    purgedData: false,
  })

  const tables = new Set(harness.admin.operations.map((operation) => operation.table))
  assert.deepEqual([...tables].sort(), ['xero_connections_public', 'xero_oauth_grants'])
  assert.equal(
    harness.admin.operations.some(
      (operation) => operation.table === 'xero_connections_public' && operation.action === 'update'
    ),
    true
  )
  assert.equal(
    harness.admin.operations.some(
      (operation) => operation.table === 'xero_oauth_grants' && operation.action === 'delete'
    ),
    true
  )

  for (const protectedTable of [
    'xero_raw',
    'canonical_organisations',
    'canonical_customers',
    'canonical_invoices',
    'canonical_payments',
    'xero_sync_tenant_state',
    'xero_sync_runs',
    'xero_sync_run_steps',
    'xero_sync_run_validations',
    'customer_overrides',
    'collection_actions',
  ]) {
    assert.equal(tables.has(protectedTable), false)
  }
})

test('disconnect retains authentication and tenant ownership checks', async () => {
  const unauthenticated = loadRoute({ authenticated: false })
  const unauthorizedResponse = await unauthenticated.route.POST(
    request({ tenantId: 'tenant-1', purgeData: false })
  )
  assert.equal(unauthorizedResponse.status, 401)
  assert.equal(unauthenticated.getAdminClientCreations(), 0)

  const missingTenant = loadRoute()
  const missingTenantResponse = await missingTenant.route.POST(request({ purgeData: false }))
  const payload = await missingTenantResponse.json()
  assert.equal(missingTenantResponse.status, 400)
  assert.equal(payload.code, 'XERO_TENANT_ID_REQUIRED')
  assert.deepEqual(missingTenant.admin.operations, [])
})
