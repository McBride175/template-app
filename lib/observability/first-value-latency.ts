import 'server-only'

export type FirstValueLatencyStage =
  | 'T0'
  | 'T1'
  | 'T2'
  | 'T3'
  | 'T4'
  | 'T5'
  | 'T6'
  | 'T7'
  | 'T8'
  | 'T9'
  | 'T10'

export type FirstValueLatencyOutcome =
  | 'started'
  | 'succeeded'
  | 'failed'
  | 'blocked'
  | 'deduplicated'

export interface FirstValueLatencyEvent {
  stage: FirstValueLatencyStage
  outcome: FirstValueLatencyOutcome
  userId?: string | null
  tenantId?: string | null
  syncRunId?: string | null
  durationMs?: number | null
  metrics?: Readonly<Record<string, number | null>>
  detail?: string | null
}

function roundedMilliseconds(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return null
  }
  return Math.round(value * 100) / 100
}

function safeIdentifier(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized && normalized.length <= 255 ? normalized : null
}

export function monotonicNow() {
  return performance.now()
}

export function elapsedMilliseconds(startedAt: number, endedAt = monotonicNow()) {
  return roundedMilliseconds(endedAt - startedAt) ?? 0
}

/**
 * Emits one compact structured event per authoritative latency boundary.
 * Identifiers are operational IDs only; tokens, names, invoice data, and other
 * customer content must never be passed to this function.
 */
export function recordFirstValueLatency(event: FirstValueLatencyEvent) {
  const metrics = Object.fromEntries(
    Object.entries(event.metrics ?? {}).map(([key, value]) => [
      key,
      roundedMilliseconds(value),
    ])
  )

  console.info('[first-value.latency]', {
    event: 'first_value_latency',
    observed_at: new Date().toISOString(),
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
    stage: event.stage,
    outcome: event.outcome,
    user_id: safeIdentifier(event.userId),
    tenant_id: safeIdentifier(event.tenantId),
    sync_run_id: safeIdentifier(event.syncRunId),
    duration_ms: roundedMilliseconds(event.durationMs),
    metrics,
    detail: safeIdentifier(event.detail),
  })
}
