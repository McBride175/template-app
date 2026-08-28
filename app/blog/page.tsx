import type { Metadata } from 'next'
import Link from 'next/link'
import Card from '@/app/components/Card'
import { getAllPostMetadata } from '@/lib/blog'
import { getAllIndexableSeoProblemPages } from '@/lib/seo-pages'

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
  const guides = getAllIndexableSeoProblemPages()

  return (
    <div className="space-y-8">
      <header>
        <h1>Cash Collection Insights</h1>
        <p className="mt-2 text-sm text-gray-600">
          Practical strategies to collect more cash with less time and effort.
        </p>
      </header>

      <section id="guides" className="scroll-mt-24 space-y-4" aria-labelledby="guides-heading">
        <div>
          <h2 id="guides-heading" style={{ color: 'var(--gray-900)' }}>
            Practical collection guides
          </h2>
          <p
            className="mt-2 text-sm text-gray-600"
            style={{ color: 'var(--gray-600)' }}
          >
            Quick decision aids for choosing who to chase and getting cash in sooner.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {guides.map((guide) => (
            <Card key={guide.slug} className="h-full rounded-xl p-5">
              <article className="flex h-full flex-col justify-between gap-4">
                <div>
                  <h3>
                    <Link
                      href={`/guides/${guide.slug}`}
                      className="text-gray-900 hover:text-gray-700"
                    >
                      {guide.h1}
                    </Link>
                  </h3>
                  <p
                    className="mt-2 text-sm text-gray-600"
                    style={{ color: 'var(--gray-600)' }}
                  >
                    {guide.metaDescription}
                  </p>
                </div>
                <Link
                  href={`/guides/${guide.slug}`}
                  className="text-sm font-medium text-gray-700 hover:text-gray-900"
                >
                  Read guide →
                </Link>
              </article>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="articles-heading">
        <h2 id="articles-heading" style={{ color: 'var(--gray-900)' }}>
          Latest articles
        </h2>
        <div className="space-y-4">
          {posts.map((post) => (
            <Card key={post.slug}>
              <article className="space-y-2">
                <h3>
                  <Link
                    href={`/blog/${post.slug}`}
                    className="text-gray-900 hover:text-gray-700"
                  >
                    {post.title}
                  </Link>
                </h3>
                <p className="text-sm text-gray-600">{post.description}</p>
                <p className="text-[11px] italic text-gray-500">
                  Published: {new Date(post.date).toLocaleDateString()}
                </p>
              </article>
            </Card>
          ))}
        </div>
      </section>
    </div>
  )
}
