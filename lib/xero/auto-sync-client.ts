'use client'

type XeroAutoSyncSurface = 'account' | 'dashboard' | 'start'

export type XeroAutoSyncResult =
  | {
      state: 'completed'
      triggered: boolean
      syncSucceeded: boolean | null
      reason: string | null
      syncStatus: number | null
    }
  | {
      state: 'request_failed'
      triggered: false
      syncSucceeded: false
      reason: 'request_failed'
      syncStatus: number | null
    }

const LOCAL_DEBOUNCE_MS = 30 * 1000
const inFlightAutoSyncByKey = new Map<string, Promise<XeroAutoSyncResult>>()
const lastTriggeredAtByKey = new Map<string, number>()
const lastResultByKey = new Map<string, XeroAutoSyncResult>()

type AutoSyncFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>

function normalizeTenantId(tenantId: string | null | undefined) {
  if (!tenantId) return null
  const trimmed = tenantId.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function triggerXeroAutoSyncOnEntry(params: {
  surface: XeroAutoSyncSurface
  tenantId?: string | null
  retry?: boolean
  fetcher?: AutoSyncFetcher
}): Promise<XeroAutoSyncResult> {
  const tenantId = normalizeTenantId(params.tenantId)
  const dedupeKey = `${params.surface}:${tenantId ?? 'default'}`
  const now = Date.now()
  const previousTriggerAt = lastTriggeredAtByKey.get(dedupeKey)
  const inFlight = inFlightAutoSyncByKey.get(dedupeKey)

  if (inFlight) {
    return inFlight
  }

  if (!params.retry && previousTriggerAt && now - previousTriggerAt < LOCAL_DEBOUNCE_MS) {
    const previousResult = lastResultByKey.get(dedupeKey)
    if (previousResult) return Promise.resolve(previousResult)
  }

  lastTriggeredAtByKey.set(dedupeKey, now)
  const fetcher = params.fetcher ?? fetch
  const request = fetcher('/api/xero/sync/auto', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    keepalive: true,
    body: JSON.stringify({
      tenantId,
      surface: params.surface,
      retry: params.retry === true,
    }),
  })
    .then(async (response): Promise<XeroAutoSyncResult> => {
      const payload = (await response.json().catch(() => null)) as {
        triggered?: unknown
        syncSucceeded?: unknown
        syncStatus?: unknown
        reason?: unknown
      } | null

      if (!response.ok) {
        return {
          state: 'request_failed',
          triggered: false,
          syncSucceeded: false,
          reason: 'request_failed',
          syncStatus: response.status,
        }
      }

      return {
        state: 'completed',
        triggered: payload?.triggered === true,
        syncSucceeded:
          typeof payload?.syncSucceeded === 'boolean' ? payload.syncSucceeded : null,
        reason: typeof payload?.reason === 'string' ? payload.reason : null,
        syncStatus: typeof payload?.syncStatus === 'number' ? payload.syncStatus : null,
      }
    })
    .catch((): XeroAutoSyncResult => ({
      state: 'request_failed',
      triggered: false,
      syncSucceeded: false,
      reason: 'request_failed',
      syncStatus: null,
    }))
    .then((result) => {
      lastResultByKey.set(dedupeKey, result)
      return result
    })
    .finally(() => {
      inFlightAutoSyncByKey.delete(dedupeKey)
    })

  inFlightAutoSyncByKey.set(dedupeKey, request)
  return request
}
