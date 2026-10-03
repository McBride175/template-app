'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Button from '@/app/components/ui/Button'
import Card from '@/app/components/ui/Card'
import SubscriptionStatus from '@/app/components/SubscriptionStatus'
import CollectionActionsClient, { type CollectionActionsApiResponse } from '@/app/collections/actions/CollectionActionsClient'
import DashboardXeroConnectionCard from '@/app/dashboard/DashboardXeroConnectionCard'
import { buildLoginPath } from '@/lib/auth-flow'
import { supabase } from '@/lib/supabase'
import {
  resolveXeroAccountStatusView,
  XERO_STATUS_UNAVAILABLE_MESSAGE,
  type XeroConnectionStatus,
} from '@/lib/xero/account-status'
import { triggerXeroAutoSyncOnEntry } from '@/lib/xero/auto-sync-client'
import { shouldObserveFirstXeroSync } from '@/lib/xero/first-sync-feedback'
import { getXeroCallbackNotice } from '@/lib/xero/oauth-return'
import { fetchDashboardBootstrap, fetchDashboardReadiness, DashboardRequestError, dashboardResponseStamp,
  shouldApplyDashboardResponse, type DashboardBootstrapPayload } from '@/lib/dashboard/bootstrap-client'
import type { QueueResponseStamp } from '@/lib/collections/queue-response-order'

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

  const [bootstrap, setBootstrap] = useState<DashboardBootstrapPayload | null>(null)
  const requestSequence = useRef(0)
  const latestStamp = useRef<QueueResponseStamp | null>(null)
  const activeTenant = useRef(tenantId)
  activeTenant.current = tenantId
  const loadDashboard = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++requestSequence.current
    const requestedTenant = tenantId
    setXeroStatusError(null)
    try {
      const payload = await fetchDashboardBootstrap(requestedTenant, signal)
      if (signal?.aborted || activeTenant.current !== requestedTenant) return null
      const stamp = dashboardResponseStamp(payload, sequence)
      if (!shouldApplyDashboardResponse(latestStamp.current, stamp)) return null
      latestStamp.current = stamp
      setBootstrap(payload)
      setXeroStatus(payload.status)
      setXeroStatusError(payload.statusError)
      return payload
    } catch (error) {
      if (signal?.aborted || sequence !== requestSequence.current) return null
      if (error instanceof DashboardRequestError && error.status === 401) {
        router.replace(buildLoginPath('/dashboard', 'session_expired'))
        return null
      }
      setXeroStatusError(XERO_STATUS_UNAVAILABLE_MESSAGE)
      return null
    } finally {
      if (!signal?.aborted && sequence === requestSequence.current) setXeroLoading(false)
    }
  }, [router, tenantId])
  const refreshCollection = useCallback(async () => {
    const result = await loadDashboard()
    return result?.collection as CollectionActionsApiResponse | null
  }, [loadDashboard])
  const observeProjectionVersion = useCallback((stamp: QueueResponseStamp) => {
    if (latestStamp.current?.tenantId === stamp.tenantId &&
      shouldApplyDashboardResponse(latestStamp.current, { ...stamp, requestSequence: requestSequence.current })) {
      latestStamp.current = { ...stamp, requestSequence: requestSequence.current }
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController(), sequences = requestSequence
    latestStamp.current = null
    setBootstrap(null); setXeroStatus(null); setXeroLoading(true)
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace(buildLoginPath('/dashboard', 'session_expired'))
    })
    const run = async () => {
      const initial = await loadDashboard(controller.signal)
      const initialStatus = initial?.status
      if (!initialStatus || controller.signal.aborted) return
      if (!initialStatus.connected || initialStatus.canSync === false) return
      if (initial?.collectionState === 'onboarding' && shouldObserveFirstXeroSync(initialStatus)) {
        const preparationTenantId = initialStatus.tenantId ?? tenantId
        router.replace(preparationTenantId ? `/start?tenantId=${encodeURIComponent(preparationTenantId)}` : '/start')
        return
      }
      // The bootstrap has already rendered current data. Preserve the existing
      // guarded entry refresh policy and observe completion without blocking UI.
      void triggerXeroAutoSyncOnEntry({ surface: 'dashboard', tenantId }).then(result => {
        if (!controller.signal.aborted && (result.triggered || result.reason === 'auto_sync_in_progress' || result.state === 'request_failed')) {
          void loadDashboard(controller.signal)
        }
      })
    }
    void run()
    const onVisible = () => { if (document.visibilityState === 'visible') void loadDashboard(controller.signal) }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      controller.abort(); sequences.current++
      document.removeEventListener('visibilitychange', onVisible)
      sub.subscription.unsubscribe()
    }
  }, [loadDashboard, router, tenantId])

  useEffect(() => {
    if (xeroStatus?.latestSyncAttempt?.state !== 'running') return
    const controller = new AbortController(), observedTenant = xeroStatus.tenantId ?? tenantId
    const expiresAt = Date.now() + 5 * 60 * 1000
    let timer: ReturnType<typeof setTimeout>
    const observe = async () => {
      try {
        const next = await fetchDashboardReadiness(observedTenant, controller.signal)
        if (controller.signal.aborted) return
        const held = latestStamp.current
        const changed = next.version && (held?.accountingGenerationId !== next.version.accountingGenerationId ||
          held?.financialEpoch !== next.version.financialEpoch || held?.projectionRevision !== next.version.projectionRevision)
        if (changed || next.status?.latestSyncAttempt?.state !== 'running') {
          await loadDashboard(controller.signal)
          return
        }
        if (Date.now() < expiresAt) timer = setTimeout(() => void observe(), 5000)
      } catch { /* Keep valid existing content; visibility/manual refresh can retry. */ }
    }
    timer = setTimeout(() => void observe(), 5000)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [xeroStatus?.latestSyncAttempt?.runId, xeroStatus?.latestSyncAttempt?.state, xeroStatus?.tenantId, loadDashboard, tenantId])

  const xeroViewState = resolveXeroAccountStatusView({
    loading: xeroLoading,
    status: xeroStatus,
    statusError: xeroStatusError,
  })
  const firstValuePreparationRequired = Boolean(
    bootstrap?.collectionState === 'onboarding' && xeroStatus && shouldObserveFirstXeroSync(xeroStatus)
  )

  return (
    <div className="space-y-6">
      {!firstValuePreparationRequired && (
        <SubscriptionStatus checkoutOnly loginNextPath="/dashboard" />
      )}

      {firstValuePreparationRequired && (
        <Card>
          <p className="text-sm text-gray-600">Returning to your Xero preparation…</p>
        </Card>
      )}

      {!firstValuePreparationRequired && xeroNotice && (
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

      {!firstValuePreparationRequired && xeroViewState === 'loading' && (
        <Card>
          <p className="text-sm text-gray-600">Preparing your dashboard…</p>
        </Card>
      )}

      {!firstValuePreparationRequired && xeroViewState === 'error' && (
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
            <Button onClick={() => void loadDashboard()} disabled={xeroLoading}>
              {xeroLoading ? 'Checking…' : 'Try again'}
            </Button>
          </div>
        </Card>
      )}

      {!firstValuePreparationRequired && xeroViewState === 'disconnected' && (
        <DashboardXeroConnectionCard state="disconnected" />
      )}

      {!firstValuePreparationRequired && xeroViewState === 'reconnect_required' && (
        <DashboardXeroConnectionCard
          state="reconnect_required"
          tenantId={xeroStatus?.tenantId ?? tenantId}
        />
      )}

      {!firstValuePreparationRequired &&
        (bootstrap?.collectionState === 'ready' || bootstrap?.collectionState === 'blocked' ||
          xeroViewState === 'connected' || xeroViewState === 'temporary_issue') && (
        <CollectionActionsClient embedded showTable={false} tenantId={tenantId}
          dashboardData={bootstrap?.collection as CollectionActionsApiResponse | null}
          dashboardState={bootstrap?.collectionState ?? 'loading'}
          dashboardRefresh={refreshCollection} onProjectionVersion={observeProjectionVersion} />
      )}
    </div>
  )
}
