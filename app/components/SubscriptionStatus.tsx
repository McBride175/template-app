/**
 * SubscriptionStatus Component
 * 
 * TEMPLATE CODE: Client component to poll and display subscription status.
 * Handles polling after checkout success to handle webhook delays.
 */
'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Card from './Card'

interface SubscriptionData {
  hasActive: boolean
  status: string | null
  current_period_end: string | null
}

function SubscriptionStatusContent() {
  const searchParams = useSearchParams()
  const checkoutSuccess = searchParams.get('checkout') === 'success'
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [polling, setPolling] = useState(false)
  const [pollTimeout, setPollTimeout] = useState(false)

  // Fetch subscription status
  const fetchSubscription = async () => {
    try {
      // TEMPLATE CODE: Use cookie-based auth with no caching
      // credentials: 'include' ensures cookies are sent with the request
      // cache: 'no-store' prevents browser/CDN caching
      const response = await fetch('/api/subscription', {
        cache: 'no-store',
        credentials: 'include',
      })

      if (!response.ok) {
        if (response.status === 401) {
          // User is not authenticated, redirect to login
          window.location.href = '/login'
          return
        }
        throw new Error('Failed to fetch subscription')
      }

      const data: SubscriptionData = await response.json()
      setSubscription(data)
      return data
    } catch (error) {
      console.error('Error fetching subscription:', error)
    } finally {
      setLoading(false)
    }
  }

  // Poll subscription status after checkout success
  useEffect(() => {
    if (!checkoutSuccess) {
      // Initial load when not returning from checkout
      fetchSubscription()
      return
    }

    // Start polling after checkout success
    setPolling(true)
    let pollCount = 0
    const maxPolls = 15 // 15 polls * 2 seconds = 30 seconds max
    const pollInterval = 2000 // 2 seconds

    const poll = setInterval(async () => {
      pollCount++
      const data = await fetchSubscription()

      // Stop polling if subscription is active or max polls reached
      if (data?.hasActive) {
        clearInterval(poll)
        setPolling(false)
      } else if (pollCount >= maxPolls) {
        clearInterval(poll)
        setPolling(false)
        setPollTimeout(true)
      }
    }, pollInterval)

    // Initial fetch
    fetchSubscription()

    return () => clearInterval(poll)
  }, [checkoutSuccess])

  // Get status display text
  const getStatusText = () => {
    if (loading) return 'Loading...'
    if (checkoutSuccess && polling && !subscription?.hasActive) {
      return 'Activating...'
    }
    if (subscription?.hasActive) {
      return 'Active'
    }
    return 'Not subscribed'
  }

  // Get banner message
  const getBannerMessage = () => {
    if (!checkoutSuccess) return null

    if (subscription?.hasActive) {
      return '✅ Subscription activated'
    }

    if (pollTimeout) {
      return 'Checkout complete, but subscription has not synced yet. Please refresh in a minute.'
    }

    return 'Checkout complete — syncing subscription status…'
  }

  const bannerMessage = getBannerMessage()

  return (
    <div className="space-y-4">
      {/* Success banner */}
      {bannerMessage && (
        <Card className="bg-green-50 border-green-200">
          <div className="flex items-center justify-between">
            <p className="text-sm text-green-800">{bannerMessage}</p>
            {!polling && (
              <button
                onClick={() => window.history.replaceState({}, '', '/dashboard')}
                className="text-sm text-green-600 hover:text-green-800"
              >
                Dismiss
              </button>
            )}
          </div>
        </Card>
      )}

      {/* Subscription status card */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="mb-2">Subscription Status</h2>
            <p className="text-sm text-gray-600">{getStatusText()}</p>
            {subscription?.current_period_end && (
              <p className="mt-1 text-xs text-gray-500">
                Period ends: {new Date(subscription.current_period_end).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}

export default function SubscriptionStatus() {
  return (
    <Suspense fallback={<Card><p className="text-sm text-gray-600">Loading subscription status...</p></Card>}>
      <SubscriptionStatusContent />
    </Suspense>
  )
}
