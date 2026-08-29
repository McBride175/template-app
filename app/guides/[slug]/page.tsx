import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import ProblemOutcomeGuide from '@/app/guides/_components/ProblemOutcomeGuide'
import {
  getAllSeoProblemPages,
  getRelatedSeoProblemPages,
  getSeoGuideCategoryByIntentFamily,
  getSeoProblemPageBySlug,
} from '@/lib/seo-pages'
import { getSiteUrl } from '@/lib/site-url'

interface GuidePageProps {
  params: Promise<{ slug: string }>
}

export function generateStaticParams() {
  return getAllSeoProblemPages().map((page) => ({ slug: page.slug }))
}

export async function generateMetadata({ params }: GuidePageProps): Promise<Metadata> {
  const { slug } = await params
  const page = getSeoProblemPageBySlug(slug)

  if (!page) {
    return {
      title: 'Guide not found',
      robots: {
        index: false,
        follow: false,
      },
    }
  }

  const canonicalPath = `/guides/${page.slug}`

  return {
    title: page.metaTitle,
    description: page.metaDescription,
    alternates: {
      canonical: canonicalPath,
    },
    robots: page.indexable
      ? {
          index: true,
          follow: true,
        }
      : {
          index: false,
          follow: false,
        },
    openGraph: {
      title: page.metaTitle,
      description: page.metaDescription,
      url: canonicalPath,
      type: 'article',
    },
    twitter: {
      title: page.metaTitle,
      description: page.metaDescription,
    },
  }
}

export default async function GuidePage({ params }: GuidePageProps) {
  const { slug } = await params
  const page = getSeoProblemPageBySlug(slug)

  if (!page) {
    notFound()
  }

  const category = getSeoGuideCategoryByIntentFamily(page.intentFamily)

  if (!category) {
    notFound()
  }

  const canonicalPath = `/guides/${page.slug}`
  const siteUrl = getSiteUrl()
  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: page.h1,
      description: page.metaDescription,
      mainEntityOfPage: `${siteUrl}${canonicalPath}`,
      author: {
        '@type': 'Organization',
        name: 'Template App',
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Credit control guides',
          item: `${siteUrl}/blog`,
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: category.title,
          item: `${siteUrl}/blog#${category.slug}`,
        },
        {
          '@type': 'ListItem',
          position: 3,
          name: page.h1,
          item: `${siteUrl}${canonicalPath}`,
        },
      ],
    },
  ]

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <ProblemOutcomeGuide
        page={page}
        category={category}
        relatedPages={getRelatedSeoProblemPages(page)}
      />
    </>
  )
}
