import type { Metadata } from 'next'
import Link from 'next/link'
import Card from '@/app/components/Card'
import {
  getAllIndexableSeoProblemPages,
  getAllSeoGuideCategories,
} from '@/lib/seo-pages'
import { SITEMAP_PAGE_LINKS } from '@/lib/sitemap-links'

export const metadata: Metadata = {
  title: 'Sitemap',
  description: 'Human-friendly sitemap for Template App pages.',
  alternates: {
    canonical: '/sitemap',
  },
}

export default function SitemapPage() {
  const categories = getAllSeoGuideCategories()
  const guides = getAllIndexableSeoProblemPages()

  return (
    <div className="space-y-8">
      <header>
        <h1>Sitemap</h1>
        <p className="mt-2 text-sm text-gray-600">Browse all key pages on this site.</p>
      </header>

      <Card>
        <div className="space-y-3">
          <h2>Pages</h2>
          <ul className="space-y-2 text-sm text-gray-700">
            {SITEMAP_PAGE_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="hover:text-gray-900 underline underline-offset-2">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <Card>
        <div className="space-y-3">
          <h2>Guide Topics</h2>
          <ul className="space-y-2 text-sm text-gray-700">
            {categories.map((category) => (
              <li key={category.slug}>
                <Link
                  href={`/blog#${category.slug}`}
                  className="hover:text-gray-900 underline underline-offset-2"
                >
                  {category.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <Card>
        <div className="space-y-3">
          <h2>Practical Guides</h2>
          <ul className="space-y-2 text-sm text-gray-700">
            {guides.map((guide) => (
              <li key={guide.slug}>
                <Link
                  href={`/guides/${guide.slug}`}
                  className="hover:text-gray-900 underline underline-offset-2"
                >
                  {guide.h1}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </div>
  )
}
