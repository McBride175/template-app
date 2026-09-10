import type { Metadata } from 'next'
import { LEGAL_LAST_UPDATED_LABEL } from '@/app/legal/constants'

const title = 'Terms of Service'
const description = 'Read the terms governing accounts, subscriptions, data and use of this service.'

export const metadata: Metadata = {
  title: {
    absolute: title,
  },
  description,
  alternates: {
    canonical: '/legal/terms',
  },
  openGraph: {
    title,
    description,
    url: '/legal/terms',
    type: 'website',
  },
  twitter: {
    title,
    description,
  },
}

export default function TermsPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1>Terms of Service</h1>
        <p className="text-sm text-gray-500">{LEGAL_LAST_UPDATED_LABEL}</p>
      </header>

      <section className="space-y-2">
        <h2>1. Acceptance of Terms</h2>
        <p className="text-sm text-gray-700">
          By using this application, you agree to these terms and applicable laws. If you do not agree,
          do not use the service.
        </p>
      </section>

      <section className="space-y-2">
        <h2>2. Accounts and Access</h2>
        <p className="text-sm text-gray-700">
          You are responsible for maintaining account security and for all activities under your account.
          Authentication and account session management are provided through Supabase.
        </p>
      </section>

      <section className="space-y-2">
        <h2>3. Billing and Subscriptions</h2>
        <p className="text-sm text-gray-700">
          Paid plans are processed by Stripe. Subscription fees, billing cycles, and cancellation timing are
          shown at checkout. We do not store full payment card numbers on our servers.
        </p>
      </section>

      <section className="space-y-2">
        <h2>4. Data and Service Availability</h2>
        <p className="text-sm text-gray-700">
          We use Supabase to store application data and account records. Service availability may vary and
          we may modify or discontinue features at any time.
        </p>
      </section>

      <section className="space-y-2">
        <h2>5. Contact</h2>
        <p className="text-sm text-gray-700">For legal or support requests, contact the service operator.</p>
      </section>
    </div>
  )
}
