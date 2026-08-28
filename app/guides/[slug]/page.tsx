import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import ProblemOutcomeGuide from '@/app/guides/_components/ProblemOutcomeGuide'
import {
  getAllSeoProblemPages,
  getRelatedSeoProblemPages,
  getSeoProblemPageBySlug,
} from '@/lib/seo-pages'

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

  return (
    <ProblemOutcomeGuide
      page={page}
      relatedPages={getRelatedSeoProblemPages(page)}
    />
  )
}
