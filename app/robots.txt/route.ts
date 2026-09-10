import { NextResponse } from 'next/server'
import { getSiteUrl } from '@/lib/site-url'

export async function GET() {
  const isProduction = process.env.VERCEL_ENV === 'production'
  const siteUrl = getSiteUrl()

  const body = isProduction
    ? `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`
    : 'User-agent: *\nAllow: /\n'

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
