import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const projectFile = (path) => new URL(`../../${path}`, import.meta.url)

function loadAuthWithClient(auth) {
  return loadTypeScriptModule(projectFile('lib/auth.ts'), {
    mocks: { '@/lib/supabase': { supabase: { auth } } },
  })
}

test('successful and incorrect password login results are passed through', async () => {
  const calls = []
  const expectedSuccess = { data: { session: { access_token: 'test' } }, error: null }
  const invalidError = { code: 'invalid_credentials', message: 'Invalid login credentials' }
  let nextResult = expectedSuccess
  const auth = loadAuthWithClient({
    async signInWithPassword(input) {
      calls.push(input)
      return nextResult
    },
  })

  assert.equal(await auth.signInWithPassword('sme@example.test', 'safe-password'), expectedSuccess)
  nextResult = { data: { session: null }, error: invalidError }
  assert.equal((await auth.signInWithPassword('sme@example.test', 'wrong')).error, invalidError)
  assert.deepEqual(calls, [
    { email: 'sme@example.test', password: 'safe-password' },
    { email: 'sme@example.test', password: 'wrong' },
  ])
})

test('email sign-in links cannot create accounts accidentally', async () => {
  let received
  const auth = loadAuthWithClient({
    async signInWithOtp(input) {
      received = input
      return { data: { session: null, user: null }, error: null }
    },
  })

  await auth.signInWithEmailOtp('sme@example.test', 'https://preview.example/auth/callback')
  assert.equal(received.options.shouldCreateUser, false)
  assert.equal(received.options.emailRedirectTo, 'https://preview.example/auth/callback')
})

test('signup confirmation and password recovery use explicit Preview-aware redirects', async () => {
  const calls = []
  const auth = loadAuthWithClient({
    async signUp(input) {
      calls.push(['signup', input])
      return { data: { session: null, user: {} }, error: null }
    },
    async resetPasswordForEmail(email, options) {
      calls.push(['recovery', { email, options }])
      return { data: {}, error: null }
    },
  })

  await auth.signUpWithPassword(
    'sme@example.test',
    'safe-password',
    'https://preview.example/auth/callback?next=%2Fcustomers'
  )
  await auth.sendPasswordRecovery(
    'sme@example.test',
    'https://preview.example/auth/callback?next=%2Freset-password'
  )

  assert.equal(
    calls[0][1].options.emailRedirectTo,
    'https://preview.example/auth/callback?next=%2Fcustomers'
  )
  assert.equal(
    calls[1][1].options.redirectTo,
    'https://preview.example/auth/callback?next=%2Freset-password'
  )
})

test('both signed-in password entry points update the authenticated user directly', async () => {
  for (const path of [
    'app/components/ChangePasswordButton.tsx',
    'app/reset-password/ResetPasswordForm.tsx',
  ]) {
    const source = await readFile(projectFile(path), 'utf8')
    assert.match(source, /supabase\.auth\.updateUser\(\{ password \}\)/, path)
  }
})

test('global sign-out performs a hard redirect after clearing the session', async () => {
  const source = await readFile(projectFile('app/components/Nav.tsx'), 'utf8')

  assert.match(source, /await supabase\.auth\.signOut\(\)/)
  assert.match(source, /window\.location\.replace\('\/login\?status=signed_out'\)/)
  assert.doesNotMatch(source, /router\.replace\('\/login\?status=signed_out'\)/)
})
