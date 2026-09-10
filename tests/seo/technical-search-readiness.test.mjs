import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const { getAllIndexableSeoProblemPages } = loadTypeScriptModule('lib/seo-pages.ts')
const { SITEMAP_PAGE_LINKS } = loadTypeScriptModule('lib/sitemap-links.ts')
const { GET: getSitemap } = loadTypeScriptModule('app/sitemap.xml/route.ts')
const { GET: getRobots } = loadTypeScriptModule('app/robots.txt/route.ts')
const nextConfig = loadTypeScriptModule('next.config.ts').default

async function withEnvironment(values, callback) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]])
  )

  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    return await callback()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('production sitemap contains every public guide exactly once and no private route', async () => {
  await withEnvironment(
    {
      NEXT_PUBLIC_SITE_URL: 'https://www.example.com/',
      VERCEL_ENV: 'production',
      VERCEL_URL: 'preview.example.com',
    },
    async () => {
      const response = await getSitemap()
      const body = await response.text()
      const locations = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
      const guides = getAllIndexableSeoProblemPages()
      const expectedStaticCount = SITEMAP_PAGE_LINKS.filter(
        (link) => link.includeInXml
      ).length

      assert.equal(response.status, 200)
      assert.match(response.headers.get('content-type') ?? '', /application\/xml/)
      assert.equal(locations.length, guides.length + expectedStaticCount)
      assert.equal(new Set(locations).size, locations.length)
      assert.equal(locations.filter((url) => url.includes('/guides/')).length, 42)
      assert.equal(locations.some((url) => url.endsWith('/disputes')), false)
      assert.equal(locations.some((url) => /\/(account|admin|dashboard|login|signup)(\/|$)/.test(url)), false)
      assert.equal(body.includes('<lastmod>'), false)

      for (const guide of guides) {
        assert.equal(
          locations.filter(
            (url) => url === `https://www.example.com/guides/${guide.slug}`
          ).length,
          1
        )
      }
    }
  )
})

test('robots advertises the sitemap only in production and lets crawlers observe preview noindex headers', async () => {
  await withEnvironment(
    {
      NEXT_PUBLIC_SITE_URL: 'https://www.example.com',
      VERCEL_ENV: 'production',
    },
    async () => {
      const response = await getRobots()
      const body = await response.text()
      assert.match(body, /Allow: \//)
      assert.match(body, /Sitemap: https:\/\/www\.example\.com\/sitemap\.xml/)
      assert.doesNotMatch(body, /Disallow: \//)
    }
  )

  await withEnvironment(
    {
      NEXT_PUBLIC_SITE_URL: 'https://preview.example.com',
      VERCEL_ENV: 'preview',
    },
    async () => {
      const response = await getRobots()
      const body = await response.text()
      assert.match(body, /Allow: \//)
      assert.doesNotMatch(body, /Disallow:/)
      assert.doesNotMatch(body, /Sitemap:/)
    }
  )
})

test('response headers noindex every non-production route and private production routes', async () => {
  await withEnvironment({ VERCEL_ENV: 'preview' }, async () => {
    const headers = await nextConfig.headers()
    assert.deepEqual(headers, [
      {
        source: '/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ])
  })

  await withEnvironment({ VERCEL_ENV: 'production' }, async () => {
    const headers = await nextConfig.headers()
    const sources = new Set(headers.map(({ source }) => source))
    assert.equal(sources.has('/login/:path*'), true)
    assert.equal(sources.has('/dashboard/:path*'), true)
    assert.equal(sources.has('/disputes/:path*'), true)
    assert.equal(sources.has('/api/:path*'), true)
    assert.equal(sources.has('/blog/:path*'), false)
    assert.equal(sources.has('/guides/:path*'), false)
    assert.equal(
      headers.every(({ headers: routeHeaders }) =>
        routeHeaders.some(
          ({ key, value }) =>
            key === 'X-Robots-Tag' && value === 'noindex, nofollow'
        )
      ),
      true
    )
  })
})

test('public structured data does not publish the placeholder brand or an unverified offer', async () => {
  const sources = await Promise.all(
    [
      'app/layout.tsx',
      'app/page.tsx',
      'app/blog/page.tsx',
      'app/guides/[slug]/page.tsx',
      'app/guides/credit-control-prioritisation-playbook/page.tsx',
    ].map((path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8'))
  )
  const structuredDataSource = sources.join('\n')

  assert.doesNotMatch(structuredDataSource, /name:\s*['"]Template App['"]/)
  assert.doesNotMatch(structuredDataSource, /['"]@type['"]:\s*['"]SoftwareApplication['"]/)
  assert.doesNotMatch(structuredDataSource, /priceCurrency/)
})

test('guide metadata remains unique and is not lengthened by a placeholder brand suffix', async () => {
  const guides = getAllIndexableSeoProblemPages()
  const titles = guides.map((guide) => guide.metaTitle.trim().toLowerCase())
  const descriptions = guides.map((guide) => guide.metaDescription.trim().toLowerCase())
  const guideRoute = await readFile(
    new URL('../../app/guides/[slug]/page.tsx', import.meta.url),
    'utf8'
  )

  assert.equal(new Set(titles).size, guides.length)
  assert.equal(new Set(descriptions).size, guides.length)
  assert.equal(guides.some((guide) => !guide.metaTitle.trim()), false)
  assert.equal(guides.some((guide) => !guide.metaDescription.trim()), false)
  assert.match(guideRoute, /title:\s*\{\s*absolute:\s*page\.metaTitle/s)
})

test('product copy describes a selected priority adjustment rather than free-form context capture', async () => {
  const sources = await Promise.all(
    ['app/page.tsx', 'content/seo-pages.ts', 'content/hub-d-pages.ts', 'content/hub-e-pages.ts']
      .map((path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8'))
  )
  const productCopy = sources.join('\n')

  assert.doesNotMatch(productCopy, /founder risk knowledge/i)
  assert.doesNotMatch(productCopy, /add the customer context only you know/i)
  assert.match(productCopy, /priority adjustment/i)
})
