import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSiteUrl } from '@/lib/site-url'
import Card from '@/app/components/Card'

type SearchParams = Record<string, string | string[] | undefined>
const siteUrl = getSiteUrl()

export const metadata: Metadata = {
  title: 'Launch Your SaaS Faster with Auth + Billing Built In',
  description:
    'Ship a production-ready SaaS foundation with authentication, subscriptions, dashboard workflows, and SEO-friendly pages.',
  alternates: {
    canonical: '/',
  },
  keywords: [
    'SaaS template',
    'Next.js SaaS starter',
    'authentication',
    'subscriptions',
    'Stripe billing',
    'Supabase',
  ],
  openGraph: {
    title: 'Launch Your SaaS Faster with Auth + Billing Built In',
    description:
      'Start with auth, subscriptions, and dashboard workflows so you can focus on product and growth.',
    url: siteUrl,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Launch Your SaaS Faster with Auth + Billing Built In',
    description:
      'Start with auth, subscriptions, and dashboard workflows so you can focus on product and growth.',
  },
}

export default function Home({
  searchParams,
}: {
  searchParams?: SearchParams
}) {
  if (searchParams?.code) {
    const params = new URLSearchParams()
    Object.entries(searchParams).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((v) => params.append(key, v))
      } else if (value) {
        params.append(key, value)
      }
    })
    const query = params.toString()
    const target = query
      ? `/auth/callback?next=/reset-password&${query}`
      : `/auth/callback?next=/reset-password`
    redirect(target)
  }

  const softwareJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Template App',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: siteUrl,
    description:
      'A SaaS starter with authentication, subscriptions, and dashboard workflows.',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
  }

  return (
    <div className="space-y-14 pb-10 sm:pb-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }}
      />

      <section className="rounded-2xl border border-gray-200 bg-gradient-to-b from-white to-gray-100 px-8 py-12 sm:px-12 sm:py-14">
        <p className="text-sm font-semibold uppercase tracking-wide text-gray-600">
          SaaS Starter Platform
        </p>
        <h1 className="mt-5 max-w-5xl text-balance text-4xl font-semibold leading-[1.08] text-gray-900 sm:text-5xl">
          Launch faster with auth, billing, and dashboard workflows ready on day one
        </h1>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-gray-700">
          Skip setup debt. Template App gives you a production-ready foundation so
          you can spend your first weeks shipping customer value, not wiring
          infrastructure.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link
            href="/pricing"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-gray-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-gray-800"
          >
            Start now
          </Link>
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 bg-white px-6 py-3 text-sm font-medium text-gray-900 transition hover:bg-gray-50"
          >
            Sign in to dashboard
          </Link>
        </div>
      </section>

      <section className="grid gap-6 sm:grid-cols-3">
        <Card className="rounded-xl p-7">
          <h2 className="text-xl font-semibold">Immediate Value</h2>
          <p className="mt-3 text-base leading-relaxed text-gray-600">
            User auth, account management, and gated flows are already in place.
          </p>
        </Card>
        <Card className="rounded-xl p-7">
          <h2 className="text-xl font-semibold">Revenue Ready</h2>
          <p className="mt-3 text-base leading-relaxed text-gray-600">
            Stripe checkout and subscription lifecycle endpoints are included.
          </p>
        </Card>
        <Card className="rounded-xl p-7">
          <h2 className="text-xl font-semibold">SEO Foundation</h2>
          <p className="mt-3 text-base leading-relaxed text-gray-600">
            Metadata, sitemap, robots, and content routes help pages index cleanly.
          </p>
        </Card>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-8 sm:p-10">
        <h2 className="text-2xl font-semibold text-gray-900">Why teams choose this starter</h2>
        <p className="mt-5 max-w-3xl text-lg leading-relaxed text-gray-700">
          Instead of spending weeks integrating auth, billing, and account controls,
          you can deploy a coherent baseline immediately. This reduces launch risk
          and gives your product team a clean path to iterate.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            href="/contact"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-900 transition hover:bg-gray-50"
          >
            Talk to us
          </Link>
          <Link
            href="/blog"
            className="inline-flex min-h-11 items-center justify-center rounded-xl px-5 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
          >
            Read implementation guides
          </Link>
        </div>
      </section>
    </div>
  )
}
