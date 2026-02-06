import type { Metadata } from 'next'
import Link from 'next/link'
import Card from '@/app/components/Card'
import { getAllPostMetadata } from '@/lib/blog'

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Product updates, guides, and technical notes.',
  alternates: {
    canonical: '/blog',
  },
  openGraph: {
    title: 'Blog | Template App',
    description: 'Product updates, guides, and technical notes.',
    url: '/blog',
    type: 'website',
  },
  twitter: {
    title: 'Blog | Template App',
    description: 'Product updates, guides, and technical notes.',
  },
}

export default async function BlogPage() {
  const posts = await getAllPostMetadata()

  return (
    <div className="space-y-8">
      <header>
        <h1>Blog</h1>
        <p className="mt-2 text-sm text-gray-600">Updates, guides, and release notes.</p>
      </header>

      <div className="space-y-4">
        {posts.map((post) => (
          <Card key={post.slug}>
            <article className="space-y-2">
              <h2>
                <Link
                  href={`/blog/${post.slug}`}
                  className="text-gray-900 hover:text-gray-700"
                >
                  {post.title}
                </Link>
              </h2>
              <p className="text-sm text-gray-600">{post.description}</p>
              <p className="text-xs text-gray-500">
                Published: {new Date(post.date).toLocaleDateString()}
              </p>
            </article>
          </Card>
        ))}
      </div>
    </div>
  )
}
