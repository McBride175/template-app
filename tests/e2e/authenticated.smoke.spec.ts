import { test, expect } from './fixtures'
import { authenticated } from './environment'

test.describe('dedicated Supabase Test session', () => {
  test.skip(!authenticated, 'Needs captured Test storageState and E2E_TEST_USER_ID; see docs/e2e.md.')

  test('existing Test user reaches the authenticated dashboard @smoke', async ({ page }) => {
    await page.goto('/login?next=/dashboard')
    await expect(page).toHaveURL(url => url.pathname === '/dashboard')
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Customers', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toHaveCount(0)
    await expect(page.getByText('Preparing your dashboard…', { exact: true })).toHaveCount(0)
    // An unconnected dedicated account has a legitimate onboarding state.
    await expect(page.getByRole('heading', { name: /Connect Xero|Next to chase|No overdue amount to chase|Queue complete|No eligible customers/ })).toBeVisible()
  })

  test('queue opens the designated isolated customer and invoice context @smoke', async ({ page }) => {
    test.skip(!process.env.E2E_CUSTOMER_NAME || !process.env.E2E_TENANT_ID, 'Needs designated Test tenant/customer with actionable debt.')
    await page.goto(`/collections/actions?tenantId=${encodeURIComponent(process.env.E2E_TENANT_ID!)}`)
    const row = page.getByRole('row').filter({ hasText: process.env.E2E_CUSTOMER_NAME! })
    await expect(row).toHaveCount(1)
    await row.getByRole('link', { name: 'Manage invoices', exact: true }).click()
    const detail = page.getByRole('region', { name: 'Selected customer detail' })
    await expect(detail).toBeVisible()
    await expect(detail.getByRole('heading', { name: process.env.E2E_CUSTOMER_NAME!, exact: true })).toBeVisible()
    await expect(detail).toContainText('Outstanding')
    await expect(detail.getByRole('link', { name: 'View history', exact: true })).toBeVisible()
  })
})

test.describe('isolated mutation fixtures pending', () => {
  // Static fixme avoids launching browser contexts for unavailable journeys.
  test.fixme(true, 'Needs per-run customer/invoice fixtures, certified Promise evidence and failure-safe cleanup; see docs/e2e.md.')
  test('action outcome appears in history with selected follow-up @smoke', () => {})
  test('dispute changes disputed amount and customer To chase @smoke', () => {})
  test('promise changes promised amount and customer workflow @smoke', () => {})
})
