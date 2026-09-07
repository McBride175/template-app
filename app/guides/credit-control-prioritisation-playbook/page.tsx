import type { Metadata } from 'next'
import Link from 'next/link'
import Card from '@/app/components/Card'
import { getSiteUrl } from '@/lib/site-url'
import PrioritisationPlaybook from './PrioritisationPlaybook'

const title = 'The SME Credit Control Prioritisation Playbook'
const description =
  'Learn who to chase first when several customers are overdue. Try a worked example that combines exposure, lateness, payment behaviour and your own customer knowledge.'
const canonicalPath = '/guides/credit-control-prioritisation-playbook'

export const metadata: Metadata = {
  title,
  description,
  alternates: {
    canonical: canonicalPath,
  },
  keywords: [
    'credit control prioritisation',
    'who to chase first for payment',
    'prioritise overdue customers',
    'SME credit control',
    'Xero overdue invoices',
  ],
  openGraph: {
    title,
    description,
    url: canonicalPath,
    type: 'article',
  },
  twitter: {
    title,
    description,
  },
}

const principles = [
  {
    number: '01',
    title: 'Exposure sets the cash consequence',
    body: 'Start with the total overdue amount per customer, not a single invoice line. More cash at stake matters, but it is not an automatic instruction to chase.',
  },
  {
    number: '02',
    title: 'Lateness needs context',
    body: 'Age tells you how long the position has existed. It does not tell you whether payment is already moving, blocked by a dispute or unusually late for this customer.',
  },
  {
    number: '03',
    title: 'Look for a change in behaviour',
    body: 'A customer moving from two days late to 31 days late has changed. A reliable customer who usually pays 40 days late may simply be following an established pattern.',
  },
  {
    number: '04',
    title: 'Add what the ledger cannot know',
    body: 'A broken promise, private warning, strategic relationship, credible payment date or known dispute can change the priority. Your judgement is evidence, not noise.',
  },
]

const supportingGuides = [
  {
    href: '/guides/how-to-prioritise-overdue-invoices',
    title: 'How to prioritise overdue invoices',
    description: 'Use the full four-signal method on a real overdue ledger.',
  },
  {
    href: '/guides/how-payment-history-should-affect-invoice-chasing',
    title: 'How payment history should affect chasing',
    description: 'Interpret current lateness against each customer’s normal pattern.',
  },
  {
    href: '/guides/how-to-prioritise-debtors-by-risk',
    title: 'How to prioritise debtors by risk',
    description: 'Use specific business evidence without turning risk into guesswork.',
  },
  {
    href: '/guides/how-to-prioritise-overdue-invoices-in-xero',
    title: 'How to prioritise overdue invoices in Xero',
    description: 'Turn Xero receivables into a customer-level chase order.',
  },
]

export default function CreditControlPrioritisationPlaybookPage() {
  const siteUrl = getSiteUrl()
  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: title,
      description,
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
          name: title,
          item: `${siteUrl}${canonicalPath}`,
        },
      ],
    },
  ]

  return (
    <article className="pb-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <header className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
        <div className="px-6 py-10 sm:px-10 sm:py-14">
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-600">
              <li>
                <Link href="/blog" className="hover:text-gray-900">
                  Credit control guides
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page">Interactive playbook</li>
            </ol>
          </nav>
          <p className="mt-8 text-xs font-semibold uppercase tracking-[0.18em] text-sky-800">
            Free interactive guide · No login or Xero connection
          </p>
          <h1 className="mt-4 max-w-3xl text-balance text-4xl leading-[1.08] sm:text-5xl">
            When several customers are overdue, who should you chase first?
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-gray-700">
            The biggest balance is not always the best first call. Neither is the oldest invoice.
            A useful priority combines the cash at stake, how late it is, whether behaviour has
            changed and what you know about the customer that the ledger does not.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <a
              href="#worked-example"
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-gray-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-gray-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
            >
              Try the worked example ↓
            </a>
            <span className="text-sm text-gray-600">About 10 minutes · Uses fictional data</span>
          </div>
        </div>
        <div className="grid border-t border-gray-200 bg-sky-50 sm:grid-cols-3">
          {['Accounting evidence', 'Payment behaviour', 'Your customer knowledge'].map(
            (item, index) => (
              <div
                key={item}
                className="flex items-center gap-3 border-b border-gray-200 px-6 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-900 text-xs font-bold text-white">
                  {index + 1}
                </span>
                <span className="text-sm font-semibold text-gray-800">{item}</span>
              </div>
            )
          )}
        </div>
      </header>

      <div className="mx-auto mt-14 max-w-3xl space-y-14 sm:mt-16 sm:space-y-16">
        <section aria-labelledby="common-mistake-heading">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-800">
            The common mistake
          </p>
          <h2 id="common-mistake-heading" className="mt-2 text-3xl">
            An aged receivables report is not a chase order
          </h2>
          <p className="mt-4 max-w-2xl leading-7 text-gray-700">
            Sorting by largest balance protects cash exposure. Sorting by oldest invoice spots
            long-running debt. Both views are useful, but each answers only one question. Neither
            knows whether a payment arrived yesterday, whether this delay is unusual, or whether
            a customer has told you something important.
          </p>
          <div className="mt-7 grid gap-4 sm:grid-cols-3">
            {[
              ['Largest first', 'Can interrupt a large account that is already paying while a smaller risk deteriorates.'],
              ['Oldest first', 'Can overstate a predictable slow payer and hide a newer break from normal behaviour.'],
              ['Loudest first', 'Lets inbox pressure decide where your scarce collection time goes.'],
            ].map(([heading, body]) => (
              <Card key={heading} className="rounded-2xl p-5 shadow-sm">
                <h3 className="text-base">{heading}</h3>
                <p className="mt-2 text-sm leading-6 text-gray-600">{body}</p>
              </Card>
            ))}
          </div>
        </section>
      </div>

      <section id="worked-example" aria-labelledby="worked-example-heading" className="mt-14 scroll-mt-24 sm:mt-16">
        <div className="rounded-3xl border border-gray-200 bg-white px-5 py-8 shadow-sm sm:px-8 sm:py-10">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-800">
              Interactive worked example
            </p>
            <h2 id="worked-example-heading" className="mt-2 text-3xl">
              Six overdue customers. One hour. Where do you start?
            </h2>
            <p className="mt-4 leading-7 text-gray-700">
              The initial order is calculated by the same ranking function as the product, using
              customer-level exposure, weighted lateness, overdue-invoice count, payment recency
              and a founder-controlled priority adjustment. Every customer starts at neutral
              Medium concern. Change a concern level and the full list re-ranks immediately.
            </p>
            <p className="mt-3 text-sm leading-6 text-gray-600">
              Normal payment behaviour is shown to help you interpret the evidence, but it is not
              a separate scored input in the current engine. This is an educational comparison,
              not a default prediction; it deliberately shows reasons instead of numerical scores.
            </p>
          </div>

          <PrioritisationPlaybook />
        </div>
      </section>

      <div className="mx-auto mt-14 max-w-3xl space-y-14 sm:mt-16 sm:space-y-16">
        <section aria-labelledby="what-it-shows-heading">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-800">
            What the example demonstrates
          </p>
          <h2 id="what-it-shows-heading" className="mt-2 text-3xl">
            Priority is a reasoned comparison, not one winning column
          </h2>
          <div className="mt-7 divide-y divide-sky-200 border-y border-sky-200">
            {principles.map((principle) => (
              <div key={principle.number} className="grid gap-3 py-6 sm:grid-cols-[3rem_1fr]">
                <span className="text-sm font-bold tracking-wider text-sky-800">
                  {principle.number}
                </span>
                <div>
                  <h3 className="text-lg">{principle.title}</h3>
                  <p className="mt-2 leading-7 text-gray-600">{principle.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="framework-heading">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-800">
            A practical decision framework
          </p>
          <h2 id="framework-heading" className="mt-2 text-3xl">
            Build a priority list you can defend
          </h2>
          <ol className="mt-7 space-y-4">
            {[
              ['Group by customer', 'Add the overdue invoices for each customer so one relationship receives one priority.'],
              ['Set aside genuine progress', 'Park cleared payments, credible future promises and known blockers until their agreed review date.'],
              ['Compare the live candidates', 'Read exposure, lateness and payment behaviour together. Ask what has changed, not only what is old.'],
              ['Add a specific judgement', 'Record the fact behind your concern, choose the next useful action and re-rank when new evidence arrives.'],
            ].map(([heading, body], index) => (
              <li key={heading} className="flex gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-base">{heading}</h3>
                  <p className="mt-1 text-sm leading-6 text-gray-600">{body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-5 text-sm leading-6 text-gray-600">
            The result is not a permanent label for each customer. It is a current order for the
            collection time you actually have.
          </p>
        </section>

        <section aria-labelledby="scaling-heading" className="rounded-3xl border border-sky-200 bg-sky-50 p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-800">
            The scaling problem
          </p>
          <h2 id="scaling-heading" className="mt-2 text-3xl">
            Six customers are manageable. Sixty keep changing.
          </h2>
          <p className="mt-4 leading-7 text-gray-700">
            You can reason through this example by hand. Across 20, 40 or 100 customers, the work
            is not just choosing once. Invoices age, payments arrive, promises pass, disputes move
            and you learn new information. Every change can alter the relative order.
          </p>
          <p className="mt-3 leading-7 text-gray-700">
            That is why a monthly aged report becomes cognitively expensive: the founder has to
            reconstruct both the accounting position and the customer story before deciding where
            to spend a limited hour.
          </p>
        </section>

        <section aria-labelledby="product-transition-heading">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-800">
            Keep the judgement. Automate the comparison.
          </p>
          <h2 id="product-transition-heading" className="mt-2 text-3xl">
            Let the app maintain the order across your Xero debtor book
          </h2>
          <p className="mt-4 leading-7 text-gray-700">
            The app refreshes the accounting evidence across all customers, compares exposure,
            lateness and payment behaviour, and applies the priority context you provide. It does
            not pretend to predict default or replace your judgement. It keeps both sources of
            evidence in one current queue so you can decide who deserves attention now.
          </p>
          <div className="mt-7 rounded-2xl bg-gray-900 px-6 py-8 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:px-8">
            <div>
              <h3 className="text-xl text-white">
                See what deserves attention across your real debtor book
              </h3>
              <p className="mt-2 text-sm leading-6 text-gray-300">
                Connect Xero, add the customer context only you know, and work from a queue that
                changes as the evidence changes.
              </p>
            </div>
            <Link
              href="/pricing"
              className="mt-5 inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-gray-900 transition hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 sm:mt-0"
            >
              See plans and pricing
            </Link>
          </div>
        </section>

        <section aria-labelledby="supporting-guides-heading">
          <h2 id="supporting-guides-heading" className="text-2xl">
            Go deeper on the decisions behind the queue
          </h2>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {supportingGuides.map((guide) => (
              <li key={guide.href}>
                <Card className="h-full rounded-2xl p-5 shadow-sm">
                  <Link href={guide.href} className="group flex h-full flex-col justify-between gap-4">
                    <span>
                      <span className="text-base font-semibold leading-6 text-gray-900 group-hover:text-sky-800">
                        {guide.title}
                      </span>
                      <span className="mt-2 block text-sm leading-6 text-gray-600">
                        {guide.description}
                      </span>
                    </span>
                    <span className="text-sm font-semibold text-sky-800">Read the guide →</span>
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </article>
  )
}
