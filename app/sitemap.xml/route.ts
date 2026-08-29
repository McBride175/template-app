import { NextResponse } from 'next/server'
import { getAllIndexableSeoProblemPages } from '@/lib/seo-pages'
import { SITEMAP_PAGE_LINKS } from '@/lib/sitemap-links'
import { getSiteUrl } from '@/lib/site-url'

export async function GET() {
  const siteUrl = getSiteUrl()
  const now = new Date().toISOString()
  const guides = getAllIndexableSeoProblemPages()

  const staticPaths = SITEMAP_PAGE_LINKS
    .filter((link) => link.includeInXml)
    .map((link) => link.href)

  const urls = [
    ...staticPaths.map((path) => ({
      loc: `${siteUrl}${path}`,
      lastmod: now,
    })),
    ...guides.map((guide) => ({
      loc: `${siteUrl}/guides/${guide.slug}`,
      lastmod: now,
    })),
  ]

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(
      (url) =>
        `  <url>\n    <loc>${url.loc}</loc>\n    <lastmod>${url.lastmod}</lastmod>\n  </url>`
    )
    .join('\n')}\n</urlset>`

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
