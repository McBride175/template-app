import type { Metadata } from 'next'
import PricingClient from './PricingClient'

export const metadata: Metadata = {
  title: {
    absolute: 'Pricing',
  },
  description: 'Compare Yuohme Basic and Pro plans for prioritising overdue customer collections.',
  alternates: {
    canonical: '/pricing',
  },
  openGraph: {
    title: 'Pricing',
    description: 'Compare Yuohme Basic and Pro plans for prioritising overdue customer collections.',
    url: '/pricing',
    type: 'website',
  },
  twitter: {
    title: 'Pricing',
    description: 'Compare Yuohme Basic and Pro plans for prioritising overdue customer collections.',
  },
}

export default function PricingPage() {
  return <PricingClient />
}
