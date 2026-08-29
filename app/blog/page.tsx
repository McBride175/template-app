import type { Metadata } from 'next'
import Link from 'next/link'
import Card from '@/app/components/Card'
import {
  getAllIndexableSeoProblemPages,
  getAllSeoGuideCategories,
  getIndexableSeoProblemPagesByIntentFamily,
} from '@/lib/seo-pages'
import { getSiteUrl } from '@/lib/site-url'

const hubTitle = 'Getting Paid: Credit Control & Overdue Invoice Guides'
const hubDescription =
  'Practical guides to prioritising overdue invoices, getting paid faster, managing late-payer risk, building a credit-control process and using Xero for credit control.'

export const metadata: Metadata = {
  title: hubTitle,
  description: hubDescription,
  alternates: {
    canonical: '/blog',
  },
  openGraph: {
    title: hubTitle,
    description: hubDescription,
    url: '/blog',
    type: 'website',
  },
  twitter: {
    title: hubTitle,
    description: hubDescription,
  },
}

export default function BlogPage() {
  const categories = getAllSeoGuideCategories()
  const guides = getAllIndexableSeoProblemPages()
  const siteUrl = getSiteUrl()
  const collectionJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: hubTitle,
    description: hubDescription,
    url: `${siteUrl}/blog`,
    hasPart: guides.map((guide) => ({
      '@type': 'Article',
      headline: guide.h1,
      url: `${siteUrl}/guides/${guide.slug}`,
    })),
  }

  return (
    <div className="space-y-14 pb-8 sm:space-y-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }}
      />

      <header className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
        <div className="px-6 py-10 sm:px-10 sm:py-14">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-800">
            Credit control guide library
          </p>
          <h1 className="mt-4 max-w-3xl text-balance text-4xl leading-[1.08] sm:text-5xl">
            Getting Paid: Credit Control &amp; Overdue Invoice Guides
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-gray-700">
            Most credit-control advice tells you how to chase an overdue invoice. The harder
            problem begins when lots of customers owe you money and you don&apos;t have time to
            chase everyone. These guides focus on deciding where your attention should go first.
          </p>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-gray-600">
            Explore five practical topics covering prioritisation, faster payment, customer
            risk, repeatable processes and Xero-supported credit control.
          </p>
        </div>

        <div className="border-t border-gray-200 bg-sky-50 px-6 py-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:px-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Recommended starting point
            </p>
            <p className="mt-1 font-semibold text-gray-900">
              Turn your overdue list into a clear order of action.
            </p>
          </div>
          <Link
            href="/guides/how-to-prioritise-overdue-invoices"
            className="mt-4 inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-gray-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-gray-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 sm:mt-0"
          >
            Start with prioritisation →
          </Link>
        </div>
      </header>

      <section aria-labelledby="topics-heading">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-800">
            Five core topics
          </p>
          <h2 id="topics-heading" className="mt-2 text-3xl">
            Find the problem you need to solve
          </h2>
          <p className="mt-3 leading-7 text-gray-600">
            Each topic is a hub for focused, practical guides. Start with today&apos;s problem or
            work through the library as your credit-control process matures.
          </p>
        </div>

        <ol className="mt-7 grid gap-4 sm:grid-cols-2">
          {categories.map((category, index) => {
            const categoryGuides = getIndexableSeoProblemPagesByIntentFamily(
              category.intentFamily
            )

            return (
              <li key={category.slug} className="sm:last:col-span-2">
                <Link
                  href={'#' + category.slug}
                  className="group flex h-full min-h-44 flex-col justify-between rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:ring-offset-2"
                >
                  <div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-xs font-semibold tracking-[0.16em] text-sky-800">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-gray-600">
                        {categoryGuides.length > 0
                          ? categoryGuides.length +
                            ' ' +
                            (categoryGuides.length === 1 ? 'guide' : 'guides')
                          : 'Topic hub'}
                      </span>
                    </div>
                    <h3 className="mt-5 text-xl group-hover:text-sky-800">{category.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-gray-600">
                      {category.shortDescription}
                    </p>
                  </div>
                  <span className="mt-5 text-sm font-semibold text-sky-800">Explore topic ↓</span>
                </Link>
              </li>
            )
          })}
        </ol>
      </section>

      <section aria-labelledby="library-heading">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-800">
            The guide library
          </p>
          <h2 id="library-heading" className="mt-2 text-3xl">
            Browse by credit-control topic
          </h2>
        </div>

        <div className="mt-8 divide-y divide-sky-200 border-y border-sky-200">
          {categories.map((category, index) => {
            const categoryGuides = getIndexableSeoProblemPagesByIntentFamily(
              category.intentFamily
            )

            return (
              <section
                key={category.slug}
                id={category.slug}
                className="scroll-mt-24 py-9 sm:py-11"
                aria-labelledby={category.slug + '-heading'}
              >
                <div className="grid gap-7 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] md:gap-10">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white">
                        {index + 1}
                      </span>
                      <h3 id={category.slug + '-heading'} className="text-2xl">
                        {category.title}
                      </h3>
                    </div>
                    <p className="mt-4 leading-7 text-gray-600">{category.description}</p>
                  </div>

                  <div>
                    {categoryGuides.length > 0 ? (
                      <ul className="space-y-4">
                        {categoryGuides.map((guide) => (
                          <li key={guide.slug}>
                            <Card className="h-full rounded-2xl p-6 shadow-sm">
                              <article>
                                <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">
                                  Practical guide
                                </p>
                                <h4 className="mt-3 text-xl font-semibold leading-7 text-gray-900">
                                  <Link
                                    href={'/guides/' + guide.slug}
                                    className="hover:text-sky-800"
                                  >
                                    {guide.h1}
                                  </Link>
                                </h4>
                                <p className="mt-3 text-sm leading-6 text-gray-600">
                                  {guide.metaDescription}
                                </p>
                                <Link
                                  href={'/guides/' + guide.slug}
                                  className="mt-5 inline-flex text-sm font-semibold text-sky-800 hover:text-sky-900"
                                >
                                  Read guide →
                                </Link>
                              </article>
                            </Card>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-sky-200 bg-sky-50 p-6">
                        <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">
                          Planned guide cluster
                        </p>
                        <p className="mt-2 text-sm leading-6 text-gray-600">
                          This topic will bring together guides on:
                        </p>
                        <ul className="mt-4 space-y-3 text-sm leading-6 text-gray-700">
                          {category.topics.map((topic) => (
                            <li key={topic} className="flex gap-3">
                              <span
                                aria-hidden="true"
                                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-700"
                              />
                              <span>{topic}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )
          })}
        </div>
      </section>
    </div>
  )
}
