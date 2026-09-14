'use client'

import { Suspense } from 'react'
import DashboardOnboardingClient from '@/app/dashboard/DashboardOnboardingClient'

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-600">Loading dashboard…</div>}>
      <DashboardOnboardingClient />
    </Suspense>
  )
}
