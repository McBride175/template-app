import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { XERO_AUTO_SYNC_LOCK_TTL_SECONDS, XERO_AUTO_SYNC_STALE_MINUTES } from '@/lib/xero/auto-sync'
import { syncXeroTenantForUser } from '@/lib/xero/sync'

const JOB_KEY = 'xero_scheduled_sync'

const DEFAULT_BATCH_SIZE = 25
const MAX_BATCH_SIZE = 200
const DEFAULT_ACTIVITY_WINDOW_HOURS = 168
const DEFAULT_MIN_INTERVAL_MINUTES = 120
const DEFAULT_RUN_LOCK_TTL_SECONDS = 900
const DEFAULT_STALE_MINUTES = XERO_AUTO_SYNC_STALE_MINUTES

interface ScheduledSyncCandidateRow {
  user_id: string
  tenant_id: string
  last_sign_in_at: string | null
  connection_updated_at: string | null
  last_synced_at: string | null
}

interface ScheduledSyncConfig {
  enabled: boolean
  batchSize: number
  activityWindowHours: number
  minIntervalMinutes: number
  runLockTtlSeconds: number
  staleMinutes: number
}

interface RunScheduledXeroSyncJobOptions {
  dryRun?: boolean
  limitOverride?: number | null
}

function clampInteger(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function parsePositiveInteger(value: string | undefined, fallback: number, min: number, max: number) {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < min) return fallback
  return clampInteger(parsed, min, max)
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value) return fallback
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function readConfig(): ScheduledSyncConfig {
  return {
    enabled: parseBoolean(process.env.XERO_SCHEDULED_SYNC_ENABLED, false),
    batchSize: parsePositiveInteger(
      process.env.XERO_SCHEDULED_SYNC_BATCH_SIZE,
      DEFAULT_BATCH_SIZE,
      1,
      MAX_BATCH_SIZE
    ),
    activityWindowHours: parsePositiveInteger(
      process.env.XERO_SCHEDULED_SYNC_ACTIVITY_WINDOW_HOURS,
      DEFAULT_ACTIVITY_WINDOW_HOURS,
      1,
      24 * 90
    ),
    minIntervalMinutes: parsePositiveInteger(
      process.env.XERO_SCHEDULED_SYNC_MIN_INTERVAL_MINUTES,
      DEFAULT_MIN_INTERVAL_MINUTES,
      1,
      24 * 60
    ),
    runLockTtlSeconds: parsePositiveInteger(
      process.env.XERO_SCHEDULED_SYNC_RUN_LOCK_TTL_SECONDS,
      DEFAULT_RUN_LOCK_TTL_SECONDS,
      60,
      24 * 60 * 60
    ),
    staleMinutes: parsePositiveInteger(
      process.env.XERO_SCHEDULED_SYNC_STALE_MINUTES,
      DEFAULT_STALE_MINUTES,
      1,
      24 * 60 * 60
    ),
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function summarizeSyncResult(responseStatus: number, payload: Record<string, unknown> | null) {
  if (responseStatus >= 200 && responseStatus < 300) {
    return {
      result: 'synced' as const,
      code: readString(payload?.code) ?? null,
      error: null,
    }
  }

  if (responseStatus === 400 || responseStatus === 409) {
    return {
      result: 'skipped' as const,
      code: readString(payload?.code) ?? null,
      error: readString(payload?.error) ?? 'Sync skipped by current auth state',
    }
  }

  return {
    result: 'failed' as const,
    code: readString(payload?.code) ?? null,
    error: readString(payload?.error) ?? `Unexpected HTTP ${responseStatus}`,
  }
}

function resolveLimit(limitOverride: number | null | undefined, defaultLimit: number) {
  if (typeof limitOverride !== 'number' || !Number.isFinite(limitOverride)) return defaultLimit
  return clampInteger(Math.trunc(limitOverride), 1, MAX_BATCH_SIZE)
}

async function releaseTenantAutoSyncLock(params: {
  userId: string
  tenantId: string
  lockId: string
}) {
  const supabaseAdmin = createSupabaseAdminClient()
  const { error } = await supabaseAdmin.rpc('release_xero_tenant_auto_sync_lock', {
    p_user_id: params.userId,
    p_tenant_id: params.tenantId,
    p_lock_id: params.lockId,
  })

  if (error) {
    console.error('[xero.scheduled-sync] Failed to release tenant auto-sync lock', {
      user_id: params.userId,
      tenant_id: params.tenantId,
      message: error.message,
    })
  }
}

export async function runScheduledXeroSyncJob(options: RunScheduledXeroSyncJobOptions = {}) {
  const config = readConfig()
  const limit = resolveLimit(options.limitOverride, config.batchSize)

  if (!config.enabled) {
    return NextResponse.json({
      ok: true,
      scheduled: true,
      skipped: true,
      reason: 'disabled',
      config: {
        enabled: config.enabled,
        batchSize: limit,
        activityWindowHours: config.activityWindowHours,
        minIntervalMinutes: config.minIntervalMinutes,
        staleMinutes: config.staleMinutes,
      },
    })
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const runLockId = randomUUID()
  const lockPayload = {
    p_job_key: JOB_KEY,
    p_lock_id: runLockId,
    p_ttl_seconds: config.runLockTtlSeconds,
    p_min_interval_minutes: config.minIntervalMinutes,
  }

  const { data: lockResult, error: lockError } = await supabaseAdmin.rpc(
    'acquire_xero_scheduled_sync_run_lock',
    lockPayload
  )

  if (lockError) {
    console.error('[xero.scheduled-sync] Failed to acquire scheduled sync run lock', {
      message: lockError.message,
    })
    return NextResponse.json(
      {
        error: 'Failed to acquire scheduled sync lock',
        code: 'XERO_SCHEDULED_SYNC_LOCK_FAILED',
      },
      { status: 500 }
    )
  }

  if (!lockResult) {
    return NextResponse.json({
      ok: true,
      scheduled: true,
      skipped: true,
      reason: 'in_flight_or_cadence_gate',
      config: {
        batchSize: limit,
        activityWindowHours: config.activityWindowHours,
        minIntervalMinutes: config.minIntervalMinutes,
        staleMinutes: config.staleMinutes,
      },
    })
  }

  try {
    const { data: candidatesData, error: candidatesError } = await supabaseAdmin.rpc(
      'list_xero_scheduled_sync_candidates',
      {
        p_activity_window_hours: config.activityWindowHours,
        p_limit: limit,
        p_stale_minutes: config.staleMinutes,
      }
    )

    if (candidatesError) {
      console.error('[xero.scheduled-sync] Failed to load scheduled sync candidates', {
        message: candidatesError.message,
      })
      return NextResponse.json(
        {
          error: 'Failed to load scheduled sync candidates',
          code: 'XERO_SCHEDULED_SYNC_CANDIDATES_FAILED',
        },
        { status: 500 }
      )
    }

    const candidates = (candidatesData ?? []) as ScheduledSyncCandidateRow[]

    if (options.dryRun) {
      return NextResponse.json({
        ok: true,
        scheduled: true,
        dryRun: true,
        skipped: false,
        candidateCount: candidates.length,
        config: {
          batchSize: limit,
          activityWindowHours: config.activityWindowHours,
          minIntervalMinutes: config.minIntervalMinutes,
          staleMinutes: config.staleMinutes,
        },
        candidates: candidates.map((candidate) => ({
          userId: candidate.user_id,
          tenantId: candidate.tenant_id,
          lastSignInAt: candidate.last_sign_in_at,
          connectionUpdatedAt: candidate.connection_updated_at,
          lastSyncedAt: candidate.last_synced_at,
        })),
      })
    }

    const results: Array<{
      userId: string
      tenantId: string
      status: 'synced' | 'skipped' | 'failed'
      httpStatus: number
      code: string | null
      error: string | null
    }> = []
    let synced = 0
    let skipped = 0
    let failed = 0

    for (const candidate of candidates) {
      const tenantLockId = randomUUID()
      const { data: tenantLockAcquired, error: tenantLockError } = await supabaseAdmin.rpc(
        'acquire_xero_tenant_auto_sync_lock',
        {
          p_user_id: candidate.user_id,
          p_tenant_id: candidate.tenant_id,
          p_lock_id: tenantLockId,
          p_ttl_seconds: XERO_AUTO_SYNC_LOCK_TTL_SECONDS,
        }
      )

      if (tenantLockError) {
        console.error('[xero.scheduled-sync] Failed to acquire tenant auto-sync lock', {
          user_id: candidate.user_id,
          tenant_id: candidate.tenant_id,
          message: tenantLockError.message,
        })
        failed += 1
        results.push({
          userId: candidate.user_id,
          tenantId: candidate.tenant_id,
          status: 'failed',
          httpStatus: 500,
          code: 'XERO_TENANT_AUTO_SYNC_LOCK_FAILED',
          error: 'Failed to acquire tenant auto-sync lock',
        })
        continue
      }

      if (!tenantLockAcquired) {
        skipped += 1
        results.push({
          userId: candidate.user_id,
          tenantId: candidate.tenant_id,
          status: 'skipped',
          httpStatus: 409,
          code: 'XERO_TENANT_AUTO_SYNC_LOCKED',
          error: 'Tenant sync is already in progress',
        })
        continue
      }

      let response: NextResponse

      try {
        response = await syncXeroTenantForUser({
          userId: candidate.user_id,
          tenantId: candidate.tenant_id,
        })
      } finally {
        await releaseTenantAutoSyncLock({
          userId: candidate.user_id,
          tenantId: candidate.tenant_id,
          lockId: tenantLockId,
        })
      }

      const payload = asObject(await response.json().catch(() => null))
      const summarized = summarizeSyncResult(response.status, payload)

      if (summarized.result === 'synced') synced += 1
      if (summarized.result === 'skipped') skipped += 1
      if (summarized.result === 'failed') failed += 1

      results.push({
        userId: candidate.user_id,
        tenantId: candidate.tenant_id,
        status: summarized.result,
        httpStatus: response.status,
        code: summarized.code,
        error: summarized.error,
      })
    }

    return NextResponse.json({
      ok: failed === 0,
      scheduled: true,
      dryRun: false,
      skipped: false,
      candidateCount: candidates.length,
      synced,
      skippedCount: skipped,
      failedCount: failed,
      config: {
        batchSize: limit,
        activityWindowHours: config.activityWindowHours,
        minIntervalMinutes: config.minIntervalMinutes,
        staleMinutes: config.staleMinutes,
      },
      results,
    })
  } finally {
    const { error: releaseError } = await supabaseAdmin.rpc('release_xero_scheduled_sync_run_lock', {
      p_job_key: JOB_KEY,
      p_lock_id: runLockId,
    })

    if (releaseError) {
      console.error('[xero.scheduled-sync] Failed to release scheduled sync run lock', {
        message: releaseError.message,
      })
    }
  }
}
