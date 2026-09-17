import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const ROUTE_PATH = new URL('../../app/api/xero/select-organisation/route.ts', import.meta.url)

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

function loadRoute({ authenticated = true, ownedTenantId = 'tenant-owned' } = {}) {
  const filters = []
  const query = {
    select() { return query },
    eq(column, value) {
      filters.push([column, value])
      return query
    },
    async maybeSingle() {
      const requestedTenantId = filters.find(([column]) => column === 'tenant_id')?.[1]
      return {
        data: requestedTenantId === ownedTenantId ? { tenant_id: ownedTenantId } : null,
        error: null,
      }
    },
  }

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
            from(table) {
              assert.equal(table, 'xero_connections_public')
              return query
            },
          }
        },
      },
    },
  })

  return { route, filters }
}

function request(tenantId, headers = {}) {
  return new Request('https://preview.example/api/xero/select-organisation', {
    method: 'POST',
    headers: {
      host: 'preview.example',
      origin: 'https://preview.example',
      'content-type': 'application/json',
      'x-requested-with': 'XMLHttpRequest',
      ...headers,
    },
    body: JSON.stringify({ tenantId }),
  })
}

test('owned active tenant selection returns only a resolver destination', async () => {
  const { route, filters } = loadRoute()
  const response = await route.POST(request('tenant-owned'))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { next: '/start?tenantId=tenant-owned' })
  assert.deepEqual(filters, [
    ['user_id', 'user-1'],
    ['tenant_id', 'tenant-owned'],
    ['auth_state', 'active'],
  ])
})

test('foreign tenant selection is rejected server-side', async () => {
  const { route } = loadRoute()
  const response = await route.POST(request('tenant-foreign'))
  assert.equal(response.status, 404)
})

test('selection requires authentication and same-origin browser intent', async () => {
  const unauthenticated = loadRoute({ authenticated: false })
  assert.equal((await unauthenticated.route.POST(request('tenant-owned'))).status, 401)

  const wrongOrigin = loadRoute()
  assert.equal(
    (await wrongOrigin.route.POST(request('tenant-owned', { origin: 'https://attacker.example' }))).status,
    403
  )
})
