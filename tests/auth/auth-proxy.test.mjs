import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const projectFile = (path) => new URL(`../../${path}`, import.meta.url)

function response(status, location) {
  const cookies = []
  return {
    status,
    headers: new Headers(location ? { location: String(location) } : {}),
    cookies: {
      getAll() {
        return cookies
      },
      set(cookie) {
        cookies.push(cookie)
      },
    },
  }
}

function loadProxy(user) {
  return loadTypeScriptModule(projectFile('proxy.ts'), {
    mocks: {
      'next/server': {
        NextResponse: {
          next() {
            return response(200)
          },
          redirect(url) {
            return response(307, url)
          },
        },
      },
      '@supabase/ssr': {
        createServerClient() {
          return {
            auth: {
              async getUser() {
                return { data: { user }, error: null }
              },
            },
          }
        },
      },
    },
  })
}

function request(url, cookieNames = []) {
  const nextUrl = new URL(url)
  return {
    url,
    nextUrl,
    headers: new Headers(),
    cookies: {
      getAll() {
        return cookieNames.map((name) => ({ name, value: 'test' }))
      },
      set() {},
    },
  }
}

test('signed-out protected navigation preserves its complete destination', async () => {
  const proxy = loadProxy(null)
  const result = await proxy.proxy(
    request('https://preview.example/customers?tenantId=tenant_test')
  )
  const location = new URL(result.headers.get('location'))
  assert.equal(location.pathname, '/login')
  assert.equal(location.searchParams.get('next'), '/customers?tenantId=tenant_test')
})

test('an expired session explains the interruption without losing destination', async () => {
  const proxy = loadProxy(null)
  const result = await proxy.proxy(
    request('https://preview.example/account', ['sb-project-auth-token.0'])
  )
  const location = new URL(result.headers.get('location'))
  assert.equal(location.searchParams.get('next'), '/account')
  assert.equal(location.searchParams.get('error'), 'session_expired')
})

test('authenticated visitors bypass login and return to their intended page', async () => {
  const proxy = loadProxy({ id: 'user_test' })
  const result = await proxy.proxy(
    request('https://preview.example/login?next=%2Fpricing%3Fplan%3Dpro')
  )
  assert.equal(result.headers.get('location'), 'https://preview.example/pricing?plan=pro')
})

test('public pages remain available while signed out', async () => {
  const proxy = loadProxy(null)
  const result = await proxy.proxy(request('https://preview.example/pricing'))
  assert.equal(result.status, 200)
  assert.equal(result.headers.get('location'), null)
})
