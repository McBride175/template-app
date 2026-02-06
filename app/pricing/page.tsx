import type { Metadata } from 'next'
import PricingClient from './PricingClient'

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Compare plans and choose the subscription that fits your needs.',
  alternates: {
    canonical: '/pricing',
  },
  openGraph: {
    title: 'Pricing | Template App',
    description: 'Compare plans and choose the subscription that fits your needs.',
    url: '/pricing',
    type: 'website',
  },
  twitter: {
    title: 'Pricing | Template App',
    description: 'Compare plans and choose the subscription that fits your needs.',
  },
}

export default function PricingPage() {
  return <PricingClient />
}
