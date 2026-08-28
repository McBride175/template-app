'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Card from '@/app/components/Card'
import ManageSubscriptionButton from '@/app/components/ManageSubscriptionButton'
import ChangePasswordButton from '@/app/components/ChangePasswordButton'
import SubscriptionStatus from '@/app/components/SubscriptionStatus'
import Button from '@/app/components/Button'
import Input from '@/app/components/Input'
import { supabase } from '@/lib/supabase'
import { triggerXeroAutoSyncOnEntry } from '@/lib/xero/auto-sync-client'

interface SubscriptionData {
  hasActive: boolean
  status: string | null
  current_period_end: string | null
  hasCustomer: boolean
  plan?: 'basic' | 'pro' | null
}

interface ActionsEntitlement {
  plan: 'free' | 'paid'
  isPaid: boolean
  tenantId: string | null
  usageDaysConsumed: number
  usageDaysRemaining: number | null
  freeUsageDaysLimit: number
  hasActionsAccess: boolean
}

interface BillingEntitlementApiResponse {
  ok?: boolean
  entitlement?: ActionsEntitlement
  error?: string
}

interface XeroConnectionStatus {
  connected: boolean
  needsReauth?: boolean
  hasError?: boolean
  hasTemporaryIssue?: boolean
  syncState?: XeroSyncState
  syncMessage?: string | null
  canSync?: boolean
  canAccessInternalTools?: boolean
  authState?: 'active' | 'reauth_required' | 'disconnected' | 'error' | null
  reauthRequiredAt?: string | null
  tenantId: string | null
  tenantName: string | null
  lastSyncedAt: string | null
  connections: XeroConnectionSummary[]
  diagnostics?: {
    refreshIssueCode?: string | null
  } | null
}

type XeroSyncState =
  | 'active'
  | 'reconnect_required'
  | 'temporary_sync_issue'
  | 'sync_in_progress'
  | 'disconnected'

interface XeroConnectionSummary {
  tenantId: string
  tenantName: string | null
  authState: 'active' | 'reauth_required' | 'disconnected' | 'error'
  syncState: XeroSyncState
  syncMessage: string
  canSync: boolean
  needsReauth: boolean
  hasError: boolean
  hasTemporaryIssue?: boolean
  reauthRequiredAt: string | null
  updatedAt: string
}

function parseTenantId(value: string | null) {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

interface XeroSyncCounts {
  accounts: number
  contacts: number
  invoices: number
}

interface XeroCanonicalMapCounts {
  customers: number
  invoices: number
  payments: number
}

function formatXeroSyncStateLabel(syncState: XeroSyncState) {
  if (syncState === 'active') return 'Active'
  if (syncState === 'reconnect_required') return 'Reconnect required'
  if (syncState === 'temporary_sync_issue') return 'Temporary issue'
  if (syncState === 'sync_in_progress') return 'Sync in progress'
  return 'Disconnected'
}

export default function AccountPage() {
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null)
  const [billingEntitlement, setBillingEntitlement] = useState<ActionsEntitlement | null>(null)
  const [billingLoading, setBillingLoading] = useState(false)
  const [billingError, setBillingError] = useState<string | null>(null)
  const [xeroStatus, setXeroStatus] = useState<XeroConnectionStatus | null>(null)
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null)
  const [xeroResult, setXeroResult] = useState<string | null>(null)
  const [xeroLoading, setXeroLoading] = useState(false)
  const [xeroDisconnectLoading, setXeroDisconnectLoading] = useState(false)
  const [xeroSyncLoading, setXeroSyncLoading] = useState(false)
  const [xeroCanonicalMapLoading, setXeroCanonicalMapLoading] = useState(false)
  const [xeroSyncCounts, setXeroSyncCounts] = useState<XeroSyncCounts | null>(null)
  const [xeroCanonicalMapCounts, setXeroCanonicalMapCounts] = useState<XeroCanonicalMapCounts | null>(null)
  const [xeroLastSyncedAt, setXeroLastSyncedAt] = useState<string | null>(null)
  const [xeroError, setXeroError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleteInput, setDeleteInput] = useState('')
  const [deleteExpanded, setDeleteExpanded] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [exportLoading, setExportLoading] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportStatus, setExportStatus] = useState<string | null>(null)

  const loadBillingEntitlement = useCallback(async (tenantId: string | null) => {
    setBillingLoading(true)
    setBillingError(null)

    try {
      const params = new URLSearchParams()
      if (tenantId) {
        params.set('tenantId', tenantId)
      }
      const url =
        params.size > 0 ? `/api/billing/entitlement?${params.toString()}` : '/api/billing/entitlement'
      const response = await fetch(url, {
        cache: 'no-store',
        credentials: 'include',
      })

      if (response.status === 401) {
        router.replace('/login')
        return
      }

      const payload = (await response.json().catch(() => null)) as BillingEntitlementApiResponse | null

      if (!response.ok || !payload?.ok || !payload.entitlement) {
        throw new Error(payload?.error || 'Could not load billing status right now.')
      }

      setBillingEntitlement(payload.entitlement)
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : 'Could not load billing status right now.')
    } finally {
      setBillingLoading(false)
    }
  }, [router])

  const loadXeroStatus = useCallback(async (tenantId: string | null) => {
    setXeroLoading(true)
    try {
      const params = new URLSearchParams()
      if (tenantId) {
        params.set('tenantId', tenantId)
      }
      const url = params.size > 0 ? `/api/xero/status?${params.toString()}` : '/api/xero/status'

      const xeroResponse = await fetch(url, {
        cache: 'no-store',
        credentials: 'include',
      })
      if (xeroResponse.ok) {
        const xero = (await xeroResponse.json()) as XeroConnectionStatus
        setXeroStatus(xero)
        setXeroLastSyncedAt(xero.lastSyncedAt)
        setSelectedTenantId(xero.tenantId ?? null)
        setXeroError(null)
      } else {
        setXeroError('Could not load Xero status right now.')
      }
    } finally {
      setXeroLoading(false)
    }
  }, [])

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

        const initialTenantId = parseTenantId(
          typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('tenantId')
            : null
        )
        await Promise.all([
          loadXeroStatus(initialTenantId),
          loadBillingEntitlement(initialTenantId),
        ])
        triggerXeroAutoSyncOnEntry({
          surface: 'account',
          tenantId: initialTenantId,
        })
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [loadBillingEntitlement, loadXeroStatus, router])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const current = new URLSearchParams(window.location.search).get('xero')
    setXeroResult(current)
  }, [])

  const handleDeleteAccount = async () => {
    setDeleteError(null)

    if (deleteInput !== 'DELETE') return

    const confirmed = window.confirm(
      'This will permanently delete your account and data. Continue?'
    )
    if (!confirmed) return

    setDeleteLoading(true)
    try {
      const response = await fetch('/api/account/delete', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
      })

      if (!response.ok) {
        let message = 'Failed to delete account.'
        try {
          const payload = await response.json()
          if (typeof payload?.error === 'string') {
            message = payload.error
          }
        } catch {
          // ignore parse failures
        }
        throw new Error(message)
      }

      await supabase.auth.signOut()
      router.replace('/?accountDeleted=1')
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : 'Failed to delete account.'
      )
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleExportData = async () => {
    setExportError(null)
    setExportStatus(null)
    setExportLoading(true)

    try {
      const createResponse = await fetch('/api/privacy/export', {
        method: 'POST',
        credentials: 'include',
      })

      if (!createResponse.ok) {
        let message = 'Failed to create data export.'
        try {
          const payload = await createResponse.json()
          if (typeof payload?.error === 'string') {
            message = payload.error
          }
        } catch {
          // ignore parse failures
        }
        throw new Error(message)
      }

      const created = (await createResponse.json()) as { exportId?: string }
      if (!created.exportId) {
        throw new Error('Export ID was not returned.')
      }

      const signedResponse = await fetch(`/api/privacy/export/${created.exportId}`, {
        method: 'GET',
        credentials: 'include',
      })

      if (!signedResponse.ok) {
        let message = 'Failed to prepare export download.'
        try {
          const payload = await signedResponse.json()
          if (typeof payload?.error === 'string') {
            message = payload.error
          }
        } catch {
          // ignore parse failures
        }
        throw new Error(message)
      }

      const signed = (await signedResponse.json()) as { downloadUrl?: string }
      if (!signed.downloadUrl) {
        throw new Error('Download URL was not returned.')
      }

      setExportStatus('Your export is ready. Download starting…')
      window.location.assign(signed.downloadUrl)
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : 'Failed to export your data.'
      )
    } finally {
      setExportLoading(false)
    }
  }

  const handleXeroDisconnect = async () => {
    if (!selectedTenantId) {
      setXeroError('Select a Xero tenant first.')
      return
    }

    setXeroError(null)
    setXeroDisconnectLoading(true)
    try {
      const response = await fetch('/api/xero/disconnect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          tenantId: selectedTenantId,
          purgeData: false,
        }),
      })

      if (!response.ok) {
        let message = 'Failed to disconnect Xero.'
        try {
          const payload = await response.json()
          if (typeof payload?.error === 'string') {
            message = payload.error
          }
        } catch {
          // ignore parse failures
        }
        throw new Error(message)
      }

      await Promise.all([
        loadXeroStatus(selectedTenantId),
        loadBillingEntitlement(selectedTenantId),
      ])
      setXeroCanonicalMapCounts(null)
      setXeroResult('disconnected')
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search)
        params.set('xero', 'disconnected')
        params.set('tenantId', selectedTenantId)
        router.replace(`/account?${params.toString()}`)
      }
    } catch (error) {
      setXeroError(error instanceof Error ? error.message : 'Failed to disconnect Xero.')
    } finally {
      setXeroDisconnectLoading(false)
    }
  }

  const handleXeroSync = async () => {
    if (!selectedTenantId) {
      setXeroError('Select a Xero tenant first.')
      return
    }

    setXeroError(null)
    setXeroSyncLoading(true)
    setXeroSyncCounts(null)

    try {
      const response = await fetch('/api/xero/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          tenantId: selectedTenantId,
        }),
      })

      if (!response.ok) {
        let message = 'Failed to sync Xero data.'
        try {
          const payload = await response.json()
          if (typeof payload?.error === 'string') {
            message = payload.error
          }
        } catch {
          // ignore parse failures
        }
        throw new Error(message)
      }

      const payload = (await response.json()) as {
        counts?: XeroSyncCounts
        syncedAt?: string
      }

      if (payload.counts) {
        setXeroSyncCounts(payload.counts)
      }
      if (payload.syncedAt) {
        setXeroLastSyncedAt(payload.syncedAt)
      }
      await loadXeroStatus(selectedTenantId)
    } catch (error) {
      setXeroError(error instanceof Error ? error.message : 'Failed to sync Xero data.')
    } finally {
      setXeroSyncLoading(false)
    }
  }

  const handleXeroMapCanonical = async () => {
    if (!selectedTenantId) {
      setXeroError('Select a Xero tenant first.')
      return
    }

    setXeroError(null)
    setXeroCanonicalMapLoading(true)
    setXeroCanonicalMapCounts(null)

    try {
      const response = await fetch('/api/xero/map-canonical', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          tenantId: selectedTenantId,
        }),
      })

      if (!response.ok) {
        let message = 'Failed to map canonical data.'
        try {
          const payload = await response.json()
          if (typeof payload?.error === 'string') {
            message = payload.error
          }
        } catch {
          // ignore parse failures
        }
        throw new Error(message)
      }

      const payload = (await response.json()) as {
        mapped?: XeroCanonicalMapCounts
      }

      if (payload.mapped) {
        setXeroCanonicalMapCounts(payload.mapped)
      }
    } catch (error) {
      setXeroError(error instanceof Error ? error.message : 'Failed to map canonical data.')
    } finally {
      setXeroCanonicalMapLoading(false)
    }
  }

  const handleTenantSelection = async (tenantId: string) => {
    setSelectedTenantId(tenantId)
    setXeroSyncCounts(null)
    setXeroCanonicalMapCounts(null)
    setXeroError(null)
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      params.set('tenantId', tenantId)
      router.replace(`/account?${params.toString()}`)
    }
    await Promise.all([
      loadXeroStatus(tenantId),
      loadBillingEntitlement(tenantId),
    ])
  }

  if (loading) return null

  const xeroConnectedMessage =
    xeroResult === 'connected' ? 'Xero organisation connected successfully.' : null
  const xeroDisconnectedMessage =
    xeroResult === 'disconnected' ? 'Xero organisation disconnected successfully.' : null
  const xeroNeedsReauth = Boolean(xeroStatus?.needsReauth)
  const xeroHasError = Boolean(xeroStatus?.hasError)
  const xeroSyncState = xeroStatus?.syncState ?? 'disconnected'
  const xeroAuthState = xeroStatus?.authState ?? 'disconnected'
  const xeroAuthStateLabel = formatXeroSyncStateLabel(xeroSyncState)
  const xeroStatusClass =
    xeroSyncState === 'reconnect_required' ||
    xeroSyncState === 'temporary_sync_issue' ||
    xeroSyncState === 'sync_in_progress' ||
    xeroAuthState === 'error'
      ? 'text-amber-700'
      : xeroSyncState === 'active'
        ? 'text-green-700'
        : 'text-gray-700'
  const xeroOrganisationName = xeroStatus?.tenantName?.trim() || null
  const xeroConnectionSummary =
    xeroAuthState === 'active' && xeroOrganisationName
      ? `Connected to ${xeroOrganisationName}`
      : xeroOrganisationName
        ? `Organisation: ${xeroOrganisationName}`
        : 'No organisation selected'
  const xeroLastSyncedLabel = xeroLastSyncedAt
    ? new Date(xeroLastSyncedAt).toLocaleString()
    : 'Not yet synced'
  const xeroStatusMessage =
    typeof xeroStatus?.syncMessage === 'string' ? xeroStatus.syncMessage : null
  const xeroCanAccessInternalTools = Boolean(xeroStatus?.canAccessInternalTools)
  const xeroSyncAvailable = Boolean(selectedTenantId) && (xeroStatus?.canSync ?? true)
  const xeroActionsBusy = xeroSyncLoading || xeroCanonicalMapLoading || xeroDisconnectLoading
  const xeroConnectLabel = xeroNeedsReauth || xeroHasError ? 'Reconnect' : 'Connect Xero'
  const xeroReconnectLabel = xeroNeedsReauth || xeroHasError ? 'Reconnect' : 'Refresh connection'
  const tenantQuery = selectedTenantId ? `?tenantId=${encodeURIComponent(selectedTenantId)}` : ''
  const dashboardHref = selectedTenantId
    ? `/dashboard?tenantId=${encodeURIComponent(selectedTenantId)}#collection-actions`
    : '/dashboard#collection-actions'
  const billingPlanLabel = billingEntitlement?.isPaid ? 'Paid' : 'Free'

  return (
    <div className="space-y-8">
      <div>
        <h1>Account</h1>
        <p className="mt-2 text-sm text-gray-600">Manage your account details</p>
      </div>

      <SubscriptionStatus />

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h2>Billing</h2>
            {billingLoading && <p className="text-sm text-gray-600">Loading billing status…</p>}
            {!billingLoading && billingEntitlement && (
              <div className="space-y-1 text-sm text-gray-700">
                <p>
                  Plan: <span className="font-medium text-gray-900">{billingPlanLabel}</span>
                </p>
                {billingEntitlement.isPaid ? (
                  <p>
                    Collection days: <span className="font-medium text-gray-900">Unlimited</span>
                  </p>
                ) : (
                  <>
                    <p>
                      Collection days used:{' '}
                      <span className="font-medium text-gray-900">
                        {billingEntitlement.usageDaysConsumed} / {billingEntitlement.freeUsageDaysLimit}
                      </span>
                    </p>
                    <p>
                      Days remaining:{' '}
                      <span className="font-medium text-gray-900">
                        {billingEntitlement.usageDaysRemaining ?? 0}
                      </span>
                    </p>
                  </>
                )}
              </div>
            )}
            {billingError && <p className="text-sm text-red-600">{billingError}</p>}
          </div>
          {!billingLoading && billingEntitlement && (
            billingEntitlement.isPaid ? (
              <ManageSubscriptionButton />
            ) : (
              <Button
                onClick={() => router.push('/pricing')}
                variant="primary"
                size="md"
                className="w-72"
              >
                Upgrade
              </Button>
            )
          )}
        </div>
      </Card>

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
                size="md"
                className="w-72"
              >
                Choose a plan
              </Button>
            )}
            <ChangePasswordButton email={email ?? ''} />
          </div>
        </div>
      </Card>

      <Card>
        <div className="space-y-4">
          <h2 className="mb-1">Xero</h2>
          {xeroConnectedMessage && (
            <p className="text-sm text-green-700">{xeroConnectedMessage}</p>
          )}
          {xeroDisconnectedMessage && (
            <p className="text-sm text-green-700">{xeroDisconnectedMessage}</p>
          )}

          {xeroLoading && <p className="text-sm text-gray-600">Loading Xero status…</p>}

          {!xeroLoading && (
            <div className="space-y-1 rounded-md border border-gray-200 bg-gray-50 px-3 py-3">
              <p className="text-sm text-gray-700">{xeroConnectionSummary}</p>
              <p className={`text-sm ${xeroStatusClass}`}>
                Status: <span className="font-medium">{xeroAuthStateLabel}</span>
              </p>
              {xeroStatusMessage && <p className="text-sm text-gray-600">{xeroStatusMessage}</p>}
              <p className="text-sm text-gray-600">Last synced: {xeroLastSyncedLabel}</p>
            </div>
          )}

          {!xeroLoading && xeroStatus && xeroStatus.connections.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm text-gray-700" htmlFor="xero-tenant-select">
                Organisation
              </label>
              <select
                id="xero-tenant-select"
                value={selectedTenantId ?? ''}
                onChange={(event) => void handleTenantSelection(event.target.value)}
                className="w-full max-w-xl rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
              >
                {xeroStatus.connections.map((connection) => (
                  <option key={connection.tenantId} value={connection.tenantId}>
                    {(connection.tenantName?.trim() || connection.tenantId) +
                      ` (${formatXeroSyncStateLabel(connection.syncState)})`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!xeroLoading && !xeroStatus?.connected && (
            <div className="space-y-3">
              <p className="text-sm text-gray-700">
                {xeroNeedsReauth
                  ? 'Reconnect to continue automatic sync.'
                  : xeroHasError
                    ? 'Reconnect to restore automatic sync.'
                    : 'Connect Xero to start syncing data.'}
              </p>
              <a
                href="/api/xero/connect"
                className="inline-flex items-center justify-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 active:bg-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
              >
                {xeroConnectLabel}
              </a>
            </div>
          )}

          {!xeroLoading && xeroStatus?.connected && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Sync runs automatically in the background. Use manual controls only when you need
                an immediate refresh.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/customers${tenantQuery}`}
                  className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
                >
                  View customer collections summary
                </Link>
                <Link
                  href={dashboardHref}
                  className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
                >
                  View collection actions on dashboard
                </Link>
              </div>
              <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Manual override
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={handleXeroSync}
                    variant="secondary"
                    size="md"
                    disabled={xeroActionsBusy || !xeroSyncAvailable}
                  >
                    {xeroSyncLoading ? 'Syncing now…' : 'Sync now'}
                  </Button>
                  <a
                    href="/api/xero/connect"
                    className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
                  >
                    {xeroReconnectLabel}
                  </a>
                  <Button
                    onClick={handleXeroDisconnect}
                    variant="ghost"
                    size="sm"
                    disabled={xeroActionsBusy}
                  >
                    {xeroDisconnectLoading ? 'Disconnecting…' : 'Disconnect Xero'}
                  </Button>
                </div>
                {!xeroSyncAvailable && (
                  <p className="text-xs text-gray-600">
                    Sync now is unavailable until this connection is ready.
                  </p>
                )}
              </div>
              {xeroCanAccessInternalTools && (
                <details className="space-y-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-3">
                  <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-gray-500">
                    Internal tools
                  </summary>
                  <p className="text-sm text-gray-600">
                    Use these controls only for operational troubleshooting.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      onClick={handleXeroMapCanonical}
                      variant="secondary"
                      size="md"
                      disabled={xeroActionsBusy || !selectedTenantId}
                    >
                      {xeroCanonicalMapLoading ? 'Refreshing mapped data…' : 'Refresh mapped data'}
                    </Button>
                  </div>
                  {xeroCanonicalMapCounts && (
                    <p className="text-sm text-green-700">
                      Canonical mapped Customers: {xeroCanonicalMapCounts.customers}, Invoices:{' '}
                      {xeroCanonicalMapCounts.invoices}, Payments: {xeroCanonicalMapCounts.payments}
                    </p>
                  )}
                </details>
              )}
              {xeroCanAccessInternalTools && xeroStatus?.diagnostics?.refreshIssueCode && (
                <p className="text-xs text-gray-500">
                  Internal diagnostic code: {xeroStatus.diagnostics.refreshIssueCode}
                </p>
              )}
              {xeroSyncCounts && (
                <p className="text-sm text-green-700">
                  Synced Accounts: {xeroSyncCounts.accounts}, Contacts: {xeroSyncCounts.contacts},
                  {' '}Invoices: {xeroSyncCounts.invoices}
                </p>
              )}
            </div>
          )}

          {xeroError && <p className="text-sm text-red-600">{xeroError}</p>}
        </div>
      </Card>

      <Card>
        <div className="space-y-4">
          <div className="space-y-2">
            <Button
              onClick={handleExportData}
              variant="secondary"
              size="md"
              disabled={exportLoading}
              className="self-start"
            >
              {exportLoading ? 'Preparing export…' : 'Export my data'}
            </Button>
            {exportStatus && <p className="text-sm text-green-700">{exportStatus}</p>}
            {exportError && (
              <div className="space-y-2">
                <p className="text-sm text-red-600">{exportError}</p>
                <p className="text-sm text-gray-600">
                  If this keeps happening, contact support and include the time of this attempt.
                </p>
                <Link
                  href="/contact"
                  className="inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                >
                  Contact support
                </Link>
              </div>
            )}
          </div>

          <div className="border-t border-gray-200" />

          {!deleteExpanded ? (
            <Button
              onClick={() => {
                setDeleteError(null)
                setDeleteExpanded(true)
              }}
              variant="primary"
              size="md"
              className="self-start bg-red-600 text-white hover:bg-red-700 active:bg-red-800 focus-visible:ring-red-700"
            >
              Delete account and all data
            </Button>
          ) : (
            <>
              <p className="text-sm text-gray-600">
                This permanently deletes your account and associated data.
              </p>

              <div className="space-y-2">
                <label htmlFor="delete-confirm" className="text-sm text-gray-700">
                  Type DELETE to confirm
                </label>
                <Input
                  id="delete-confirm"
                  value={deleteInput}
                  onChange={(e) => setDeleteInput(e.target.value)}
                  placeholder="DELETE"
                  autoComplete="off"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handleDeleteAccount}
                  variant="ghost"
                  size="md"
                  disabled={deleteInput !== 'DELETE' || deleteLoading}
                  className="text-red-600 hover:bg-red-50 hover:text-red-700 focus-visible:ring-red-700"
                >
                  {deleteLoading ? 'Deleting…' : 'Confirm delete'}
                </Button>
                <Button
                  onClick={() => {
                    setDeleteExpanded(false)
                    setDeleteInput('')
                    setDeleteError(null)
                  }}
                  variant="secondary"
                  size="md"
                  disabled={deleteLoading}
                >
                  Cancel
                </Button>
              </div>
            </>
          )}

          {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}
        </div>
      </Card>
    </div>
  )
}
