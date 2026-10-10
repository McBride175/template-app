import { createServerClient } from '@supabase/ssr'
import { readFileSync } from 'node:fs'
import type { BrowserContext } from '@playwright/test'
import { assertTestEnvironment, authenticated, authFile, baseURL, supabaseOrigin, testProjectRef } from './environment'

// Verify the served build too: a reused server may have different environment values.
export async function verifyServedEnvironment(requireSavedSession = true) {
  assertTestEnvironment(requireSavedSession)
  const response = await fetch(`${baseURL}/login`, { redirect: 'error', signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error('E2E Test login page is unavailable.')
  const html = await response.text()
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1])
  const sources = await Promise.all(scripts.map(async src => {
    const url = new URL(src, baseURL)
    if (url.origin !== baseURL) throw new Error('Unexpected external application script.')
    const script = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!script.ok) throw new Error('Could not verify Test application scripts.')
    return script.text()
  }))
  // Vendor bundles contain documentation examples (example.supabase.co, etc.).
  // Actual project references have 20 lowercase alphanumeric characters.
  const hosts = new Set(sources.join('\n').match(/https:\/\/[a-z0-9]{20}\.supabase\.co/g))
  if (!hosts.has(supabaseOrigin) || [...hosts].some(host => host !== supabaseOrigin)) {
    throw new Error('Served application does not exclusively target Supabase Test. Stop the old server and rerun.')
  }
}

export default async function globalSetup() {
  await verifyServedEnvironment()
  if (!authenticated) return
  const state = JSON.parse(readFileSync(authFile, 'utf8')) as Awaited<ReturnType<BrowserContext['storageState']>>
  if (state.cookies.some(cookie => cookie.name.startsWith('sb-') && !cookie.name.startsWith(`sb-${testProjectRef}-`))) {
    throw new Error('Saved session contains authentication for a different Supabase project.')
  }
  const client = createServerClient(supabaseOrigin, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => state.cookies, setAll: () => {} },
    auth: { autoRefreshToken: false },
  })
  const { data, error } = await client.auth.getUser()
  if (error || data.user?.id !== process.env.E2E_TEST_USER_ID) {
    throw new Error('Saved session is expired or does not belong to E2E_TEST_USER_ID. Recapture the dedicated Test session.')
  }
}
