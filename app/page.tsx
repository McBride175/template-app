import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { getSiteUrl } from '@/lib/site-url'
import Card from '@/app/components/Card'
import HomePageClient from './HomePageClient'
const siteUrl = getSiteUrl()

export const metadata: Metadata = {
  title: {
    absolute: 'Overdue Customer Prioritisation for SMEs',
  },
  description:
    'Rank overdue customers by exposure, urgency, deterioration from their normal payment pattern, payment recency and the priority adjustment your team chooses.',
  alternates: {
    canonical: '/',
  },
  keywords: [
    'collections decision engine',
    'accounts receivable prioritization',
    'overdue customer prioritisation',
    'overdue invoice actions',
    'collections workflow',
    'who to chase first',
  ],
  openGraph: {
    title: 'Overdue Customer Prioritisation for SMEs',
    description:
      'Decide which overdue customers deserve attention first using current Xero evidence and your team’s priority adjustment.',
    url: siteUrl,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Overdue Customer Prioritisation for SMEs',
    description:
      'Decide which overdue customers deserve attention first using current Xero evidence and your team’s priority adjustment.',
  },
}

export default function Home() {
  return (
    <div className="space-y-14 pb-10 sm:pb-14">
      <Suspense fallback={null}>
        <HomePageClient />
      </Suspense>

      <section className="rounded-2xl border border-gray-200 bg-gradient-to-b from-white to-gray-100 px-8 py-12 sm:px-12 sm:py-14">
        <p className="text-sm font-semibold uppercase tracking-wide text-gray-600">
          Collections Decision Engine
        </p>
        <h1 className="mt-5 max-w-5xl text-balance text-5xl font-semibold leading-[1.08] text-gray-900 sm:text-6xl">
          Know which overdue customer to chase first
        </h1>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-gray-700">
          Turn a changing Xero debtor book into a clear customer order. The dashboard
          compares overdue exposure, urgency, changes from each customer&apos;s normal payment
          pattern and payment recency, then applies the priority adjustment your team chooses.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link
            href="/pricing"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-gray-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-gray-800"
          >
            Start prioritising
          </Link>
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 bg-white px-6 py-3 text-sm font-medium text-gray-900 transition hover:bg-gray-50"
          >
            Open dashboard
          </Link>
        </div>
      </section>

      <section className="grid gap-6 sm:grid-cols-3">
        <Card className="rounded-xl p-7">
          <h2 className="text-xl font-semibold">Customer Ranking</h2>
          <p className="mt-3 text-base leading-relaxed text-gray-600">
            Surface overdue customers in a clear order with transparent priority scores and reasons.
          </p>
        </Card>
        <Card className="rounded-xl p-7">
          <h2 className="text-xl font-semibold">Focused Collection Time</h2>
          <p className="mt-3 text-base leading-relaxed text-gray-600">
            Use limited chasing time on the customers whose current signals place them first.
          </p>
        </Card>
        <Card className="rounded-xl p-7">
          <h2 className="text-xl font-semibold">Human Context</h2>
          <p className="mt-3 text-base leading-relaxed text-gray-600">
            Adjust priority when your team knows something the ledger cannot explain.
          </p>
        </Card>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-8 sm:p-10">
        <h2 className="text-2xl font-semibold text-gray-900">Why finance teams use this engine</h2>
        <p className="mt-5 max-w-3xl text-lg leading-relaxed text-gray-700">
          Treating every overdue customer equally wastes limited collection time. This
          engine keeps a defensible customer order current so the team can start with
          the accounts that deserve attention first.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            href="/contact"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-900 transition hover:bg-gray-50"
          >
            Talk to us
          </Link>
          <Link
            href="/guides/credit-control-prioritisation-playbook"
            className="inline-flex min-h-11 items-center justify-center rounded-xl px-5 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
          >
            Try the prioritisation playbook
          </Link>
        </div>
      </section>
    </div>
  )
}
