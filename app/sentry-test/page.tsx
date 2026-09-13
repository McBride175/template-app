import { notFound } from 'next/navigation'
import SentryTestClient from './SentryTestClient'

export const dynamic = 'force-dynamic'

export default function TemporarySentryTestPage() {
  if (
    process.env.VERCEL_ENV !== 'preview' ||
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT !== 'test-preview'
  ) {
    notFound()
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Temporary Sentry verification</h1>
      <p>This Preview-only page deliberately throws a non-sensitive client error.</p>
      <SentryTestClient />
    </section>
  )
}
