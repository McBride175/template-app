'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function HomePageClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const accountDeleted = searchParams.get('accountDeleted') === '1'
  const code = searchParams.get('code')

  useEffect(() => {
    if (!code) return

    const query = searchParams.toString()
    const target = query
      ? `/auth/callback?next=/reset-password&${query}`
      : '/auth/callback?next=/reset-password'

    router.replace(target)
  }, [code, router, searchParams])

  if (!accountDeleted) return null

  return (
    <section className="rounded-xl border border-green-200 bg-green-50 px-6 py-4">
      <p className="text-sm font-medium text-green-800">
        Your account and associated data were deleted successfully.
      </p>
    </section>
  )
}
