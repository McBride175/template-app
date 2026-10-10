import { readFile } from 'node:fs/promises'
import type { Locator, Page } from '@playwright/test'
import { test, expect } from './fixtures'

const horizontal = '/brand/logo-horizontal.svg'
const stacked = '/brand/logo-stacked.svg'
const micro = '/brand/mark-yo.svg'

async function containedLogo(image: Locator, ratio: number) {
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
  const shape = await image.evaluate(node => {
    const r = node.getBoundingClientRect(), p = node.parentElement!.getBoundingClientRect()
    return { width: r.width, height: r.height, inside: r.left >= p.left - .1 && r.right <= p.right + .1 && r.top >= p.top - .1 && r.bottom <= p.bottom + .1 }
  })
  // Browser layout quantises fractional SVG dimensions to 1/64 CSS pixel.
  // Compare physical dimensions within that quantum, not an unrealistically
  // exact ratio (which falsely rejected the unchanged approved SVGs).
  expect(Math.abs(shape.height - shape.width / ratio)).toBeLessThanOrEqual(1 / 64)
  expect(shape.inside).toBe(true)
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
}

test('approved public navigation renders H3 and compact yo proportionally @smoke', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const path of ['/', '/pricing', '/blog', '/contact']) {
    await page.goto(path)
    const brand = page.locator('nav').getByRole('link', { name: 'Yuohme home', exact: true })
    await expect(brand).toHaveAttribute('href', '/')
    await containedLogo(brand.locator(`img[src="${horizontal}"]:visible`), 292 / 90)
    await expect(brand.locator(`img[src="${horizontal}"]`)).toHaveAttribute('alt', '')
    await expect(brand.locator(`img[src="${horizontal}"]`).locator('..')).toHaveAttribute('aria-hidden', 'true')
    await noOverflow(page)
  }
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await containedLogo(page.locator(`nav img[src="${micro}"]:visible`), 1)
    await expect(page.locator(`nav img[src="${horizontal}"]`)).toBeHidden()
    await noOverflow(page)
  }
  await page.keyboard.press('Tab')
  const brand = page.locator('nav').getByRole('link', { name: 'Yuohme home', exact: true })
  await brand.focus()
  await expect(brand).toBeFocused()
  expect(await brand.evaluate(node => parseFloat(getComputedStyle(node).outlineWidth) >= 2)).toBe(true)
  await page.locator('nav').getByRole('link', { name: 'Pricing', exact: true }).click()
  await expect(page).toHaveURL(url => url.pathname === '/pricing')
})

test('auth cards retain the approved stack and focused onboarding uses H3 @smoke', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  for (const path of ['/login', '/signup']) {
    await page.goto(path)
    const image = page.locator(`main img[src="${stacked}"]`)
    await containedLogo(image, 146.329153686 / 146)
    await expect(image).toHaveAttribute('alt', 'Yuohme')
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
    await noOverflow(page)
  }
  await page.setViewportSize({ width: 768, height: 900 })
  await page.goto('/start')
  await containedLogo(page.locator(`header img[src="${horizontal}"]`), 292 / 90)
  await expect(page.getByRole('img', { name: 'Yuohme', exact: true })).toHaveCount(1)
  await expect(page.getByRole('link', { name: 'Sign in with password' })).toHaveAttribute('href', /\/login\?next=/)
  await expect(page.locator('nav')).toHaveCount(0)
  await expect(page.locator('footer')).toHaveCount(0)
  await noOverflow(page)
})

test('canonical assets and icons are served exactly and SVG loading reserves space @smoke', async ({ page, request }) => {
  const names = ['logo-horizontal', 'logo-stacked', 'logo-horizontal-monochrome', 'logo-stacked-monochrome', 'logo-horizontal-white', 'logo-stacked-white', 'logo-square', 'mark-yo']
  for (const name of names) {
    const response = await request.get(`/brand/${name}.svg`)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('image/svg+xml')
    expect(await response.body()).toEqual(await readFile(`public/brand/${name}.svg`))
  }
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/brand/*.svg', async route => { await pending; await route.continue() })
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await expect(page.locator(`nav img[src="${horizontal}"]`)).toBeAttached()
    const images = page.locator('img[src^="/brand/"]:visible')
    const measure = () => images.evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }))
    const before = await measure()
    expect(await images.evaluateAll(nodes => nodes.some(node => !(node as HTMLImageElement).complete))).toBe(true)
    release()
    await expect.poll(() => images.evaluateAll(nodes => nodes.every(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0))).toBe(true)
    expect(await measure()).toEqual(before)
  } finally { release() }

  const favicon = page.locator('link[rel="icon"]'), apple = page.locator('link[rel="apple-touch-icon"]')
  await expect(favicon).toHaveCount(1)
  await expect(apple).toHaveCount(1)
  const faviconURL = await favicon.getAttribute('href')
  expect(faviconURL).toMatch(/^\/favicon\.ico\?/) // Next's content fingerprint avoids stale icons.
  const icon = await request.get(faviconURL!)
  expect(icon.status()).toBe(200)
  expect(icon.headers()['content-type']).toContain('image/x-icon')
  expect(await icon.body()).toEqual(await readFile('public/brand/icons/favicon-yo.ico'))
  await expect(apple).toHaveAttribute('href', '/brand/icons/logo-square-180.png')
  const touch = await request.get('/brand/icons/logo-square-180.png')
  expect(touch.status()).toBe(200)
  expect(touch.headers()['content-type']).toContain('image/png')
  expect(await touch.body()).toEqual(await readFile('public/brand/icons/logo-square-180.png'))
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute('content', 'Yuohme')
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary')
  await expect(page.locator('meta[property="og:image"][content*="logo-square"]')).toHaveCount(0)
})
