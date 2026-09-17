import type { XeroConnectionStatus } from '@/lib/xero/account-status'
import type { XeroAutoSyncResult } from '@/lib/xero/auto-sync-client'

export type XeroFirstSyncFeedbackState =
  | 'ready'
  | 'preparing'
  | 'failed'
  | 'reconnect_required'
  | 'permission_upgrade_required'
  | 'cancelled'

export interface XeroFirstSyncFeedback {
  state: XeroFirstSyncFeedbackState
  status: XeroConnectionStatus | null
}

const DEFAULT_POLL_INTERVAL_MS = 5_000
const DEFAULT_MAX_STATUS_CHECKS = 48

export function shouldObserveFirstXeroSync(status: XeroConnectionStatus) {
  return (
    status.connected &&
    status.snapshot?.mode === 'legacy' &&
    status.snapshot.syncRunId === null &&
    status.lastSyncedAt === null
  )
}

export function resolveXeroFirstSyncFeedback(params: {
  status: XeroConnectionStatus
  autoSyncResult: XeroAutoSyncResult
}): XeroFirstSyncFeedbackState {
  const { status, autoSyncResult } = params

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
    status.syncState === 'reconnect_required'
  ) {
    return 'reconnect_required'
  }

  if (
    status.snapshot?.mode === 'generation' &&
    typeof status.snapshot.syncRunId === 'string' &&
    typeof status.lastSyncedAt === 'string'
  ) {
    return 'ready'
  }

  if (
    status.latestSyncAttempt?.state === 'failed' ||
    status.latestSyncAttempt?.state === 'interrupted'
  ) {
    return 'failed'
  }

  if (
    status.latestSyncAttempt?.state === 'running' ||
    status.syncState === 'sync_in_progress' ||
    autoSyncResult.reason === 'auto_sync_in_progress'
  ) {
    return 'preparing'
  }

  if (autoSyncResult.state === 'request_failed' || autoSyncResult.syncSucceeded === false) {
    return 'failed'
  }

  if (autoSyncResult.reason === 'xero_reauth_required') return 'reconnect_required'
  if (autoSyncResult.reason === 'xero_not_connected') return 'reconnect_required'

  return 'failed'
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

export async function observeFirstXeroSyncCompletion(params: {
  autoSyncResult: XeroAutoSyncResult
  loadStatus: () => Promise<XeroConnectionStatus | null>
  signal: AbortSignal
  pollIntervalMs?: number
  maxStatusChecks?: number
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>
}): Promise<XeroFirstSyncFeedback> {
  const maxStatusChecks = params.maxStatusChecks ?? DEFAULT_MAX_STATUS_CHECKS
  const pollIntervalMs = params.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const wait = params.wait ?? waitForNextCheck

  for (let check = 0; check < maxStatusChecks; check += 1) {
    if (params.signal.aborted) return { state: 'cancelled', status: null }

    const status = await params.loadStatus()
    if (params.signal.aborted) return { state: 'cancelled', status }
    if (!status) return { state: 'failed', status: null }

    const state = resolveXeroFirstSyncFeedback({
      status,
      autoSyncResult: params.autoSyncResult,
    })
    if (state !== 'preparing') return { state, status }

    if (check + 1 < maxStatusChecks) {
      await wait(pollIntervalMs, params.signal)
    }
  }

  return { state: 'failed', status: null }
}
