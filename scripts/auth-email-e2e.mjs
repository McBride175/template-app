#!/usr/bin/env node

import process from 'node:process'

const TEST_PROJECT_REF = 'rbmxegyiwntomhpbepnu'
const ALLOWED_REDIRECT_ORIGINS = new Set([
  'http://localhost:3000',
  'https://template-app-git-develop-james-mcbrides-projects.vercel.app',
])
const SEND_OPERATIONS = new Set(['signup', 'recovery', 'magic-link'])
const SEND_PERMISSION_FLAG = '--allow-auth-email-send'

function printUsage() {
  console.log(`Test-only Supabase Auth email diagnostic

Usage:
  node --env-file=.env.local scripts/auth-email-e2e.mjs <operation> ${SEND_PERMISSION_FLAG}

Operations that send one real Auth email:
  signup       Requires AUTH_EMAIL_E2E_SIGNUP_PASSWORD
  recovery     Requests a password-recovery email
  magic-link   Requests a magic sign-in link without creating an account

Required environment:
  NEXT_PUBLIC_SUPABASE_URL            Must be Test project ${TEST_PROJECT_REF}
  NEXT_PUBLIC_SUPABASE_ANON_KEY       Test public/anon key
  AUTH_EMAIL_E2E_TARGET_EMAIL         Deliberately selected Test recipient
  AUTH_EMAIL_E2E_REDIRECT_ORIGIN      localhost or the stable develop Preview

Optional environment:
  AUTH_EMAIL_E2E_CAPTCHA_TOKEN        Fresh, single-use token when Test CAPTCHA is enabled

No operation is selected by default. Every send requires both an explicit operation and
${SEND_PERMISSION_FLAG}.`)
}

function fail(message, exitCode = 64) {
  console.error(message)
  process.exitCode = exitCode
}

function requireTestProject(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL must be a valid URL.')
  }

  if (url.protocol !== 'https:' || url.hostname !== `${TEST_PROJECT_REF}.supabase.co`) {
    throw new Error(
      `Refusing to run: this harness is locked to Test Supabase project ${TEST_PROJECT_REF}.`
    )
  }

  return url.origin
}

function requireAllowedRedirectOrigin(rawOrigin) {
  let origin
  try {
    origin = new URL(rawOrigin).origin
  } catch {
    throw new Error('AUTH_EMAIL_E2E_REDIRECT_ORIGIN must be a valid URL.')
  }

  if (!ALLOWED_REDIRECT_ORIGINS.has(origin) || rawOrigin.replace(/\/$/, '') !== origin) {
    throw new Error(
      'AUTH_EMAIL_E2E_REDIRECT_ORIGIN must be exactly localhost or the stable develop Preview origin.'
    )
  }

  return origin
}

const args = new Set(process.argv.slice(2))
const operation = process.argv.slice(2).find((argument) => !argument.startsWith('--'))

if (!operation || operation === 'help' || args.has('--help')) {
  printUsage()
} else if (!SEND_OPERATIONS.has(operation)) {
  fail(`Unknown operation: ${operation}. No Auth request was made.`)
  printUsage()
} else if (!args.has(SEND_PERMISSION_FLAG)) {
  fail(
    `Refusing to send. Re-run with ${SEND_PERMISSION_FLAG} only when one real Test Auth email is intended.`
  )
} else {
  try {
    const supabaseUrl = requireTestProject(process.env.NEXT_PUBLIC_SUPABASE_URL)
    const redirectOrigin = requireAllowedRedirectOrigin(
      process.env.AUTH_EMAIL_E2E_REDIRECT_ORIGIN
    )
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
    const email = process.env.AUTH_EMAIL_E2E_TARGET_EMAIL?.trim()
    const captchaToken = process.env.AUTH_EMAIL_E2E_CAPTCHA_TOKEN?.trim() || undefined

    if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is required.')
    if (!email) throw new Error('AUTH_EMAIL_E2E_TARGET_EMAIL is required.')
    if (operation === 'signup' && !process.env.AUTH_EMAIL_E2E_SIGNUP_PASSWORD) {
      throw new Error('AUTH_EMAIL_E2E_SIGNUP_PASSWORD is required for signup.')
    }

    console.error(
      'WARNING: This operation sends one real Supabase Auth email and consumes the shared Test project email quota.'
    )
    console.error(`Explicit operation: ${operation}. Test project: ${TEST_PROJECT_REF}.`)

    const { createClient } = await import('@supabase/supabase-js')
    const client = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const callbackUrl = `${redirectOrigin}/auth/callback?next=%2Fdashboard`
    const recoveryUrl = `${redirectOrigin}/auth/callback?next=%2Freset-password%3Fnext%3D%252Fdashboard`

    let result
    if (operation === 'signup') {
      result = await client.auth.signUp({
        email,
        password: process.env.AUTH_EMAIL_E2E_SIGNUP_PASSWORD,
        options: { emailRedirectTo: callbackUrl, captchaToken },
      })
    } else if (operation === 'recovery') {
      result = await client.auth.resetPasswordForEmail(email, {
        redirectTo: recoveryUrl,
        captchaToken,
      })
    } else {
      result = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: callbackUrl, shouldCreateUser: false, captchaToken },
      })
    }

    if (result.error) {
      console.error('Auth request failed.', {
        code: result.error.code ?? null,
        status: result.error.status ?? null,
      })
      process.exitCode = 1
    } else {
      console.log(`The ${operation} Auth email request was accepted by Test Supabase.`)
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : 'The guarded Auth email request failed.', 65)
  }
}
