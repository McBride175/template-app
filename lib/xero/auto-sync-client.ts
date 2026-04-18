'use client'

type XeroAutoSyncSurface = 'account' | 'dashboard'

const LOCAL_DEBOUNCE_MS = 30 * 1000
const inFlightAutoSyncKeys = new Set<string>()
const lastTriggeredAtByKey = new Map<string, number>()

function normalizeTenantId(tenantId: string | null | undefined) {
  if (!tenantId) return null
  const trimmed = tenantId.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function triggerXeroAutoSyncOnEntry(params: {
  surface: XeroAutoSyncSurface
  tenantId?: string | null
}) {
  const tenantId = normalizeTenantId(params.tenantId)
  const dedupeKey = `${params.surface}:${tenantId ?? 'default'}`
  const now = Date.now()
  const previousTriggerAt = lastTriggeredAtByKey.get(dedupeKey)

  if (inFlightAutoSyncKeys.has(dedupeKey)) {
    return
  }

  if (previousTriggerAt && now - previousTriggerAt < LOCAL_DEBOUNCE_MS) {
    return
  }

  inFlightAutoSyncKeys.add(dedupeKey)
  lastTriggeredAtByKey.set(dedupeKey, now)

  void fetch('/api/xero/sync/auto', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    keepalive: true,
    body: JSON.stringify({
      tenantId,
      surface: params.surface,
    }),
  })
    .catch(() => {
      // Ignore auto-sync trigger errors; this is best-effort background behavior.
    })
    .finally(() => {
      inFlightAutoSyncKeys.delete(dedupeKey)
    })
}
