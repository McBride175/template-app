import type { Metadata } from 'next'
import Link from 'next/link'
import Card from '@/app/components/Card'
import { getAllPostMetadata } from '@/lib/blog'

export const metadata: Metadata = {
  title: 'Sitemap',
  description: 'Human-friendly sitemap for Template App pages.',
  alternates: {
    canonical: '/sitemap',
  },
}

const staticLinks = [
  { href: '/', label: 'Home' },
  { href: '/blog', label: 'Blog' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/login', label: 'Login' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/account', label: 'Account' },
  { href: '/legal/terms', label: 'Terms of Service' },
  { href: '/legal/privacy', label: 'Privacy Policy' },
  { href: '/legal/cookies', label: 'Cookie Policy' },
  { href: '/sitemap.xml', label: 'XML Sitemap' },
]

export default async function SitemapPage() {
  const posts = await getAllPostMetadata()

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
            {staticLinks.map((link) => (
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
          <h2>Blog Posts</h2>
          <ul className="space-y-2 text-sm text-gray-700">
            {posts.map((post) => (
              <li key={post.slug}>
                <Link
                  href={`/blog/${post.slug}`}
                  className="hover:text-gray-900 underline underline-offset-2"
                >
                  {post.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </div>
  )
}
