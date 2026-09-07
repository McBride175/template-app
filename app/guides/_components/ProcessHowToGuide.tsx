import Link from 'next/link'
import Card from '@/app/components/Card'
import type {
  SeoGuideCategory,
  SeoProblemPage,
  SeoProcessHowToPage,
} from '@/content/seo-pages'
import WorkedProcessExample from './WorkedProcessExample'

interface ProcessHowToGuideProps {
  page: SeoProcessHowToPage
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
  minimumProcess: 'The minimum process',
  operatingRhythm: 'How to run it in practice',
  automationAndJudgement: 'What to systemise and where judgement matters',
  workedExample: 'Worked operating example',
  failurePoints: 'Common failure points',
  productBridge: 'Keep human attention focused on the right accounts',
  relatedGuides: 'Related guides',
}

export default function ProcessHowToGuide({
  page,
  category,
  relatedPages,
}: ProcessHowToGuideProps) {
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
        <section aria-labelledby="minimum-process">
          <h2 id="minimum-process" style={guideTextColors.heading}>
            {headings.minimumProcess}
          </h2>
          <p
            className="mt-3 max-w-2xl leading-7 text-gray-700"
            style={guideTextColors.body}
          >
            {page.processIntroduction}
          </p>
          <ol className="mt-5 space-y-3">
            {page.processStages.map((stage, index) => (
              <li
                key={stage.stage}
                className="flex gap-4 rounded-xl border border-gray-200 bg-white p-4"
              >
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white"
                >
                  {index + 1}
                </span>
                <div className="pt-0.5">
                  <h3
                    className="text-sm font-semibold text-gray-900"
                    style={guideTextColors.heading}
                  >
                    {stage.stage}
                  </h3>
                  <p
                    className="mt-1 text-sm leading-6 text-gray-700"
                    style={guideTextColors.body}
                  >
                    {stage.guidance}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="operating-rhythm">
          <h2 id="operating-rhythm" style={guideTextColors.heading}>
            {headings.operatingRhythm}
          </h2>
          <p
            className="mt-3 max-w-2xl leading-7 text-gray-700"
            style={guideTextColors.body}
          >
            {page.operatingIntroduction}
          </p>
          <ul className="mt-5 space-y-4">
            {page.operatingRhythm.map((item) => (
              <li key={item.cadence}>
                <Card className="rounded-xl p-5">
                  <h3
                    className="text-sm font-semibold text-gray-900"
                    style={guideTextColors.heading}
                  >
                    {item.cadence}
                  </h3>
                  <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <dt
                        className="text-xs font-semibold uppercase tracking-wide text-gray-500"
                        style={guideTextColors.muted}
                      >
                        What to do
                      </dt>
                      <dd
                        className="mt-1 text-sm leading-6 text-gray-700"
                        style={guideTextColors.body}
                      >
                        {item.activity}
                      </dd>
                    </div>
                    <div>
                      <dt
                        className="text-xs font-semibold uppercase tracking-wide text-gray-500"
                        style={guideTextColors.muted}
                      >
                        Why it matters
                      </dt>
                      <dd
                        className="mt-1 text-sm leading-6 text-gray-700"
                        style={guideTextColors.body}
                      >
                        {item.purpose}
                      </dd>
                    </div>
                  </dl>
                </Card>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="automation-and-judgement">
          <h2 id="automation-and-judgement" style={guideTextColors.heading}>
            {headings.automationAndJudgement}
          </h2>
          <p
            className="mt-3 max-w-2xl leading-7 text-gray-700"
            style={guideTextColors.body}
          >
            {page.automationAndJudgement.introduction}
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Card className="rounded-xl p-5">
              <h3
                className="text-sm font-semibold text-gray-900"
                style={guideTextColors.heading}
              >
                Routine work
              </h3>
              <ul className="mt-4 space-y-4">
                {page.automationAndJudgement.routineWork.map((item) => (
                  <li key={item.task}>
                    <p
                      className="text-sm font-semibold text-gray-900"
                      style={guideTextColors.heading}
                    >
                      {item.task}
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
                Work that needs judgement
              </h3>
              <ul className="mt-4 space-y-4">
                {page.automationAndJudgement.judgementWork.map((item) => (
                  <li key={item.task}>
                    <p
                      className="text-sm font-semibold text-gray-900"
                      style={guideTextColors.heading}
                    >
                      {item.task}
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

        <section aria-labelledby="worked-process-example">
          <h2 id="worked-process-example" style={guideTextColors.heading}>
            {headings.workedExample}
          </h2>
          <WorkedProcessExample example={page.workedExample} />
        </section>

        <section aria-labelledby="process-failure-points">
          <h2 id="process-failure-points" style={guideTextColors.heading}>
            {headings.failurePoints}
          </h2>
          <ul className="mt-5 space-y-4">
            {page.failurePoints.map((point) => (
              <li key={point.failure}>
                <Card className="rounded-xl p-5">
                  <h3
                    className="text-sm font-semibold text-gray-900"
                    style={guideTextColors.heading}
                  >
                    {point.failure}
                  </h3>
                  <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <dt
                        className="text-xs font-semibold uppercase tracking-wide text-gray-500"
                        style={guideTextColors.muted}
                      >
                        What goes wrong
                      </dt>
                      <dd
                        className="mt-1 text-sm leading-6 text-gray-700"
                        style={guideTextColors.body}
                      >
                        {point.consequence}
                      </dd>
                    </div>
                    <div>
                      <dt
                        className="text-xs font-semibold uppercase tracking-wide text-gray-500"
                        style={guideTextColors.muted}
                      >
                        Better approach
                      </dt>
                      <dd
                        className="mt-1 text-sm leading-6 text-gray-700"
                        style={guideTextColors.body}
                      >
                        {point.betterApproach}
                      </dd>
                    </div>
                  </dl>
                </Card>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="product-bridge">
          <Card className="rounded-xl p-6 sm:p-8">
            <h2 id="product-bridge" style={guideTextColors.heading}>
              {headings.productBridge}
            </h2>
            <p className="mt-3 leading-7 text-gray-700" style={guideTextColors.body}>
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
