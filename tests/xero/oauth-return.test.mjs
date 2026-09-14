import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const projectFile = (path) => new URL(`../../${path}`, import.meta.url)
const oauthReturn = loadTypeScriptModule(projectFile('lib/xero/oauth-return.ts'))
const authFlow = loadTypeScriptModule(projectFile('lib/auth-flow.ts'))

test('Xero return intent accepts only Dashboard or Account and preserves a tenant selection', () => {
  assert.equal(oauthReturn.sanitizeXeroReturnPath('/dashboard'), '/dashboard')
  assert.equal(
    oauthReturn.sanitizeXeroReturnPath('/dashboard?tenantId=tenant-1&checkout=success'),
    '/dashboard?tenantId=tenant-1'
  )
  assert.equal(oauthReturn.sanitizeXeroReturnPath('/account'), '/account')
})

test('external, protocol-relative, backslash, and unrelated Xero returns fall back to Dashboard', () => {
  const unsafeDestinations = [
    'https://attacker.example/steal',
    '//attacker.example/steal',
    '/\\attacker.example/steal',
    '/auth/callback?code=stolen',
    '/settings/integrations',
  ]

  for (const destination of unsafeDestinations) {
    assert.equal(oauthReturn.sanitizeXeroReturnPath(destination), '/dashboard', destination)
  }
})

test('valid Xero return intent survives login and builds the intended callback destination', () => {
  const connectPath = oauthReturn.buildXeroConnectPath('/dashboard?tenantId=tenant-1')
  const loginPath = new URL(authFlow.buildLoginPath(connectPath), 'https://app.example')

  assert.equal(loginPath.pathname, '/login')
  assert.equal(loginPath.searchParams.get('next'), connectPath)
  assert.equal(
    oauthReturn.buildXeroCallbackDestination({
      returnTo: '/dashboard?tenantId=old-tenant',
      result: 'connected',
      tenantId: 'connected-tenant',
    }),
    '/dashboard?tenantId=connected-tenant&xero=connected'
  )
  assert.equal(
    oauthReturn.buildXeroCallbackDestination({
      returnTo: '/account',
      result: 'connected',
      tenantId: 'connected-tenant',
    }),
    '/account?xero=connected&tenantId=connected-tenant'
  )
})

test('malicious callback return cookie cannot redirect away from the application', () => {
  assert.equal(
    oauthReturn.buildXeroCallbackDestination({
      returnTo: 'https://attacker.example/steal',
      result: 'error',
      reason: 'provider_error',
    }),
    '/dashboard?xero=error&reason=provider_error'
  )
})

test('Xero callback outcomes translate to safe customer-facing categories', () => {
  assert.match(oauthReturn.getXeroCallbackNotice('connected', null).message, /preparing/i)
  assert.match(oauthReturn.getXeroCallbackNotice('error', 'cancelled').message, /no data was changed/i)
  assert.match(oauthReturn.getXeroCallbackNotice('error', 'invalid_state').message, /expired/i)
  assert.match(oauthReturn.getXeroCallbackNotice('error', 'provider_error').message, /try again/i)
  assert.equal(oauthReturn.getXeroCallbackNotice(null, 'unexpected_error'), null)
})

test('Xero routes bind return intent to the existing state flow without exposing tokens', async () => {
  const [connectSource, callbackSource] = await Promise.all([
    readFile(projectFile('app/api/xero/connect/route.ts'), 'utf8'),
    readFile(projectFile('app/api/xero/callback/route.ts'), 'utf8'),
  ])

  assert.match(connectSource, /buildLoginPath\(buildXeroConnectPath\(returnTo\)\)/)
  assert.match(connectSource, /XERO_RETURN_COOKIE_NAME/)
  assert.match(connectSource, /httpOnly: true/)
  assert.match(connectSource, /sameSite: 'lax'/)

  const stateValidationIndex = callbackSource.indexOf('safeEqualStrings(returnedState, storedState)')
  const providerErrorIndex = callbackSource.indexOf('if (providerError)')
  assert.ok(stateValidationIndex >= 0 && stateValidationIndex < providerErrorIndex)
  assert.match(callbackSource, /providerError === 'access_denied' \? 'cancelled'/)
  assert.match(callbackSource, /buildXeroCallbackDestination/)
  assert.match(callbackSource, /encryptXeroToken\(accessToken\)/)
  assert.match(callbackSource, /encryptXeroToken\(refreshToken\)/)
  assert.doesNotMatch(callbackSource, /searchParams\.set\(['"]access_token/)
  assert.doesNotMatch(callbackSource, /searchParams\.set\(['"]refresh_token/)
})
