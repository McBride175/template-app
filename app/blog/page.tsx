import type { Metadata } from 'next'
import Link from 'next/link'
import Card from '@/app/components/Card'
import { getAllPostMetadata } from '@/lib/blog'

export const metadata: Metadata = {
  title: 'Cash Collection Insights',
  description:
    'Playbooks, metrics, and product notes for improving cash collected per unit of time and effort.',
  alternates: {
    canonical: '/blog',
  },
  openGraph: {
    title: 'Cash Collection Insights | Template App',
    description:
      'Playbooks, metrics, and product notes for improving cash collected per unit of time and effort.',
    url: '/blog',
    type: 'website',
  },
  twitter: {
    title: 'Cash Collection Insights | Template App',
    description:
      'Playbooks, metrics, and product notes for improving cash collected per unit of time and effort.',
  },
}

export default async function BlogPage() {
  const posts = await getAllPostMetadata()

  return (
    <div className="space-y-8">
      <header>
        <h1>Cash Collection Insights</h1>
        <p className="mt-2 text-sm text-gray-600">
          Practical strategies to collect more cash with less time and effort.
        </p>
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
              <p className="text-[11px] italic text-gray-500">
                Published: {new Date(post.date).toLocaleDateString()}
              </p>
            </article>
          </Card>
        ))}
      </div>
    </div>
  )
}
