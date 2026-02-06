'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Session } from '@supabase/supabase-js'
import Card from '@/app/components/Card'
import Button from '@/app/components/Button'
import { supabase } from '@/lib/supabase'

type Plan = 'basic' | 'pro'

interface SubscriptionData {
  hasActive: boolean
  status: string | null
  current_period_end: string | null
  plan?: Plan | null
}

export default function PricingClient() {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyPlan, setBusyPlan] = useState<Plan | null>(null)

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.auth.getSession()
      setSession(data.session ?? null)

      if (data.session) {
        try {
          const response = await fetch('/api/subscription', {
            cache: 'no-store',
            credentials: 'include',
          })
          if (response.ok) {
            const sub: SubscriptionData = await response.json()
            setSubscription(sub)
          }
        } catch {
          // ignore and keep null
        }
      }

      setLoading(false)
    }

    load()
  }, [])

  const handleChoose = async (plan: Plan) => {
    setError(null)

    if (!session) {
      router.push('/login?next=/pricing')
      return
    }

    setBusyPlan(plan)
    try {
      const accessToken = session.access_token
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ plan }),
      })

      if (!response.ok) {
        let details: unknown = null
        try {
          details = await response.json()
        } catch {
          // ignore JSON parse errors
        }
        if (process.env.NODE_ENV !== 'production') {
          console.error('Checkout failed', {
            status: response.status,
            details,
          })
        }
        throw new Error("Couldn’t start checkout. Please try again.")
      }

      const data = await response.json()
      if (!data?.url) {
        throw new Error('No URL returned')
      }

      window.location.href = data.url
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn’t start checkout. Please try again."
      )
    } finally {
      setBusyPlan(null)
    }
  }

  const currentPlan =
    subscription?.hasActive && subscription.plan
      ? `Current: ${subscription.plan === 'pro' ? 'Pro' : 'Basic'}`
      : null

  return (
    <div className="space-y-8">
      <div>
        <h1>Pricing</h1>
        <p className="mt-2 text-gray-600">Choose the plan that fits your needs</p>
      </div>

      {currentPlan && (
        <p className="text-sm text-gray-600">{currentPlan}</p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <div className="space-y-4">
            <div>
              <h2 className="mb-1">Basic</h2>
              <p className="text-sm text-gray-600">$9 / month</p>
            </div>
            <Button
              onClick={() => handleChoose('basic')}
              variant="secondary"
              size="lg"
              className="w-full"
              disabled={loading || busyPlan === 'basic'}
            >
              {busyPlan === 'basic' ? 'Loading…' : 'Choose Basic'}
            </Button>
          </div>
        </Card>

        <Card>
          <div className="space-y-4">
            <div>
              <h2 className="mb-1">Pro</h2>
              <p className="text-sm text-gray-600">$19 / month</p>
            </div>
            <Button
              onClick={() => handleChoose('pro')}
              variant="primary"
              size="lg"
              className="w-full"
              disabled={loading || busyPlan === 'pro'}
            >
              {busyPlan === 'pro' ? 'Loading…' : 'Choose Pro'}
            </Button>
          </div>
        </Card>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
