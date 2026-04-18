const DEFAULT_XERO_AUTO_SYNC_STALE_MINUTES = 60
const DEFAULT_XERO_AUTO_SYNC_COOLDOWN_SECONDS = 300
const DEFAULT_XERO_AUTO_SYNC_LOCK_TTL_SECONDS = 180

function parsePositiveIntEnv(name: string, fallback: number) {
  const raw = process.env[name]
  if (!raw) return fallback

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return parsed
}

export const XERO_AUTO_SYNC_STALE_MINUTES = parsePositiveIntEnv(
  'XERO_AUTO_SYNC_STALE_MINUTES',
  DEFAULT_XERO_AUTO_SYNC_STALE_MINUTES
)

export const XERO_AUTO_SYNC_COOLDOWN_SECONDS = parsePositiveIntEnv(
  'XERO_AUTO_SYNC_COOLDOWN_SECONDS',
  DEFAULT_XERO_AUTO_SYNC_COOLDOWN_SECONDS
)

export const XERO_AUTO_SYNC_LOCK_TTL_SECONDS = parsePositiveIntEnv(
  'XERO_AUTO_SYNC_LOCK_TTL_SECONDS',
  DEFAULT_XERO_AUTO_SYNC_LOCK_TTL_SECONDS
)

const XERO_AUTO_SYNC_STALE_MS = XERO_AUTO_SYNC_STALE_MINUTES * 60 * 1000
const XERO_AUTO_SYNC_COOLDOWN_MS = XERO_AUTO_SYNC_COOLDOWN_SECONDS * 1000

function toTimestamp(value: string | null) {
  if (!value) return null
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return null
  return parsed
}

export function isXeroDataStale(lastSyncedAt: string | null, nowMs = Date.now()) {
  const lastSyncedAtMs = toTimestamp(lastSyncedAt)
  if (!lastSyncedAtMs) {
    return true
  }

  return nowMs - lastSyncedAtMs >= XERO_AUTO_SYNC_STALE_MS
}

export function isWithinXeroAutoSyncCooldown(lastTriggeredAt: string | null, nowMs = Date.now()) {
  const lastTriggeredAtMs = toTimestamp(lastTriggeredAt)
  if (!lastTriggeredAtMs) {
    return false
  }

  return nowMs - lastTriggeredAtMs < XERO_AUTO_SYNC_COOLDOWN_MS
}
