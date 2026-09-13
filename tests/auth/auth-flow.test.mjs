import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const projectFile = (path) => new URL(`../../${path}`, import.meta.url)
const authFlow = loadTypeScriptModule(projectFile('lib/auth-flow.ts'))
const authCaptcha = loadTypeScriptModule(projectFile('lib/auth-captcha.ts'))
const passwords = loadTypeScriptModule(projectFile('lib/password.ts'))

test('safe internal destinations preserve paths, queries, and fragments', () => {
  assert.equal(
    authFlow.sanitizeAuthRedirectPath('/customers?tenantId=tenant_test#queue'),
    '/customers?tenantId=tenant_test#queue'
  )
})

test('external, protocol-relative, backslash, and auth-loop destinations are rejected', () => {
  const unsafeDestinations = [
    'https://attacker.example/path',
    '//attacker.example/path',
    '/\\attacker.example/path',
    '/login',
    '/signup?next=/login',
    '/auth/callback?code=stolen',
  ]

  for (const destination of unsafeDestinations) {
    assert.equal(authFlow.sanitizeAuthRedirectPath(destination), '/dashboard', destination)
  }
})

test('password recovery nests a safe intended destination in the callback', () => {
  const callback = new URL(
    authFlow.buildPasswordRecoveryCallbackPath('/pricing?plan=pro'),
    'https://app.example'
  )
  assert.equal(callback.pathname, '/auth/callback')

  const reset = new URL(callback.searchParams.get('next'), 'https://app.example')
  assert.equal(reset.pathname, '/reset-password')
  assert.equal(reset.searchParams.get('next'), '/pricing?plan=pro')
})

test('invalid password login remains non-enumerating and gives direct recovery choices', () => {
  const message = authFlow.getAuthActionErrorMessage(
    { code: 'invalid_credentials', message: 'Invalid login credentials' },
    'password-login'
  )
  assert.match(message, /continue with Google/i)
  assert.match(message, /secure password link/i)
  assert.doesNotMatch(message, /provider|identity|Supabase/i)
})

test('known callback failures produce plain-English guidance', () => {
  assert.match(authFlow.getAuthPageErrorMessage('oauth_cancelled'), /cancelled/i)
  assert.match(authFlow.getAuthPageErrorMessage('auth_link_expired'), /expired/i)
  assert.equal(authFlow.getAuthPageErrorMessage('attacker-controlled-code'), null)
})

test('configured CAPTCHA blocks a missing token and accepts a completed challenge', () => {
  assert.match(authCaptcha.getAuthCaptchaValidationError('turnstile-site-key', null), /security check/i)
  assert.equal(
    authCaptcha.getAuthCaptchaValidationError('turnstile-site-key', 'captcha-token'),
    null
  )
  assert.equal(authCaptcha.getAuthCaptchaValidationError('', null), null)
})

test('CAPTCHA and Auth-email operational failures have stable classifications', () => {
  const captchaError = { code: 'captcha_failed', status: 400 }

  assert.match(authFlow.getAuthActionErrorMessage(captchaError, 'signup'), /security check/i)
  assert.equal(
    authFlow.classifyAuthOperationalFailure(captchaError, 'signup'),
    'captcha_failed'
  )
  assert.equal(
    authFlow.classifyAuthOperationalFailure(
      { code: 'over_email_send_rate_limit', status: 429 },
      'email-link'
    ),
    'auth_email_rate_limited'
  )
  assert.equal(
    authFlow.classifyAuthOperationalFailure({ code: 'unexpected_failure', status: 500 }, 'signup'),
    'auth_service_failed'
  )
  assert.equal(
    authFlow.classifyAuthOperationalFailure(
      { code: 'invalid_credentials', status: 400 },
      'password-login'
    ),
    null
  )
})

test('password validation matches the UI contract', () => {
  assert.match(passwords.validatePassword('short'), /at least 10/i)
  assert.match(passwords.validatePassword('alllowercase'), /at least 2/i)
  assert.equal(passwords.validatePassword('correct-horse'), null)
})
