'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Card from '@/app/components/Card'
import ManageSubscriptionButton from '@/app/components/ManageSubscriptionButton'
import ChangePasswordButton from '@/app/components/ChangePasswordButton'
import Button from '@/app/components/Button'
import { supabase } from '@/lib/supabase'

interface SubscriptionData {
  hasActive: boolean
  status: string | null
  current_period_end: string | null
  hasCustomer: boolean
  plan?: 'basic' | 'pro' | null
}

export default function AccountPage() {
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.auth.getSession()
      if (!data.session?.user) {
        router.replace('/login')
        return
      }
      setEmail(data.session.user.email ?? null)

      try {
        const response = await fetch('/api/subscription', {
          cache: 'no-store',
          credentials: 'include',
        })
        if (response.ok) {
          const sub: SubscriptionData = await response.json()
          setSubscription(sub)
        }
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [router])

  if (loading) return null

  return (
    <div className="space-y-8">
      <div>
        <h1>Account</h1>
        <p className="mt-2 text-sm text-gray-600">Manage your account details</p>
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="mb-2">Signed in</h2>
            <p className="text-sm text-gray-700">{email}</p>
            {!subscription?.hasCustomer && (
              <p className="mt-1 text-sm text-gray-500">Not subscribed yet</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            {subscription?.hasCustomer ? (
              <ManageSubscriptionButton />
            ) : (
              <Button
                onClick={() => router.push('/pricing')}
                variant="primary"
                size="sm"
              >
                Choose a plan
              </Button>
            )}
            <ChangePasswordButton email={email ?? ''} />
          </div>
        </div>
      </Card>
    </div>
  )
}
