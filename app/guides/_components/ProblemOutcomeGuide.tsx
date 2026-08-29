import Link from 'next/link'
import Card from '@/app/components/Card'
import type { SeoGuideCategory, SeoProblemPage } from '@/content/seo-pages'
import PrioritisationSignals from './PrioritisationSignals'
import WorkedPrioritisationExample from './WorkedPrioritisationExample'

interface ProblemOutcomeGuideProps {
  page: SeoProblemPage
  category: SeoGuideCategory
  relatedPages: SeoProblemPage[]
}

const guideTextColors = {
  heading: { color: 'var(--gray-900)' },
  body: { color: 'var(--gray-700)' },
  muted: { color: 'var(--gray-500)' },
  inverseHeading: { color: '#ffffff' },
  inverseBody: { color: 'var(--gray-300)' },
  inverseCta: { color: 'var(--gray-900)' },
} as const

const defaultHeadings = {
  whyItMatters: 'Why this matters',
  signals: 'How to prioritise',
  workedExample: 'Worked example',
  recommendedActions: 'Recommended actions',
  productBridge: 'From data to a ranked chase queue',
  relatedGuides: 'Related guides',
}

export default function ProblemOutcomeGuide({
  page,
  category,
  relatedPages,
}: ProblemOutcomeGuideProps) {
  const headings = { ...defaultHeadings, ...page.sectionHeadings }

  return (
    <article className="mx-auto max-w-3xl pb-8">
      <header className="space-y-6">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-600">
            <li>
              <Link href="/blog" className="hover:text-gray-900">
                Credit control guides
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link href={`/blog#${category.slug}`} className="hover:text-gray-900">
                {category.title}
              </Link>
            </li>
          </ol>
        </nav>
        <h1
          className="text-balance text-4xl leading-tight sm:text-5xl"
          style={guideTextColors.heading}
        >
          {page.h1}
        </h1>

        <Card className="rounded-xl p-6 sm:p-8">
          <p
            className="text-xs font-semibold uppercase tracking-wide text-gray-500"
            style={guideTextColors.muted}
          >
            The short answer
          </p>
          <p
            className="mt-3 text-lg font-medium leading-8 text-gray-900 sm:text-xl"
            style={guideTextColors.heading}
          >
            {page.directAnswer}
          </p>
        </Card>
      </header>

      <div className="mt-10 space-y-10">
        <section aria-labelledby="why-this-matters">
          <h2 id="why-this-matters" style={guideTextColors.heading}>
            {headings.whyItMatters}
          </h2>
          <p
            className="mt-3 max-w-2xl leading-7 text-gray-700"
            style={guideTextColors.body}
          >
            {page.whyItMatters}
          </p>
        </section>

        <section aria-labelledby="prioritisation-signals">
          <h2 id="prioritisation-signals" style={guideTextColors.heading}>
            {headings.signals}
          </h2>
          <p
            className="mt-3 max-w-2xl leading-7 text-gray-700"
            style={guideTextColors.body}
          >
            {page.signalIntroduction}
          </p>
          <PrioritisationSignals signals={page.signals} decisionRules={page.decisionRules} />
        </section>

        <section aria-labelledby="worked-example">
          <h2 id="worked-example" style={guideTextColors.heading}>
            {headings.workedExample}
          </h2>
          <WorkedPrioritisationExample example={page.workedExample} />
        </section>

        <section aria-labelledby="recommended-actions">
          <h2 id="recommended-actions" style={guideTextColors.heading}>
            {headings.recommendedActions}
          </h2>
          <ol className="mt-5 space-y-3">
            {page.recommendedActions.map((action, index) => (
              <li
                key={action}
                className="flex gap-4 rounded-xl border border-gray-200 bg-white p-4"
              >
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white"
                >
                  {index + 1}
                </span>
                <p
                  className="pt-0.5 text-sm leading-6 text-gray-700"
                  style={guideTextColors.body}
                >
                  {action}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="product-bridge">
          <Card className="rounded-xl p-6 sm:p-8">
            <h2 id="product-bridge" style={guideTextColors.heading}>
              {headings.productBridge}
            </h2>
            <p
              className="mt-3 leading-7 text-gray-700"
              style={guideTextColors.body}
            >
              {page.productBridge}
            </p>
          </Card>
        </section>

        <section
          aria-labelledby="guide-cta"
          className="rounded-xl bg-gray-900 px-6 py-8 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:px-8"
        >
          <div>
            <h2
              id="guide-cta"
              className="text-white"
              style={guideTextColors.inverseHeading}
            >
              Turn overdue customers into a clear priority list
            </h2>
            <p
              className="mt-2 text-sm text-gray-300"
              style={guideTextColors.inverseBody}
            >
              Compare plans for connecting Xero and building a ranked collections queue.
            </p>
          </div>
          <div className="mt-5 shrink-0 sm:mt-0">
            <Link
              href={page.ctaHref}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-white px-6 py-3 text-sm font-medium text-gray-900 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              style={guideTextColors.inverseCta}
            >
              {page.ctaLabel}
            </Link>
          </div>
        </section>

        {relatedPages.length > 0 && (
          <section aria-labelledby="related-guides">
            <h2 id="related-guides" style={guideTextColors.heading}>
              {headings.relatedGuides}
            </h2>
            <ul className="mt-5 grid gap-4 sm:grid-cols-2">
              {relatedPages.map((relatedPage) => (
                <li key={relatedPage.slug}>
                  <Card className="h-full rounded-xl p-5">
                    <Link
                      href={`/guides/${relatedPage.slug}`}
                      className="group flex h-full flex-col justify-between gap-4"
                    >
                      <span className="text-base font-semibold leading-6 text-gray-900 group-hover:text-gray-700">
                        {relatedPage.h1}
                      </span>
                      <span className="text-sm font-medium text-gray-600 group-hover:text-gray-900">
                        Read guide →
                      </span>
                    </Link>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </article>
  )
}
