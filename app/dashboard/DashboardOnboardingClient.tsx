'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Button from '@/app/components/Button'
import Card from '@/app/components/Card'
import SubscriptionStatus from '@/app/components/SubscriptionStatus'
import CollectionActionsClient from '@/app/collections/actions/CollectionActionsClient'
import DashboardXeroConnectionCard from '@/app/dashboard/DashboardXeroConnectionCard'
import { buildLoginPath } from '@/lib/auth-flow'
import { supabase } from '@/lib/supabase'
import {
  fetchXeroConnectionStatus,
  resolveXeroAccountStatusView,
  XeroStatusRequestError,
  XERO_STATUS_UNAVAILABLE_MESSAGE,
  type XeroConnectionStatus,
} from '@/lib/xero/account-status'
import { triggerXeroAutoSyncOnEntry } from '@/lib/xero/auto-sync-client'
import {
  observeFirstXeroSyncCompletion,
  shouldObserveFirstXeroSync,
  type XeroFirstSyncFeedbackState,
} from '@/lib/xero/first-sync-feedback'
import { getXeroCallbackNotice } from '@/lib/xero/oauth-return'

function removeQueryParams(names: string[]) {
  const url = new URL(window.location.href)
  names.forEach((name) => url.searchParams.delete(name))
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}

export default function DashboardOnboardingClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tenantId = searchParams.get('tenantId')
  const xeroNotice = getXeroCallbackNotice(
    searchParams.get('xero'),
    searchParams.get('reason')
  )
  const [xeroStatus, setXeroStatus] = useState<XeroConnectionStatus | null>(null)
  const [xeroStatusError, setXeroStatusError] = useState<string | null>(null)
  const [xeroLoading, setXeroLoading] = useState(true)
  const [firstSyncFeedback, setFirstSyncFeedback] = useState<
    XeroFirstSyncFeedbackState | 'idle'
  >('idle')

  const loadXeroStatus = useCallback(async () => {
    setXeroLoading(true)
    setXeroStatusError(null)

    try {
      const status = await fetchXeroConnectionStatus(tenantId)
      setXeroStatus(status)
      return status
    } catch (error) {
      if (error instanceof XeroStatusRequestError && error.status === 401) {
        router.replace(buildLoginPath('/dashboard', 'session_expired'))
        return null
      }
      setXeroStatusError(XERO_STATUS_UNAVAILABLE_MESSAGE)
      return null
    } finally {
      setXeroLoading(false)
    }
  }, [router, tenantId])

  useEffect(() => {
    const controller = new AbortController()
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace(buildLoginPath('/dashboard', 'session_expired'))
    })

    const run = async () => {
      setFirstSyncFeedback('idle')
      const { data } = await supabase.auth.getUser()

      if (!data.user) {
        router.replace(buildLoginPath('/dashboard', 'session_expired'))
        return
      }

      const initialStatus = await loadXeroStatus()
      if (!initialStatus || controller.signal.aborted) return

      if (!initialStatus.connected || initialStatus.canSync === false) return

      if (!shouldObserveFirstXeroSync(initialStatus)) {
        void triggerXeroAutoSyncOnEntry({
          surface: 'dashboard',
          tenantId,
        })
        return
      }

      setFirstSyncFeedback('preparing')
      const autoSyncResult = await triggerXeroAutoSyncOnEntry({
        surface: 'dashboard',
        tenantId,
      })
      const feedback = await observeFirstXeroSyncCompletion({
        autoSyncResult,
        loadStatus: loadXeroStatus,
        signal: controller.signal,
      })
      if (!controller.signal.aborted) {
        setFirstSyncFeedback(feedback.state)
      }
    }

    void run()

    return () => {
      controller.abort()
      sub.subscription.unsubscribe()
    }
  }, [loadXeroStatus, router, tenantId])

  const xeroViewState = resolveXeroAccountStatusView({
    loading: xeroLoading,
    status: xeroStatus,
    statusError: xeroStatusError,
  })

  return (
    <div className="space-y-6">
      <SubscriptionStatus checkoutOnly loginNextPath="/dashboard" />

      {xeroNotice && (
        <Card
          className={
            xeroNotice.kind === 'success'
              ? 'border-green-200 bg-green-50'
              : 'border-amber-200 bg-amber-50'
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p
              className={
                xeroNotice.kind === 'success' ? 'text-sm text-green-800' : 'text-sm text-amber-800'
              }
            >
              {xeroNotice.message}
            </p>
            <button
              type="button"
              onClick={() => removeQueryParams(['xero', 'reason'])}
              className={
                xeroNotice.kind === 'success'
                  ? 'text-sm text-green-700 hover:text-green-900'
                  : 'text-sm text-amber-700 hover:text-amber-900'
              }
            >
              Dismiss
            </button>
          </div>
        </Card>
      )}

      {xeroViewState === 'loading' && (
        <Card>
          <p className="text-sm text-gray-600">Preparing your dashboard…</p>
        </Card>
      )}

      {xeroViewState === 'error' && (
        <Card>
          <div className="space-y-3">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">
                We couldn&apos;t check your Xero connection
              </h1>
              <p className="mt-2 text-sm text-gray-600">
                Your data has not been changed. Try checking the connection again.
              </p>
            </div>
            <Button onClick={() => void loadXeroStatus()} disabled={xeroLoading}>
              {xeroLoading ? 'Checking…' : 'Try again'}
            </Button>
          </div>
        </Card>
      )}

      {xeroViewState === 'disconnected' && (
        <DashboardXeroConnectionCard state="disconnected" />
      )}

      {xeroViewState === 'reconnect_required' && (
        <DashboardXeroConnectionCard
          state="reconnect_required"
          tenantId={xeroStatus?.tenantId ?? tenantId}
        />
      )}

      {(xeroViewState === 'connected' || xeroViewState === 'temporary_issue') &&
        firstSyncFeedback === 'preparing' && (
          <Card>
            <h1 className="text-xl font-semibold text-gray-900">
              Preparing your collection priorities
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              We&apos;re securely importing and validating your Xero data. This can take a few
              minutes.
            </p>
          </Card>
        )}

      {(xeroViewState === 'connected' || xeroViewState === 'temporary_issue') &&
        firstSyncFeedback === 'failed' && (
          <Card>
            <div className="space-y-3">
              <div>
                <h1 className="text-xl font-semibold text-gray-900">
                  We couldn&apos;t prepare your Xero data
                </h1>
                <p className="mt-2 text-sm text-gray-600">
                  Your connection is still available. Review it in Account, where you can retry
                  the sync or reconnect if Xero asks you to.
                </p>
              </div>
              <Button
                onClick={() =>
                  router.push(
                    `/account${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`
                  )
                }
              >
                Review Xero connection
              </Button>
            </div>
          </Card>
        )}

      {(xeroViewState === 'connected' || xeroViewState === 'temporary_issue') &&
        firstSyncFeedback !== 'preparing' &&
        firstSyncFeedback !== 'failed' && (
        <CollectionActionsClient embedded showTable={false} tenantId={tenantId} />
      )}
    </div>
  )
}
