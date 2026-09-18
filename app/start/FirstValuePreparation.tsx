'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/app/components/Button'
import {
  fetchXeroConnectionStatus,
  type XeroConnectionStatus,
} from '@/lib/xero/account-status'
import {
  triggerXeroAutoSyncOnEntry,
  type XeroAutoSyncResult,
} from '@/lib/xero/auto-sync-client'
import {
  observeFirstXeroSyncCompletion,
  resolveXeroFirstSyncFeedback,
  type XeroFirstSyncFeedbackState,
} from '@/lib/xero/first-sync-feedback'
import { buildXeroConnectPath } from '@/lib/xero/oauth-return'

const PROLONGED_PREPARATION_MS = 30_000

const JOINED_SYNC_RESULT: XeroAutoSyncResult = {
  state: 'completed',
  triggered: false,
  syncSucceeded: null,
  reason: 'auto_sync_in_progress',
  syncStatus: null,
}

const STAGES = [
  { key: 'connected', label: 'Connected to Xero' },
  { key: 'reading_xero', label: 'Reading your receivables' },
  { key: 'analysing_receivables', label: 'Analysing payment behaviour' },
  { key: 'building_priorities', label: 'Building your chase priorities' },
] as const

type Props = {
  tenantId: string
  initialStatus: XeroConnectionStatus
}

function stageIndex(status: XeroConnectionStatus) {
  const stage = status.preparation?.stage ?? 'connected'
  if (stage === 'ready') return STAGES.length
  const index = STAGES.findIndex((item) => item.key === stage)
  return index >= 0 ? index : 0
}

function preparationMessage(status: XeroConnectionStatus) {
  switch (status.preparation?.stage) {
    case 'reading_xero':
      return 'Yuohme is securely reading the receivables and payment history needed for your priorities.'
    case 'analysing_receivables':
      return 'Your Xero records are safely received. Yuohme is now comparing balances, due dates and payment behaviour.'
    case 'building_priorities':
      return 'The analysis is complete. Yuohme is validating and preparing your prioritised chase list.'
    default:
      return 'Your Xero connection is confirmed. Yuohme is starting the analysis automatically.'
  }
}

export default function FirstValuePreparation({ tenantId, initialStatus }: Props) {
  const router = useRouter()
  const statusRef = useRef(initialStatus)
  const [status, setStatus] = useState(initialStatus)
  const [feedback, setFeedback] = useState<XeroFirstSyncFeedbackState>(() =>
    resolveXeroFirstSyncFeedback({ status: initialStatus })
  )
  const [observedAt, setObservedAt] = useState(() => Date.now())
  const [observation, setObservation] = useState({ version: 0, retry: false })

  useEffect(() => {
    const controller = new AbortController()
    const seed = statusRef.current
    const initialFeedback = resolveXeroFirstSyncFeedback({ status: seed })
    const retry = observation.retry

    if (initialFeedback === 'ready') {
      router.replace(`/dashboard?tenantId=${encodeURIComponent(tenantId)}`)
      return () => controller.abort()
    }

    if (
      !retry &&
      (initialFeedback === 'failed' ||
        initialFeedback === 'reconnect_required' ||
        initialFeedback === 'permission_upgrade_required')
    ) {
      setFeedback(initialFeedback)
      return () => controller.abort()
    }

    setFeedback('preparing')
    const joiningActiveRun =
      seed.preparation?.active || seed.latestSyncAttempt?.state === 'running'
    const ignoredRunId = retry ? seed.latestSyncAttempt?.runId ?? null : null
    const autoSyncResult = joiningActiveRun
      ? Promise.resolve(JOINED_SYNC_RESULT)
      : triggerXeroAutoSyncOnEntry({
          surface: 'start',
          tenantId,
          retry,
        })

    void observeFirstXeroSyncCompletion({
      autoSyncResult,
      signal: controller.signal,
      ignoreTerminalRunId: ignoredRunId,
      async loadStatus() {
        return fetchXeroConnectionStatus(tenantId)
      },
      onObservation(observation) {
        if (controller.signal.aborted) return
        setObservedAt(Date.now())
        if (observation.status) {
          statusRef.current = observation.status
          setStatus(observation.status)
        }
        setFeedback(observation.state)
      },
    }).then((result) => {
      if (controller.signal.aborted) return
      if (result.status) {
        statusRef.current = result.status
        setStatus(result.status)
      }
      setFeedback(result.state)
      if (result.state === 'ready') {
        router.replace(`/dashboard?tenantId=${encodeURIComponent(tenantId)}`)
      }
    })

    return () => controller.abort()
  }, [observation, router, tenantId])

  const counts = status.preparation?.counts ?? null
  const currentStageIndex = stageIndex(status)
  const prolonged = useMemo(() => {
    if (!status.preparation?.active || !status.preparation.startedAt) return false
    const startedAt = Date.parse(status.preparation.startedAt)
    return Number.isFinite(startedAt) && observedAt - startedAt >= PROLONGED_PREPARATION_MS
  }, [observedAt, status.preparation])
  const reconnectPath = buildXeroConnectPath(
    `/start?tenantId=${encodeURIComponent(tenantId)}`
  )

  if (feedback === 'reconnect_required' || feedback === 'permission_upgrade_required') {
    const permissionUpgrade = feedback === 'permission_upgrade_required'
    return (
      <FocusedPreparationShell>
        <p className="text-sm font-semibold text-amber-700">Action needed</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-gray-900">
          {permissionUpgrade ? 'Update Xero access' : 'Reconnect Xero'}
        </h1>
        <p className="mt-4 text-gray-600">
          {permissionUpgrade
            ? 'Yuohme needs your approval for the current read-only Xero permissions before preparation can continue.'
            : 'Xero needs you to renew the connection before Yuohme can continue preparing your priorities.'}
        </p>
        <a
          href={reconnectPath}
          className="mt-7 inline-flex min-h-12 items-center justify-center rounded-xl bg-gray-900 px-6 py-3 text-sm font-semibold text-white hover:bg-gray-800"
        >
          {permissionUpgrade ? 'Update Xero access' : 'Reconnect Xero'}
        </a>
      </FocusedPreparationShell>
    )
  }

  if (feedback === 'failed' || feedback === 'request_failed') {
    const interrupted = status.preparation?.stage === 'interrupted'
    const providerFailure = status.preparation?.failureKind === 'provider_failure'
    return (
      <FocusedPreparationShell>
        <p className="text-sm font-semibold text-amber-700">Preparation paused</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-gray-900">
          {interrupted
            ? 'Yuohme needs to resume preparation'
            : providerFailure
              ? 'Xero could not provide the data this time'
              : 'Yuohme could not finish preparing your priorities'}
        </h1>
        <p className="mt-4 text-gray-600">
          Your existing Xero information has not been changed. Retry preparation to safely start a
          new fenced attempt for this organisation.
        </p>
        <Button
          className="mt-7 min-h-12 px-6"
          onClick={() =>
            setObservation((current) => ({ version: current.version + 1, retry: true }))
          }
        >
          Retry preparation
        </Button>
      </FocusedPreparationShell>
    )
  }

  return (
    <FocusedPreparationShell>
      <div className="flex items-center gap-2 text-sm font-semibold text-green-700">
        <span aria-hidden="true">✓</span>
        <span>
          Xero connected{status.tenantName ? ` — ${status.tenantName}` : ''}
        </span>
      </div>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-gray-900">
        Preparing your chase priorities
      </h1>
      <p className="mt-4 leading-relaxed text-gray-600" aria-live="polite">
        {preparationMessage(status)}
      </p>

      {counts && (
        <p className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          Found {counts.contacts.toLocaleString()} contacts, {counts.invoices.toLocaleString()}{' '}
          invoices and {counts.payments.toLocaleString()} payments.
        </p>
      )}

      <ol className="mt-7 space-y-3" aria-label="Preparation progress">
        {STAGES.map((item, index) => {
          const complete = index < currentStageIndex
          const current = index === currentStageIndex
          return (
            <li key={item.key} className="flex items-center gap-3 text-sm">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold ${
                  complete
                    ? 'border-green-600 bg-green-600 text-white'
                    : current
                      ? 'border-sky-700 bg-sky-50 text-sky-800'
                      : 'border-gray-300 bg-white text-gray-400'
                }`}
                aria-hidden="true"
              >
                {complete ? '✓' : current ? '•' : ''}
              </span>
              <span className={complete || current ? 'font-medium text-gray-900' : 'text-gray-500'}>
                {item.label}
              </span>
            </li>
          )
        })}
      </ol>

      {prolonged && (
        <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This is taking a little longer than usual, but the server still confirms Yuohme is
          working. No action is needed.
        </p>
      )}

      {feedback === 'status_unavailable' && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left">
          <p className="text-sm font-medium text-amber-900">We could not check the latest status.</p>
          <p className="mt-1 text-sm text-amber-800">
            Preparation may still be running. Yuohme will keep trying automatically.
          </p>
          <Button
            className="mt-3"
            variant="secondary"
            size="sm"
            onClick={() =>
              setObservation((current) => ({ version: current.version + 1, retry: false }))
            }
          >
            Try status again
          </Button>
        </div>
      )}

      <p className="mt-7 text-sm text-gray-500">
        You can leave and return to this page. Yuohme will check the saved server state when you
        come back.
      </p>
    </FocusedPreparationShell>
  )
}

function FocusedPreparationShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[calc(100vh-10rem)] py-8 sm:py-12">
      <section className="mx-auto w-full max-w-xl rounded-3xl border border-gray-200 bg-white p-7 shadow-sm sm:p-10">
        {children}
      </section>
    </div>
  )
}
