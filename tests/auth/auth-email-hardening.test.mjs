import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const projectFile = (path) => new URL(`../../${path}`, import.meta.url)
const projectPath = (path) => decodeURIComponent(projectFile(path).pathname)

test('normal automated tests do not reference the hosted Auth-email diagnostic or hosted URL', async () => {
  const packageJson = JSON.parse(await readFile(projectFile('package.json'), 'utf8'))
  const normalTestCommands = Object.entries(packageJson.scripts)
    .filter(([name]) => name === 'test' || name.startsWith('test:'))
    .map(([, command]) => command)
    .join('\n')

  assert.doesNotMatch(normalTestCommands, /auth-email-e2e|supabase\.co/)

  for (const path of [
    'tests/auth/auth-client-contract.test.mjs',
    'tests/auth/auth-flow.test.mjs',
  ]) {
    assert.doesNotMatch(await readFile(projectFile(path), 'utf8'), /https:\/\/[^'"\s]+\.supabase\.co/)
  }
})

test('hosted Auth-email diagnostic does nothing unless an operation and allow flag are explicit', async () => {
  const scriptPath = projectPath('scripts/auth-email-e2e.mjs')
  const noArguments = await execFileAsync(process.execPath, [scriptPath], {
    env: {},
    timeout: 5_000,
  })

  assert.match(noArguments.stdout, /No operation is selected by default/i)

  await assert.rejects(
    execFileAsync(process.execPath, [scriptPath, 'signup'], { env: {}, timeout: 5_000 }),
    (error) => {
      assert.equal(error.code, 64)
      assert.match(error.stderr, /Refusing to send.*--allow-auth-email-send/i)
      return true
    }
  )
})

test('hosted Auth-email diagnostic is locked to Test and rejects Production before networking', async () => {
  const scriptPath = projectPath('scripts/auth-email-e2e.mjs')

  await assert.rejects(
    execFileAsync(
      process.execPath,
      [scriptPath, 'recovery', '--allow-auth-email-send'],
      {
        env: {
          NEXT_PUBLIC_SUPABASE_URL: 'https://sswyxbugbdoadktyaows.supabase.co',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'not-used',
          AUTH_EMAIL_E2E_TARGET_EMAIL: 'not-used@example.test',
          AUTH_EMAIL_E2E_REDIRECT_ORIGIN: 'http://localhost:3000',
        },
        timeout: 5_000,
      }
    ),
    (error) => {
      assert.equal(error.code, 65)
      assert.match(error.stderr, /locked to Test Supabase project rbmxegyiwntomhpbepnu/i)
      assert.doesNotMatch(error.stdout, /request was accepted/i)
      return true
    }
  )
})

test('Auth forms preserve generic email-link responses and isolate Google from CAPTCHA', async () => {
  const loginSource = await readFile(projectFile('app/login/LoginForm.tsx'), 'utf8')
  const signupSource = await readFile(projectFile('app/signup/SignUpForm.tsx'), 'utf8')

  assert.match(loginSource, /If an account exists for that email, a secure sign-in link/i)
  assert.match(loginSource, /If an account exists for that email, a secure password link/i)
  assert.match(signupSource, /you may already have an account/i)
  assert.match(loginSource, /signInWithGoogle\(\s*absoluteAuthUrl/)
  assert.match(signupSource, /signInWithGoogle\(\s*absoluteAuthUrl/)
})

test('Turnstile stays hidden unless managed risk analysis requires interaction', async () => {
  const source = await readFile(projectFile('app/components/TurnstileCaptcha.tsx'), 'utf8')

  assert.match(source, /render=explicit/)
  assert.match(source, /appearance: 'interaction-only'/)
  assert.match(source, /theme: 'auto'/)
  assert.match(source, /size: 'flexible'/)
})

test('protected forms discard consumed CAPTCHA tokens after every Auth attempt', async () => {
  for (const path of [
    'app/login/LoginForm.tsx',
    'app/signup/SignUpForm.tsx',
    'app/components/ChangePasswordButton.tsx',
  ]) {
    const source = await readFile(projectFile(path), 'utf8')
    assert.match(source, /captchaRef\.current\?\.reset\(\)/, path)
  }
})

test('operational reporting emits only stable non-PII Auth fields to Sentry', async () => {
  const source = await readFile(projectFile('lib/auth-observability.ts'), 'utf8')

  assert.match(source, /Sentry\.captureMessage\('Supabase Auth operational failure'/)
  assert.match(source, /auth_failure_category/)
  assert.doesNotMatch(source, /\.message|email:/)
})

test('the deleted temporary harness cannot reappear alongside the guarded permanent diagnostic', async () => {
  await assert.rejects(access(projectFile('.tmp-auth-email-e2e.mjs')))
})
