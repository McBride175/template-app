import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const projectFile = (path) => new URL(`../../${path}`, import.meta.url)

function loadCallback({ exchangeError = null, otpError = null } = {}) {
  return loadTypeScriptModule(projectFile('app/auth/callback/route.ts'), {
    mocks: {
      'next/server': {
        NextResponse: {
          redirect(url) {
            return new Response(null, {
              status: 307,
              headers: { location: String(url) },
            })
          },
        },
      },
      '@supabase/ssr': {
        createServerClient() {
          return {
            auth: {
              async exchangeCodeForSession() {
                return { data: { session: exchangeError ? null : {} }, error: exchangeError }
              },
              async verifyOtp() {
                return { data: { session: otpError ? null : {} }, error: otpError }
              },
            },
          }
        },
      },
    },
  })
}

function request(url) {
  return {
    url,
    cookies: {
      getAll() {
        return []
      },
      set() {},
    },
  }
}

test('successful OAuth callback preserves the intended destination', async () => {
  const callback = loadCallback()
  const response = await callback.GET(
    request('https://preview.example/auth/callback?code=test&next=%2Fcustomers%3FtenantId%3Done')
  )
  assert.equal(response.headers.get('location'), 'https://preview.example/customers?tenantId=one')
})

test('callback rejects external destinations', async () => {
  const callback = loadCallback()
  const response = await callback.GET(
    request('https://preview.example/auth/callback?code=test&next=https%3A%2F%2Fevil.example')
  )
  assert.equal(response.headers.get('location'), 'https://preview.example/dashboard')
})

test('OAuth cancellation returns to a useful login error', async () => {
  const callback = loadCallback()
  const response = await callback.GET(
    request('https://preview.example/auth/callback?error=access_denied&next=%2Fpricing')
  )
  const location = new URL(response.headers.get('location'))
  assert.equal(location.pathname, '/login')
  assert.equal(location.searchParams.get('next'), '/pricing')
  assert.equal(location.searchParams.get('error'), 'oauth_cancelled')
})

test('first-value Auth cancellation returns to the unified identity retry', async () => {
  const callback = loadCallback()
  const response = await callback.GET(
    request('https://preview.example/auth/callback?error=access_denied&next=%2Fstart')
  )
  const location = new URL(response.headers.get('location'))
  assert.equal(location.pathname, '/start')
  assert.equal(location.searchParams.get('authError'), 'oauth_cancelled')
})

test('expired PKCE and recovery links get stable user-facing error codes', async () => {
  const pkce = loadCallback({ exchangeError: { code: 'flow_state_expired' } })
  const pkceResponse = await pkce.GET(
    request('https://preview.example/auth/callback?code=expired&next=%2Fcustomers')
  )
  assert.equal(new URL(pkceResponse.headers.get('location')).searchParams.get('error'), 'auth_link_expired')

  const recovery = loadCallback({ otpError: { code: 'otp_expired' } })
  const recoveryResponse = await recovery.GET(
    request('https://preview.example/auth/callback?token_hash=expired&type=recovery')
  )
  const recoveryLocation = new URL(recoveryResponse.headers.get('location'))
  assert.equal(recoveryLocation.searchParams.get('error'), 'auth_link_expired')
})

test('valid recovery callback without next lands on the password form', async () => {
  const callback = loadCallback()
  const response = await callback.GET(
    request('https://preview.example/auth/callback?token_hash=valid&type=recovery')
  )
  assert.equal(response.headers.get('location'), 'https://preview.example/reset-password')
})

test('missing callback parameters return to a guided login state', async () => {
  const callback = loadCallback()
  const response = await callback.GET(request('https://preview.example/auth/callback'))
  assert.equal(
    new URL(response.headers.get('location')).searchParams.get('error'),
    'auth_missing_params'
  )
})
