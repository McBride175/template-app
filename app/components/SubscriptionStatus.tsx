/**
 * SubscriptionStatus Component
 * 
 * TEMPLATE CODE: Client component to poll and display subscription status.
 * Handles polling after checkout success to handle webhook delays.
 */
'use client'

import { useCallback, useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Card from './Card'
import SubscribeButton from './SubscribeButton'

export interface SubscriptionData {
  hasActive: boolean
  status: string | null
  current_period_end: string | null
  plan?: 'basic' | 'pro' | null
}

interface SubscriptionStatusProps {
  onStatusChange?: (payload: {
    subscription: SubscriptionData | null
    loading: boolean
  }) => void
}

function SubscriptionStatusContent({ onStatusChange }: SubscriptionStatusProps) {
  const searchParams = useSearchParams()
  const checkoutSuccess = searchParams.get('checkout') === 'success'
  const checkoutCancelled = searchParams.get('checkout') === 'cancelled'
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [polling, setPolling] = useState(false)
  const [pollTimeout, setPollTimeout] = useState(false)
  const [authInitializing, setAuthInitializing] = useState(true)

  // Fetch subscription status
  const fetchSubscription = useCallback(async () => {
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
      setAuthInitializing(false)
      onStatusChange?.({ subscription: data, loading: false })
      return data
    } catch (error) {
      console.error('Error fetching subscription:', error)
      setAuthInitializing(false)
      onStatusChange?.({ subscription: null, loading: false })
    } finally {
      setLoading(false)
    }
  }, [onStatusChange])

  // Poll subscription status after checkout success
  useEffect(() => {
    let isCancelled = false

    onStatusChange?.({ subscription: null, loading: true })

    if (!checkoutSuccess) {
      // Initial load when not returning from checkout
      fetchSubscription()
      return () => {
        isCancelled = true
      }
    }

    const runPolling = async () => {
      setPolling(true)

      const initial = await fetchSubscription()
      if (isCancelled || initial?.hasActive) {
        setPolling(false)
        return
      }

      let pollCount = 0
      const maxPolls = 8 // 8 polls * 3 seconds = 24 seconds max
      const pollInterval = 3000 // 3 seconds

      const poll = setInterval(async () => {
        pollCount++
        const data = await fetchSubscription()

        if (data?.hasActive) {
          clearInterval(poll)
          setPolling(false)
        } else if (pollCount >= maxPolls) {
          clearInterval(poll)
          setPolling(false)
          setPollTimeout(true)
        }
      }, pollInterval)

      return () => clearInterval(poll)
    }

    const cleanupPromise = runPolling()

    return () => {
      isCancelled = true
      cleanupPromise.then((cleanup) => cleanup?.())
    }
  }, [checkoutSuccess, fetchSubscription, onStatusChange])

  // Get status display text
  const getStatusText = () => {
    // Don't show "Not subscribed" while auth is still initializing to prevent flicker
    if (loading || authInitializing) return 'Loading...'
    if (checkoutSuccess && polling && !subscription?.hasActive) {
      return 'Activating...'
    }
    if (subscription?.hasActive) {
      const plan = subscription.plan
      return plan ? `Active — ${plan === 'pro' ? 'Pro' : 'Basic'}` : 'Active'
    }
    return 'Not subscribed'
  }

  const isSubscribed = subscription?.hasActive ||
    subscription?.status === 'active' ||
    subscription?.status === 'trialing'

  // Get banner message
  const getBannerState = () => {
    if (checkoutCancelled) {
      return {
        message: 'Checkout cancelled. No charge was made.',
        style: 'cancelled' as const,
      }
    }

    if (!checkoutSuccess) return null

    if (subscription?.hasActive) {
      return {
        message: '✅ Subscription activated',
        style: 'success' as const,
      }
    }

    if (pollTimeout) {
      return {
        message: 'Checkout complete, but subscription has not synced yet. Please refresh in a minute.',
        style: 'success' as const,
      }
    }

    return {
      message: 'Checkout complete — syncing subscription status…',
      style: 'success' as const,
    }
  }

  const banner = getBannerState()

  return (
    <div className="space-y-4">
      {/* Success banner */}
      {banner && (
        <Card
          className={
            banner.style === 'cancelled'
              ? 'bg-amber-50 border-amber-200'
              : 'bg-green-50 border-green-200'
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p
              className={
                banner.style === 'cancelled'
                  ? 'text-sm text-amber-800'
                  : 'text-sm text-green-800'
              }
            >
              {banner.message}
            </p>
            <div className="flex items-center gap-3">
              {banner.style === 'cancelled' && (
                <a
                  href="/pricing"
                  className="text-sm text-amber-700 underline underline-offset-2 hover:text-amber-900"
                >
                  Choose a plan
                </a>
              )}
              {!polling && (
                <button
                  onClick={() => window.history.replaceState({}, '', '/dashboard')}
                  className={
                    banner.style === 'cancelled'
                      ? 'text-sm text-amber-700 hover:text-amber-900'
                      : 'text-sm text-green-700 hover:text-green-800'
                  }
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Subscription status card */}
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="mb-2">Subscription</h2>
            <p className="text-sm text-gray-600">{getStatusText()}</p>
            {subscription?.current_period_end && (
              <p className="mt-1 text-xs text-gray-500">
                Period ends: {new Date(subscription.current_period_end).toLocaleDateString()}
              </p>
            )}
          </div>

          {!loading && !authInitializing && (
            isSubscribed ? (
              <span className="text-sm text-gray-500">Active</span>
            ) : (
              <SubscribeButton />
            )
          )}
        </div>
      </Card>
    </div>
  )
}

export default function SubscriptionStatus({ onStatusChange }: SubscriptionStatusProps) {
  return (
    <Suspense fallback={<Card><p className="text-sm text-gray-600">Loading subscription status...</p></Card>}>
      <SubscriptionStatusContent onStatusChange={onStatusChange} />
    </Suspense>
  )
}
