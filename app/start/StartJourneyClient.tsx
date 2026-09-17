'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/app/components/Button'
import { fetchXeroConnectionStatus } from '@/lib/xero/account-status'
import { buildXeroConnectPath, getXeroCallbackNotice } from '@/lib/xero/oauth-return'
import {
  resolveStartJourney,
  type StartJourneyDecision,
} from '@/lib/xero/start-journey'

type Props = {
  requestedTenantId: string | null
  xeroResult: string | null
  xeroReason: string | null
}

export default function StartJourneyClient({
  requestedTenantId,
  xeroResult,
  xeroReason,
}: Props) {
  const router = useRouter()
  const [decision, setDecision] = useState<StartJourneyDecision | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [selectingTenantId, setSelectingTenantId] = useState<string | null>(null)
  const callbackNotice = useMemo(
    () => getXeroCallbackNotice(xeroResult, xeroReason),
    [xeroReason, xeroResult]
  )

  useEffect(() => {
    let active = true
    setStatusError(null)

    fetchXeroConnectionStatus(requestedTenantId)
      .then((status) => {
        if (active) setDecision(resolveStartJourney(status, requestedTenantId))
      })
      .catch(() => {
        if (active) setStatusError('We could not check your Xero connection. Try again.')
      })

    return () => {
      active = false
    }
  }, [requestedTenantId])

  useEffect(() => {
    if (!decision) return

    if (decision.kind === 'continue') {
      router.replace(`/dashboard?tenantId=${encodeURIComponent(decision.tenantId)}`)
      return
    }

    if (decision.kind === 'connect' && xeroResult !== 'error') {
      window.location.replace(buildXeroConnectPath('/start'))
    }
  }, [decision, router, xeroResult])

  const selectOrganisation = async (tenantId: string) => {
    setSelectionError(null)
    setSelectingTenantId(tenantId)
    try {
      const response = await fetch('/api/xero/select-organisation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        credentials: 'include',
        body: JSON.stringify({ tenantId }),
      })
      const payload = (await response.json().catch(() => null)) as { next?: unknown } | null
      if (!response.ok || typeof payload?.next !== 'string') {
        setSelectionError('That organisation is not available. Choose one of your connected organisations.')
        return
      }
      router.replace(payload.next)
    } catch {
      setSelectionError('We could not select that organisation. Try again.')
    } finally {
      setSelectingTenantId(null)
    }
  }

  const connectPath = buildXeroConnectPath(
    decision && 'tenantId' in decision && decision.tenantId
      ? `/start?tenantId=${encodeURIComponent(decision.tenantId)}`
      : '/start'
  )

  if (statusError) {
    return <FocusedState title="We could not check Xero" message={statusError} actionLabel="Try again" onAction={() => window.location.reload()} />
  }

  if (!decision || decision.kind === 'continue') {
    return <FocusedState title="Preparing your next step" message="Checking your secure Xero connection…" />
  }

  if (decision.kind === 'connect') {
    const isRecovery = xeroResult === 'error'
    return (
      <FocusedState
        title={isRecovery ? 'Connect Xero to continue' : 'Taking you to Xero'}
        message={
          callbackNotice?.message ??
          'Yuohme uses read-only Xero access to analyse receivables and prepare your chase priorities.'
        }
        actionLabel={isRecovery ? 'Try Xero again' : undefined}
        actionHref={isRecovery ? connectPath : undefined}
      />
    )
  }

  if (decision.kind === 'reconnect' || decision.kind === 'permission_upgrade') {
    return (
      <FocusedState
        title={decision.kind === 'permission_upgrade' ? 'Update Xero access' : 'Reconnect Xero'}
        message={
          decision.kind === 'permission_upgrade'
            ? 'Yuohme needs your approval for the current read-only Xero permissions before it can continue.'
            : 'Your Xero connection needs to be renewed before Yuohme can continue.'
        }
        actionLabel={decision.kind === 'permission_upgrade' ? 'Update Xero access' : 'Reconnect Xero'}
        actionHref={connectPath}
      />
    )
  }

  if (decision.kind === 'invalid_selection') {
    return (
      <FocusedState
        title="Choose a connected organisation"
        message="That organisation is not connected to your Yuohme account. Return to the available organisations and choose again."
        actionLabel="Choose organisation"
        actionHref="/start"
      />
    )
  }

  return (
    <div className="min-h-[calc(100vh-10rem)] py-8 sm:py-12">
      <section className="mx-auto w-full max-w-xl rounded-3xl border border-gray-200 bg-white p-6 shadow-sm sm:p-9">
        <p className="text-sm font-semibold uppercase tracking-wide text-gray-500">One choice needed</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-gray-900">
          Which Xero organisation should Yuohme analyse?
        </h1>
        <p className="mt-4 leading-relaxed text-gray-600">
          Xero authorised more than one organisation in this connection. Choose the one whose receivables you want to prioritise.
        </p>
        {selectionError && <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{selectionError}</p>}
        <div className="mt-7 space-y-3">
          {decision.connections.map((connection) => (
            <button
              key={connection.tenantId}
              type="button"
              className="flex min-h-16 w-full items-center justify-between rounded-2xl border border-gray-300 px-5 py-3 text-left transition hover:border-gray-900 hover:bg-gray-50 disabled:opacity-60"
              disabled={selectingTenantId !== null}
              onClick={() => void selectOrganisation(connection.tenantId)}
            >
              <span>
                <span className="block font-semibold text-gray-900">
                  {connection.tenantName || 'Xero organisation'}
                </span>
                <span className="mt-1 block text-sm text-gray-500">Connected and ready</span>
              </span>
              <span className="text-sm font-medium text-gray-700">
                {selectingTenantId === connection.tenantId ? 'Selecting…' : 'Choose'}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function FocusedState({
  title,
  message,
  actionLabel,
  actionHref,
  onAction,
}: {
  title: string
  message: string
  actionLabel?: string
  actionHref?: string
  onAction?: () => void
}) {
  return (
    <div className="min-h-[calc(100vh-10rem)] py-8 sm:py-12">
      <section className="mx-auto w-full max-w-xl rounded-3xl border border-gray-200 bg-white p-7 text-center shadow-sm sm:p-10">
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900">{title}</h1>
        <p className="mt-4 leading-relaxed text-gray-600">{message}</p>
        {actionLabel && actionHref && (
          <a href={actionHref} className="mt-7 inline-flex min-h-12 items-center justify-center rounded-xl bg-gray-900 px-6 py-3 text-sm font-semibold text-white hover:bg-gray-800">
            {actionLabel}
          </a>
        )}
        {actionLabel && onAction && (
          <Button className="mt-7 min-h-12 rounded-xl px-6" onClick={onAction}>
            {actionLabel}
          </Button>
        )}
      </section>
    </div>
  )
}
