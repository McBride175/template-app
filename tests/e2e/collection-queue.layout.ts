import { test, expect } from '@playwright/test'

// Isolated synthetic Storybook presentation, never authenticated financial E2E.
test.beforeEach(async ({ context }) => {
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === 'http://127.0.0.1:6006' && ['GET', 'HEAD'].includes(request.method())) await route.continue()
    else await route.abort('blockedbyclient')
  })
})
const story = (name: string) => `/iframe.html?id=yuohme-collectionqueue--${name}&viewMode=story`

for (const width of [320, 390, 768, 1440]) test(`focused queue at ${width}px preserves amounts, navigation and usable actions`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 })
  await page.goto(story('first-priority'))
  const customer = page.getByRole('article')
  await expect(customer.getByRole('heading', { name: 'Northbridge Supplies' })).toBeVisible()
  await expect(customer.getByText('Priority 1 of 6')).toBeVisible()
  await expect(customer.getByText('£6,842.50', { exact: true })).toBeVisible()
  for (const button of await page.getByRole('group', { name: 'Record outcome', exact: true }).getByRole('button').all()) {
    await expect(button).toBeEnabled()
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(customer.getByRole('heading', { name: 'Cedar & Finch Studio' })).toBeVisible()
  await expect(customer.getByText('Priority 2 of 6')).toBeVisible()
  await expect(customer.getByText('£2,140.00', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await expect(customer.getByRole('heading', { name: 'Northbridge Supplies' })).toBeVisible()
})

test('desktop queue order follows supplied ranking rather than amount size', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(story('first-priority'))
  const order = page.getByRole('complementary', { name: 'Queue order' })
  await expect(order.getByRole('listitem')).toHaveCount(5)
  await order.getByRole('button', { name: /2 Cedar & Finch Studio/ }).click()
  await expect(page.getByRole('article').getByText('Priority 2 of 6')).toBeVisible()
  await expect(order.getByRole('button', { name: /2 Cedar & Finch Studio/ })).toHaveAttribute('aria-current', 'true')
})

test('long customer names and large amounts fit narrow layouts', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 1000 })
  for (const name of ['long-customer-name', 'large-amount']) {
    await page.goto(story(name))
    await expect(page.getByRole('article')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const box = await page.getByRole('article').boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(320)
  }
})

test('financial definitions remain distinct under progressive disclosure', async ({ page }) => {
  await page.goto(story('promises-disputes-credits'))
  const customer = page.getByRole('article')
  await expect(customer.getByText('£6,842.50', { exact: true })).toBeVisible()
  await customer.locator('summary').filter({ hasText: 'Financial detail' }).click()
  const details = customer.locator('details').first()
  for (const value of ['£9,792.50', '£14,120.00', '£1,200.00', '£750.00', '£1,000.00']) await expect(details.getByText(value, { exact: true })).toBeVisible()
  await expect(details.getByText('Disputed overdue')).toBeVisible()
  await expect(details.getByText('Currently promised (overdue)')).toBeVisible()
})

test('note and follow-up controls invoke only the selected presentation callback', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 })
  await page.goto(story('first-priority'))
  await page.getByRole('button', { name: /Do not follow up until/ }).click()
  await page.getByRole('button', { name: 'Choose date', exact: true }).click()
  await expect(page.getByRole('button', { name: 'No response', exact: true })).toBeDisabled()
  await page.getByLabel('Date', { exact: true }).fill('2026-10-15')
  await page.getByRole('button', { name: 'Add note', exact: true }).click()
  await page.getByLabel('Note (optional)').fill('Synthetic callback check')
  await page.getByRole('button', { name: 'Message sent', exact: true }).focus()
  await expect(page.getByRole('button', { name: 'Message sent', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('preview-event')).toContainText('"outcome":"message_sent"')
  await expect(page.getByTestId('preview-event')).toContainText('"date":"2026-10-15"')
  await expect(page.getByTestId('preview-event')).toContainText('Synthetic callback check')
})

test('loading and distinct empty/error states remain truthful and actionable', async ({ page }) => {
  for (const [name, text] of [['loading', 'Loading next customer…'], ['empty-queue', 'Queue complete'], ['no-overdue', 'No overdue amount to chase'], ['no-eligible', 'No eligible customers'], ['error', 'Priorities unavailable']]) {
    await page.goto(story(name))
    await expect(page.getByRole('heading', { name: text, exact: true })).toBeVisible()
    await expect(page.getByRole('article')).toHaveCount(0)
  }
  await expect(page.getByRole('alert')).toContainText('Unable to load collection priorities')
  await expect(page.getByRole('button', { name: 'Refresh priorities', exact: true })).toBeEnabled()
})

test('saving and uncertain states block duplicate outcomes while preserving recovery', async ({ page }) => {
  await page.goto(story('saving'))
  const group = page.getByRole('group', { name: 'Record outcome', exact: true })
  for (const button of await group.getByRole('button').all()) await expect(button).toBeDisabled()
  await page.goto(story('uncertain-save'))
  for (const button of await group.getByRole('button').all()) await expect(button).toBeDisabled()
  await page.getByRole('button', { name: 'Retry save', exact: true }).click()
  await expect(page.getByTestId('preview-event')).toContainText('Preview retry callback')
})
