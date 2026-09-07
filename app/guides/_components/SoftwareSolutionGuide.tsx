import Link from 'next/link'
import Card from '@/app/components/Card'
import type {
  SeoGuideCategory,
  SeoProblemPage,
  SeoSoftwareSolutionPage,
} from '@/content/seo-pages'

interface SoftwareSolutionGuideProps {
  page: SeoSoftwareSolutionPage
  category: SeoGuideCategory
  relatedPages: SeoProblemPage[]
}

const guideTextColors = {
  heading: { color: 'var(--gray-900)' },
  body: { color: 'var(--gray-700)' },
  muted: { color: 'var(--gray-600)' },
  inverseHeading: { color: '#ffffff' },
  inverseBody: { color: 'var(--gray-300)' },
  inverseCta: { color: 'var(--gray-900)' },
} as const

const defaultHeadings = {
  existingPlatform: 'What the existing platform already provides',
  additionalSoftware: 'When additional software becomes useful',
  selectionCriteria: 'Capabilities to look for',
  solutionApproaches: 'Choose the type of solution that fits the problem',
  productDifferentiation: 'How our approach differs',
  fit: 'Who this approach is for — and who it is not for',
  relatedGuides: 'Related guides',
}

export default function SoftwareSolutionGuide({
  page,
  category,
  relatedPages,
}: SoftwareSolutionGuideProps) {
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
        <section aria-labelledby="existing-platform-capabilities">
          <h2 id="existing-platform-capabilities" style={guideTextColors.heading}>
            {headings.existingPlatform}
          </h2>
          <p
            className="mt-3 max-w-2xl leading-7 text-gray-700"
            style={guideTextColors.body}
          >
            {page.existingPlatformIntroduction}
          </p>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {page.existingPlatformCapabilities.map((item) => (
              <li key={item.capability}>
                <Card className="h-full rounded-xl p-5">
                  <h3
                    className="text-sm font-semibold text-gray-900"
                    style={guideTextColors.heading}
                  >
                    {item.capability}
                  </h3>
                  <p
                    className="mt-2 text-sm leading-6 text-gray-700"
                    style={guideTextColors.body}
                  >
                    {item.guidance}
                  </p>
                  {item.context && (
                    <p
                      className="mt-3 border-t border-gray-200 pt-3 text-xs leading-5 text-gray-600"
                      style={guideTextColors.body}
                    >
                      <span
                        className="font-semibold text-gray-700"
                        style={guideTextColors.heading}
                      >
                        Context:
                      </span>{' '}
                      {item.context}
                    </p>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="additional-software-triggers">
          <h2 id="additional-software-triggers" style={guideTextColors.heading}>
            {headings.additionalSoftware}
          </h2>
          <p
            className="mt-3 max-w-2xl leading-7 text-gray-700"
            style={guideTextColors.body}
          >
            {page.additionalSoftwareIntroduction}
          </p>
          <ul className="mt-5 space-y-3">
            {page.additionalSoftwareTriggers.map((item) => (
              <li
                key={item.trigger}
                className="rounded-xl border border-gray-200 bg-white p-5"
              >
                <h3
                  className="text-sm font-semibold text-gray-900"
                  style={guideTextColors.heading}
                >
                  {item.trigger}
                </h3>
                <p
                  className="mt-2 text-sm leading-6 text-gray-700"
                  style={guideTextColors.body}
                >
                  {item.guidance}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="software-selection-criteria">
          <h2 id="software-selection-criteria" style={guideTextColors.heading}>
            {headings.selectionCriteria}
          </h2>
          <p
            className="mt-3 max-w-2xl leading-7 text-gray-700"
            style={guideTextColors.body}
          >
            {page.selectionIntroduction}
          </p>
          <ol className="mt-5 grid gap-4 sm:grid-cols-2">
            {page.selectionCriteria.map((item, index) => (
              <li key={item.criterion}>
                <Card className="h-full rounded-xl p-5">
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white"
                    >
                      {index + 1}
                    </span>
                    <div>
                      <h3
                        className="text-sm font-semibold text-gray-900"
                        style={guideTextColors.heading}
                      >
                        {item.criterion}
                      </h3>
                      <p
                        className="mt-2 text-sm leading-6 text-gray-700"
                        style={guideTextColors.body}
                      >
                        {item.whyItMatters}
                      </p>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="software-solution-approaches">
          <h2 id="software-solution-approaches" style={guideTextColors.heading}>
            {headings.solutionApproaches}
          </h2>
          <p
            className="mt-3 max-w-2xl leading-7 text-gray-700"
            style={guideTextColors.body}
          >
            {page.approachesIntroduction}
          </p>
          <ul className="mt-5 space-y-4">
            {page.solutionApproaches.map((item) => (
              <li key={item.approach}>
                <Card className="rounded-xl p-5">
                  <h3
                    className="text-sm font-semibold text-gray-900"
                    style={guideTextColors.heading}
                  >
                    {item.approach}
                  </h3>
                  <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <dt
                        className="text-xs font-semibold uppercase tracking-wide text-gray-500"
                        style={guideTextColors.muted}
                      >
                        Best suited to
                      </dt>
                      <dd
                        className="mt-1 text-sm leading-6 text-gray-700"
                        style={guideTextColors.body}
                      >
                        {item.bestFor}
                      </dd>
                    </div>
                    {item.limitation && (
                      <div>
                        <dt
                          className="text-xs font-semibold uppercase tracking-wide text-gray-500"
                          style={guideTextColors.muted}
                        >
                          Consider
                        </dt>
                        <dd
                          className="mt-1 text-sm leading-6 text-gray-700"
                          style={guideTextColors.body}
                        >
                          {item.limitation}
                        </dd>
                      </div>
                    )}
                  </dl>
                </Card>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="product-differentiation">
          <h2 id="product-differentiation" style={guideTextColors.heading}>
            {headings.productDifferentiation}
          </h2>
          <Card className="mt-5 rounded-xl p-6 sm:p-8">
            <p className="leading-7 text-gray-700" style={guideTextColors.body}>
              {page.productDifferentiation.introduction}
            </p>
            <ul className="mt-5 grid gap-4 sm:grid-cols-2">
              {page.productDifferentiation.inputs.map((item) => (
                <li key={item.source} className="rounded-xl bg-gray-50 p-4">
                  <p
                    className="text-sm font-semibold text-gray-900"
                    style={guideTextColors.heading}
                  >
                    {item.source}
                  </p>
                  <p
                    className="mt-2 text-sm leading-6 text-gray-700"
                    style={guideTextColors.body}
                  >
                    {item.contribution}
                  </p>
                </li>
              ))}
            </ul>
            <div className="mt-4 rounded-xl bg-sky-50 p-5">
              <p
                className="text-xs font-semibold uppercase tracking-wide text-gray-500"
                style={guideTextColors.muted}
              >
                Result
              </p>
              <p
                className="mt-2 font-semibold leading-7 text-gray-900"
                style={guideTextColors.heading}
              >
                {page.productDifferentiation.outcome}
              </p>
            </div>
            <p
              className="mt-5 text-sm leading-6 text-gray-700"
              style={guideTextColors.body}
            >
              {page.productBridge}
            </p>
          </Card>
        </section>

        <section aria-labelledby="software-fit">
          <h2 id="software-fit" style={guideTextColors.heading}>
            {headings.fit}
          </h2>
          <p
            className="mt-3 max-w-2xl leading-7 text-gray-700"
            style={guideTextColors.body}
          >
            {page.fitIntroduction}
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Card className="rounded-xl p-5">
              <h3
                className="text-sm font-semibold text-gray-900"
                style={guideTextColors.heading}
              >
                Good fit
              </h3>
              <ul className="mt-4 space-y-4">
                {page.goodFit.map((item) => (
                  <li key={item.situation}>
                    <p
                      className="text-sm font-semibold text-gray-900"
                      style={guideTextColors.heading}
                    >
                      {item.situation}
                    </p>
                    <p
                      className="mt-1 text-sm leading-6 text-gray-700"
                      style={guideTextColors.body}
                    >
                      {item.guidance}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="rounded-xl p-5">
              <h3
                className="text-sm font-semibold text-gray-900"
                style={guideTextColors.heading}
              >
                Poorer fit
              </h3>
              <ul className="mt-4 space-y-4">
                {page.poorFit.map((item) => (
                  <li key={item.situation}>
                    <p
                      className="text-sm font-semibold text-gray-900"
                      style={guideTextColors.heading}
                    >
                      {item.situation}
                    </p>
                    <p
                      className="mt-1 text-sm leading-6 text-gray-700"
                      style={guideTextColors.body}
                    >
                      {item.guidance}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
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
              {page.ctaHeading}
            </h2>
            <p
              className="mt-2 text-sm text-gray-300"
              style={guideTextColors.inverseBody}
            >
              {page.ctaDescription}
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
                      <span
                        className="text-base font-semibold leading-6 text-gray-900 group-hover:text-gray-700"
                        style={guideTextColors.heading}
                      >
                        {relatedPage.h1}
                      </span>
                      <span
                        className="text-sm font-medium text-gray-600 group-hover:text-gray-900"
                        style={guideTextColors.body}
                      >
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
