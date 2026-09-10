import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { getSiteUrl } from '@/lib/site-url'
import Card from '@/app/components/Card'
import HomePageClient from './HomePageClient'
const siteUrl = getSiteUrl()

export const metadata: Metadata = {
  title: {
    absolute: 'Collections Decision Engine for Cash per Effort',
  },
  description:
    'Prioritise overdue accounts by cash impact and urgency so teams spend effort where it drives the most collections.',
  alternates: {
    canonical: '/',
  },
  keywords: [
    'collections decision engine',
    'accounts receivable prioritization',
    'cash collection optimisation',
    'overdue invoice actions',
    'collections workflow',
    'effort per cash collected',
  ],
  openGraph: {
    title: 'Collections Decision Engine for Cash per Effort',
    description:
      'Rank overdue customers by expected impact so your team takes the highest-return collection actions first.',
    url: siteUrl,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Collections Decision Engine for Cash per Effort',
    description:
      'Rank overdue customers by expected impact so your team takes the highest-return collection actions first.',
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
          Optimise effort spent per cash collected
        </h1>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-gray-700">
          Focus your team on the overdue customers that will return the highest
          cash impact first. The dashboard ranks who to call, email, or monitor
          by combining Xero evidence, payment behaviour, and the priority adjustment
          your team chooses.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link
            href="/pricing"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-gray-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-gray-800"
          >
            Start optimizing
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
          <h2 className="text-xl font-semibold">Action Ranking</h2>
          <p className="mt-3 text-base leading-relaxed text-gray-600">
            Surface the next best customer actions with clear priority scores and reasons.
          </p>
        </Card>
        <Card className="rounded-xl p-7">
          <h2 className="text-xl font-semibold">Effort Efficiency</h2>
          <p className="mt-3 text-base leading-relaxed text-gray-600">
            Allocate collector time where each follow-up is expected to return the most cash.
          </p>
        </Card>
        <Card className="rounded-xl p-7">
          <h2 className="text-xl font-semibold">Operational Clarity</h2>
          <p className="mt-3 text-base leading-relaxed text-gray-600">
            Keep your team aligned on overdue risk, recommended action, and what to do next.
          </p>
        </Card>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-8 sm:p-10">
        <h2 className="text-2xl font-semibold text-gray-900">Why finance teams use this engine</h2>
        <p className="mt-5 max-w-3xl text-lg leading-relaxed text-gray-700">
          Collections performance improves when effort is directed, not just increased.
          This engine helps teams prioritise high-return actions and reduce time spent
          on low-impact follow-ups.
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
