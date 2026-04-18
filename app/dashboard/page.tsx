'use client'

import { Suspense, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'
import CollectionActionsClient from '@/app/collections/actions/CollectionActionsClient'
import { triggerXeroAutoSyncOnEntry } from '@/lib/xero/auto-sync-client'

function DashboardPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tenantId = searchParams.get('tenantId')

  useEffect(() => {
    // If user signs out while on dashboard, kick them to login
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace('/login')
    })

    // Initial check and load user data
    const run = async () => {
      const { data } = await supabase.auth.getUser()

      if (!data.user) {
        router.replace('/login')
        return
      }

      triggerXeroAutoSyncOnEntry({
        surface: 'dashboard',
        tenantId,
      })
    }

    run()

    return () => {
      sub.subscription.unsubscribe()
    }
  }, [router, tenantId])

  return (
    <div className="space-y-8">
      <CollectionActionsClient embedded showTable={false} tenantId={tenantId} />
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-600">Loading dashboard…</div>}>
      <DashboardPageContent />
    </Suspense>
  )
}
