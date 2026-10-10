'use client'

import { Suspense } from 'react'
import DashboardOnboardingClient from '@/app/dashboard/DashboardOnboardingClient'
import QueueState from '@/app/collections/actions/QueueState'

export default function DashboardPage() {
  return (
    <Suspense fallback={<QueueState title="Loading priorities…" loading />}>
      <DashboardOnboardingClient />
    </Suspense>
  )
}
