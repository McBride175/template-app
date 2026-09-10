import type { Metadata } from 'next'
import { LEGAL_LAST_UPDATED_LABEL } from '@/app/legal/constants'

const title = 'Cookie Policy'
const description = 'Read how essential authentication and session cookies are used by this service.'

export const metadata: Metadata = {
  title: {
    absolute: title,
  },
  description,
  alternates: {
    canonical: '/legal/cookies',
  },
  openGraph: {
    title,
    description,
    url: '/legal/cookies',
    type: 'website',
  },
  twitter: {
    title,
    description,
  },
}

export default function CookiesPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1>Cookie Policy</h1>
        <p className="text-sm text-gray-500">{LEGAL_LAST_UPDATED_LABEL}</p>
      </header>

      <section className="space-y-2">
        <h2>1. Essential Cookies Only</h2>
        <p className="text-sm text-gray-700">
          This app currently uses only essential cookies required for authentication and secure session
          management.
        </p>
      </section>

      <section className="space-y-2">
        <h2>2. Why These Cookies Are Required</h2>
        <p className="text-sm text-gray-700">
          Session cookies are used so authenticated requests can be securely associated with your account.
          Without these cookies, sign-in and account features will not function.
        </p>
      </section>

      <section className="space-y-2">
        <h2>3. Third-Party Services</h2>
        <p className="text-sm text-gray-700">
          Authentication and database services are provided by Supabase. Subscription billing is handled by
          Stripe. We can update this page if non-essential cookies are introduced in the future.
        </p>
      </section>
    </div>
  )
}
