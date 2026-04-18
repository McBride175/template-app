import { NextResponse } from 'next/server'
import { getAllPostMetadata } from '@/lib/blog'
import { SITEMAP_PAGE_LINKS } from '@/lib/sitemap-links'
import { getSiteUrl } from '@/lib/site-url'

function toIsoDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? new Date().toISOString() : date.toISOString()
}

export async function GET() {
  const siteUrl = getSiteUrl()
  const now = new Date().toISOString()
  const posts = await getAllPostMetadata()

  const staticPaths = SITEMAP_PAGE_LINKS
    .filter((link) => link.includeInXml)
    .map((link) => link.href)

  const urls = [
    ...staticPaths.map((path) => ({
      loc: `${siteUrl}${path}`,
      lastmod: now,
    })),
    ...posts.map((post) => ({
      loc: `${siteUrl}/blog/${post.slug}`,
      lastmod: toIsoDate(post.date),
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
