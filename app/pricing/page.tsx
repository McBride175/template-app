import type { Metadata } from 'next'
import PricingClient from './PricingClient'

export const metadata: Metadata = {
  title: {
    absolute: 'Pricing',
  },
  description: 'Explore suggested Basic and Pro pricing ideas for a collections decision engine.',
  alternates: {
    canonical: '/pricing',
  },
  openGraph: {
    title: 'Pricing',
    description: 'Explore suggested Basic and Pro pricing ideas for a collections decision engine.',
    url: '/pricing',
    type: 'website',
  },
  twitter: {
    title: 'Pricing',
    description: 'Explore suggested Basic and Pro pricing ideas for a collections decision engine.',
  },
}

export default function PricingPage() {
  return <PricingClient />
}
