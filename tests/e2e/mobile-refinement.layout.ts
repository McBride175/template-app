import { test, expect } from '@playwright/test'

// Synthetic local presentation only. No authenticated/financial journey or writes.
test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => {
    const request = route.request()
    return new URL(request.url()).origin === 'http://127.0.0.1:6006' && ['GET', 'HEAD'].includes(request.method())
      ? route.continue() : route.abort('blockedbyclient')
  })
})
const story = (id: string) => `/iframe.html?id=yuohme-${id}&viewMode=story`

for (const width of [320, 390, 768, 1440]) {
  test(`logo, menu and Back to #1 at ${width}px preserve focus, timing and supplied amounts`, async ({ page }) => {
    const apiRequests: string[] = []
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()) })
    await page.setViewportSize({ width, height: 844 })
    await page.goto(story('collectionqueue--back-to-first'))
    await expect(page.getByRole('link', { name: 'Yuohme workspace' })).toHaveAttribute('href', '/dashboard')
    if (width < 1024) {
      const menu = page.getByRole('button', { name: 'Open navigation' })
      await expect(menu).toHaveText('Menu')
      const box = (await menu.boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect((await page.locator('header').boundingBox())!.height).toBeLessThan(85)
    }
    const customer = page.getByRole('article')
    await expect(customer.getByText('Priority 3 of 6')).toBeVisible()
    await page.getByRole('button', { name: /Do not follow up until/ }).click()
    await page.getByRole('button', { name: 'In 3 days', exact: true }).click()
    const back = page.getByRole('button', { name: 'Back to #1', exact: true })
    await back.focus()
    await page.keyboard.press('Enter')
    await expect(customer.getByRole('heading', { name: 'Northbridge Supplies' })).toBeVisible()
    await expect(customer.getByText('£6,842.50', { exact: true })).toBeVisible()
    await expect(customer).toBeFocused()
    await expect(page.getByRole('button', { name: /Do not follow up until/ })).toContainText('In 3 days')
    await expect(back).toHaveCount(0)
    expect(apiRequests).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await customer.boundingBox())!.y).toBeGreaterThanOrEqual(0)
  })

  test(`disputes controls at ${width}px keep selected GET values through disclosure`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(story('disputesfilters--collapsed'))
    const status = page.getByLabel('Status', { exact: true })
    const toggle = page.getByRole('button', { name: /^Filters/ })
    await expect(page.getByLabel('Search customer or invoice')).toBeVisible()
    if (width < 640) {
      await expect(status).toBeHidden()
      await toggle.focus()
      await page.keyboard.press('Enter')
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    } else await expect(toggle).toBeHidden()
    await status.selectOption('needs_review')
    await page.getByLabel('Customer', { exact: true }).selectOption('synthetic-2')
    await page.getByLabel('Sort', { exact: true }).selectOption('oldest')
    await page.getByLabel('Search customer or invoice').fill('INV-7')
    if (width < 640) {
      await toggle.click()
      await expect(status).toBeHidden()
    }
    const values = await page.locator('form').evaluate(form => Object.fromEntries(new FormData(form as HTMLFormElement)))
    expect(values).toEqual({ tenantId: 'synthetic', pageSize: '25', q: 'INV-7', status: 'needs_review', customer: 'synthetic-2', sort: 'oldest' })
    if (width < 640) {
      await toggle.click()
      await expect(status).toHaveValue('needs_review')
      await expect(page.getByLabel('Customer', { exact: true })).toHaveValue('synthetic-2')
      await page.getByRole('button', { name: 'Reset filters', exact: true }).click()
      await expect(status).toHaveValue('active')
      await expect(page.getByLabel('Search customer or invoice')).toHaveValue('')
      await expect(page.getByLabel('Customer', { exact: true })).toHaveValue('')
      await expect(page.getByLabel('Sort', { exact: true })).toHaveValue('amount_desc')
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('active filters expose their count and a scoped reset while collapsed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(story('disputesfilters--active-filters'))
  await expect(page.getByRole('button', { name: /^Filters/ })).toContainText('3 active')
  await expect(page.getByLabel('Status', { exact: true })).toBeHidden()
  const clear = page.getByRole('link', { name: 'Clear filters' })
  await expect(clear).toBeVisible()
  const href = new URL((await clear.getAttribute('href'))!, 'http://127.0.0.1:6006')
  expect(href.searchParams.get('tenantId')).toBe('synthetic')
  expect(href.searchParams.get('pageSize')).toBe('50')
  expect(href.searchParams.get('page')).toBe('1')
  expect(href.searchParams.get('status')).toBe('active')
})

test('first mobile viewport presents collection outcomes and preserves material refresh warnings', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(story('collectionqueue--compact-dashboard'))
  const action = page.getByRole('button', { name: 'No response', exact: true })
  await expect(action).toBeVisible()
  const box = (await action.boundingBox())!
  expect(box.y + box.height).toBeLessThan(844)
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible()
  await page.getByRole('article').locator('summary').filter({ hasText: 'Financial details' }).click()
  await expect(page.getByRole('button', { name: 'Refresh priorities', exact: true })).toBeVisible()
  await page.goto(story('collectionqueue--first-action'))
  await expect(page.getByRole('button', { name: 'No response', exact: true })).toBeVisible()
  const firstAction = (await page.getByRole('button', { name: 'No response', exact: true }).boundingBox())!
  expect(firstAction.y + firstAction.height).toBeLessThan(844)
  await page.goto(story('collectionqueue--refresh-warning'))
  await expect(page.getByText(/Payments made since then may not yet be reflected/)).toBeVisible()
  await expect(page.getByText(/Verify recent payment activity before contacting customers/)).toBeVisible()
})
