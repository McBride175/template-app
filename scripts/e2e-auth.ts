import { chromium } from '@playwright/test'
import { mkdir, chmod, rm } from 'node:fs/promises'
import { assertTestEnvironment, authFile, baseURL } from '../tests/e2e/environment'
import { verifyServedEnvironment } from '../tests/e2e/global-setup'

// One deliberate interactive login, using a fresh browser rather than a personal
// profile. No credentials are read, recorded in source, or printed.
async function main() {
  assertTestEnvironment(false)
  await verifyServedEnvironment(false)
  await mkdir('playwright/.auth', { recursive: true, mode: 0o700 })
  await chmod('playwright/.auth', 0o700)
  const browser = await chromium.launch({ headless: false })
  try {
    const context = await browser.newContext()
    await context.route('**/api/accounting/refresh**', route => route.abort('blockedbyclient'))
    await context.route('**/api/xero/**', route => {
      if (/\/(connect|sync|auto-sync)(\?|$)/.test(route.request().url())) return route.abort('blockedbyclient')
      return route.continue()
    })
    const page = await context.newPage()
    await page.goto(`${baseURL}/login`)
    console.info('Sign in with the dedicated Supabase Test account in the fresh browser. Xero OAuth/refresh are blocked.')
    await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor({ timeout: 300_000 })
    await context.storageState({ path: authFile })
    await chmod(authFile, 0o600)
    console.info(`Saved dedicated Test session to ${authFile}. Set E2E_TEST_USER_ID in .env.local before running authenticated tests.`)
  } catch {
    await rm(authFile, { force: true })
    throw new Error('Test session capture failed; no authentication state retained. Ensure the guarded E2E server is running.')
  } finally {
    await browser.close()
  }
}

main().catch(() => {
  console.error("Test session capture failed. Verify the local Test server and recapture; no credentials are printed.")
  process.exitCode = 1
})
