import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAllPostMetadata, getPostBySlug } from '@/lib/blog'

interface BlogPostPageProps {
  params: Promise<{ slug: string }>
}

export async function generateStaticParams() {
  const posts = await getAllPostMetadata()
  return posts.map((post) => ({ slug: post.slug }))
}

export async function generateMetadata({ params }: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params
  const post = await getPostBySlug(slug)

  if (!post) {
    return {
      title: 'Post not found',
      robots: {
        index: false,
        follow: false,
      },
    }
  }

  return {
    title: post.title,
    description: post.description,
    alternates: {
      canonical: `/blog/${post.slug}`,
    },
    openGraph: {
      title: `${post.title} | Template App`,
      description: post.description,
      url: `/blog/${post.slug}`,
      type: 'article',
      publishedTime: new Date(post.date).toISOString(),
    },
    twitter: {
      title: `${post.title} | Template App`,
      description: post.description,
    },
  }
}

function renderMarkdown(content: string) {
  const lines = content.split('\n').filter((line) => line.trim().length > 0)

  return lines.map((line, index) => {
    if (line.startsWith('## ')) {
      return (
        <h2 key={index} className="mt-6">
          {line.slice(3)}
        </h2>
      )
    }

    if (line.startsWith('### ')) {
      return (
        <h3 key={index} className="mt-4 text-lg font-semibold text-gray-900">
          {line.slice(4)}
        </h3>
      )
    }

    return (
      <p key={index} className="mt-3 text-sm leading-7 text-gray-700">
        {line}
      </p>
    )
  })
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params
  const [post, allPosts] = await Promise.all([
    getPostBySlug(slug),
    getAllPostMetadata(),
  ])

  if (!post) {
    notFound()
  }

  const currentIndex = allPosts.findIndex((item) => item.slug === post.slug)
  const suggestedPost = currentIndex >= 0 ? allPosts[currentIndex + 1] ?? allPosts[0] : allPosts[0]

  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    datePublished: new Date(post.date).toISOString(),
    dateModified: new Date(post.date).toISOString(),
    author: {
      '@type': 'Organization',
      name: 'Template App',
    },
  }

  return (
    <article className="max-w-3xl">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <div>
        <Link href="/blog" className="text-sm text-gray-700 hover:text-gray-900">
          ← Back to Blog
        </Link>
      </div>
      <header className="space-y-3">
        <h1>{post.title}</h1>
        <p className="text-sm text-gray-600">{post.description}</p>
        <p className="text-[11px] italic text-gray-500">
          Published: {new Date(post.date).toLocaleDateString()}
        </p>
      </header>

      <section className="mt-6">{renderMarkdown(post.content)}</section>

      {suggestedPost && suggestedPost.slug !== post.slug && (
        <section className="mt-10 rounded-md border border-gray-200 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Suggested Next Article</p>
          <h2 className="mt-2 text-lg font-semibold text-gray-900">
            <Link href={`/blog/${suggestedPost.slug}`} className="hover:text-gray-700">
              {suggestedPost.title}
            </Link>
          </h2>
          <p className="mt-1 text-sm text-gray-600">{suggestedPost.description}</p>
        </section>
      )}
    </article>
  )
}
