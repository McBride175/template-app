import type { XeroConnectionStatus } from '@/lib/xero/account-status'
import type { XeroAutoSyncResult } from '@/lib/xero/auto-sync-client'

export type XeroFirstSyncFeedbackState =
  | 'ready'
  | 'preparing'
  | 'failed'
  | 'request_failed'
  | 'status_unavailable'
  | 'reconnect_required'
  | 'permission_upgrade_required'
  | 'cancelled'

export interface XeroFirstSyncFeedback {
  state: XeroFirstSyncFeedbackState
  status: XeroConnectionStatus | null
}

const POLL_DELAYS_MS = [1_000, 1_500, 2_000, 3_000, 5_000] as const

export function shouldObserveFirstXeroSync(status: XeroConnectionStatus) {
  return status.connected && status.lastSyncedAt === null
}

export function resolveXeroFirstSyncFeedback(params: {
  status: XeroConnectionStatus
}): XeroFirstSyncFeedbackState {
  const { status } = params

  if (
    status.syncState === 'permission_upgrade_required' ||
    status.grantClassification === 'permission_upgrade_required'
  ) {
    return 'permission_upgrade_required'
  }

  if (
    status.needsReauth ||
    status.authState === 'reauth_required' ||
    status.authState === 'error' ||
    status.syncState === 'reconnect_required' ||
    status.preparation?.failureKind === 'reconnect_required'
  ) {
    return 'reconnect_required'
  }

  if (status.preparation?.failureKind === 'permission_upgrade_required') {
    return 'permission_upgrade_required'
  }

  if (
    status.preparation?.stage === 'ready' ||
    (status.snapshot && typeof status.lastSyncedAt === 'string')
  ) {
    return 'ready'
  }

  if (
    status.preparation?.stage === 'failed' ||
    status.preparation?.stage === 'interrupted' ||
    status.latestSyncAttempt?.state === 'failed' ||
    status.latestSyncAttempt?.state === 'interrupted'
  ) {
    return 'failed'
  }

  return 'preparing'
}

function waitForNextCheck(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }

    const timeout = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = () => {
      window.clearTimeout(timeout)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function nextPollDelay(check: number) {
  return POLL_DELAYS_MS[Math.min(check, POLL_DELAYS_MS.length - 1)]
}

export async function observeFirstXeroSyncCompletion(params: {
  autoSyncResult: XeroAutoSyncResult | Promise<XeroAutoSyncResult>
  loadStatus: () => Promise<XeroConnectionStatus>
  signal: AbortSignal
  ignoreTerminalRunId?: string | null
  onObservation?: (feedback: XeroFirstSyncFeedback) => void
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>
}): Promise<XeroFirstSyncFeedback> {
  const wait = params.wait ?? waitForNextCheck
  const syncRequest: {
    result: XeroAutoSyncResult | null
    settled: boolean
  } = { result: null, settled: false }
  let idleChecksAfterRequestFailure = 0
  let lastStatus: XeroConnectionStatus | null = null
  let check = 0

  void Promise.resolve(params.autoSyncResult).then((result) => {
    syncRequest.result = result
    syncRequest.settled = true
  })

  while (!params.signal.aborted) {
    try {
      const status = await params.loadStatus()
      if (params.signal.aborted) return { state: 'cancelled', status }
      lastStatus = status

      const resolvedState = resolveXeroFirstSyncFeedback({ status })
      const isIgnoredTerminalRun =
        resolvedState === 'failed' &&
        typeof params.ignoreTerminalRunId === 'string' &&
        status.latestSyncAttempt?.runId === params.ignoreTerminalRunId
      const state = isIgnoredTerminalRun ? 'preparing' : resolvedState
      const observation = { state, status }
      params.onObservation?.(observation)
      if (state !== 'preparing') return observation

      const syncRequestResult = syncRequest.result
      if (syncRequest.settled && syncRequestResult) {
        if (syncRequestResult.reason === 'xero_reauth_required') {
          return { state: 'reconnect_required', status }
        }
        if (
          syncRequestResult.state === 'request_failed' ||
          syncRequestResult.syncSucceeded === false ||
          syncRequestResult.reason === 'auto_sync_cooldown_active' ||
          syncRequestResult.reason === 'xero_not_connected' ||
          isIgnoredTerminalRun
        ) {
          if (
            status.preparation?.active ||
            status.latestSyncAttempt?.state === 'running' ||
            syncRequestResult.reason === 'auto_sync_in_progress'
          ) {
            idleChecksAfterRequestFailure = 0
          } else {
            idleChecksAfterRequestFailure += 1
            if (idleChecksAfterRequestFailure >= 2) {
              return { state: 'request_failed', status }
            }
          }
        }
      }
    } catch {
      const observation = { state: 'status_unavailable' as const, status: lastStatus }
      params.onObservation?.(observation)
    }

    await wait(nextPollDelay(check), params.signal)
    check += 1
  }

  return { state: 'cancelled', status: lastStatus }
}
