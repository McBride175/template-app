import { loadEnvConfig } from '@next/env'
import { existsSync } from 'node:fs'

loadEnvConfig(process.cwd(), true)

export const testProjectRef = 'rbmxegyiwntomhpbepnu'
export const supabaseOrigin = `https://${testProjectRef}.supabase.co`
const port = process.env.E2E_PORT || '3000'
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) {
  throw new Error('E2E_PORT must be an unprivileged TCP port (1024–65535).')
}
export const developPreviewOrigin = 'https://template-app-git-develop-james-mcbrides-projects.vercel.app'
const localOrigin = `http://127.0.0.1:${port}`
export const baseURL = process.env.E2E_BASE_URL || localOrigin
if (baseURL !== localOrigin && baseURL !== developPreviewOrigin) {
  throw new Error('E2E_BASE_URL must be the configured loopback origin or the exact documented develop Preview origin.')
}
export const isLocal = baseURL === localOrigin
export const authFile = `playwright/.auth/test-user-${isLocal ? port : 'preview'}.json`
export const authenticated = Boolean(process.env.E2E_TEST_USER_ID && existsSync(authFile))

export function assertTestEnvironment(requireSavedSession = true) {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== supabaseOrigin || process.env.VERCEL_ENV === 'production') {
    throw new Error(`E2E requires Supabase Test ${testProjectRef} and a non-Production application.`)
  }
  if (requireSavedSession && process.env.E2E_TEST_USER_ID && !existsSync(authFile)) {
    throw new Error(`Missing ${authFile}. Capture the dedicated Test session with pnpm test:e2e:auth first.`)
  }
}
