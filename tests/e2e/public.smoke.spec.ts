import { test, expect } from './fixtures'

test('protected collection journeys preserve their destination at sign-in @smoke', async ({ page }) => {
  for (const destination of ['/dashboard', '/collections/actions', '/customers?customerSourceId=e2e-unowned', '/customers/e2e-unowned/history', '/disputes']) {
    await page.goto(destination)
    await expect(page).toHaveURL(url => url.pathname === '/login' && (url.searchParams.get('next') ?? '/dashboard') === destination)
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0)
  }
})

test('sign-in and signup preserve customer destination and entered email @smoke', async ({ page }) => {
  const next = '/customers?customerSourceId=e2e-unowned'
  await page.goto(`/login?next=${encodeURIComponent(next)}`)
  await page.getByLabel('Email', { exact: true }).fill('smoke@example.test')
  await page.getByRole('link', { name: 'Create an account', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('smoke@example.test')
  await expect(page).toHaveURL(url => url.pathname === '/signup' && url.searchParams.get('next') === next)
  await page.getByRole('link', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('smoke@example.test')
  await expect(page).toHaveURL(url => url.pathname === '/login' && url.searchParams.get('next') === next)
})

test('onboarding offers the password route without starting Xero OAuth @smoke', async ({ page }) => {
  await page.goto('/start')
  await expect(page.getByRole('heading', { name: 'Continue to Yuohme' })).toBeVisible()
  await page.getByRole('link', { name: 'Sign in with password' }).click()
  await expect(page).toHaveURL(url => url.pathname === '/login' && url.searchParams.get('next') === '/start')
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
})

test('invalid auth callback gives recovery feedback and prevents an external redirect @smoke', async ({ page }) => {
  await page.goto('/auth/callback?next=https%3A%2F%2Fexample.invalid')
  await expect(page).toHaveURL(url => url.pathname === '/login' && (url.searchParams.get('next') ?? '/dashboard') === '/dashboard')
  await expect(page.getByRole('alert').filter({ hasText: 'sign-in link' })).toContainText('incomplete')
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
})

test('collection API reads reject signed-out access without leaking customer data @smoke', async ({ request }) => {
  // Valid request shapes reach the authentication boundary instead of failing
  // earlier parameter validation. All identities are deliberately unowned.
  for (const path of ['/api/collections/actions',
    '/api/collections/customer-history?tenantId=e2e-unowned&sourceSystem=xero&customerSourceId=e2e-unowned', '/api/collections/disputes',
    '/api/collections/invoice-disputes?tenantId=e2e-unowned&customerSourceId=e2e-unowned',
    '/api/collections/invoice-promises?tenantId=e2e-unowned&invoiceSourceId=e2e-unowned']) {
    const response = await request.get(path, { maxRedirects: 0 })
    expect(response.status(), path).toBe(401)
    expect(response.headers()['content-type'], path).toContain('application/json')
    const body = await response.json()
    expect(body.ok, path).not.toBe(true)
    expect(body.rows, path).toBeUndefined()
    expect(body.invoices, path).toBeUndefined()
  }
})
