import { claimCollectionAccess } from '@/lib/collections/access-context-server'
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { loadCustomerCollectionsSummaryWithMetadata } from '@/lib/collections/customer-summary'
import { logCollectionsCurrencyHealth } from '@/lib/collections/currency-health'
import type { CustomerOverrideLevel } from '@/lib/collections/prioritization'
import { calculatePortfolioBenchmarks, calculatePortfolioBaseScores } from '@/lib/collections/portfolio-benchmarks'
import { projectCollectionQueue, type CollectionQueueStatus, type LoggedCollectionAction } from '@/lib/collections/queue-projection'
import { followUpPresets } from '@/lib/collections/action-history'
import { loadLatestQueueActions } from '@/lib/collections/action-history-queue-server'
import { FastQueueUnavailable, readCollectionQueueProjection } from '@/lib/collections/fast-queue-projection-server'
import {
  buildRelativeLatenessContext,
} from '@/lib/collections/relative-lateness'
import {
  isMissingRelationError,
} from '@/lib/collections/tenant-context'
import {
  MULTI_CURRENCY_REQUIRES_PRO_CODE,
  resolveCollectionsCurrencyAccess,
} from '@/lib/billing/collections-access'
import {
  elapsedMilliseconds,
  monotonicNow,
  recordFirstValueLatency,
} from '@/lib/observability/first-value-latency'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const DEFAULT_OVERRIDE_LEVEL: CustomerOverrideLevel = 'normal'
const COLLECTION_ACTION_TYPES = ['called', 'emailed', 'postponed'] as const
const COLLECTION_ACTION_OUTCOMES = [
  'no_response',
  'spoke_to_customer',
  'promised_to_pay',
  'disputed',
] as const

type CollectionActionType = (typeof COLLECTION_ACTION_TYPES)[number]
type CollectionActionOutcome = (typeof COLLECTION_ACTION_OUTCOMES)[number]

interface CustomerOverrideRow {
  customer_source_id: string
  override_level: CustomerOverrideLevel
}
function toUtcDateIso(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

function parseLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT
  return Math.min(parsed, MAX_LIMIT)
}

function parseOverdueOnly(value: string | null) {
  return value?.trim().toLowerCase() === 'true'
}

function parseTenantId(value: string | null) {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseOverrideLevel(value: string | null | undefined): CustomerOverrideLevel {
  if (value === 'safe') return value
  if (value === 'normal') return value
  if (value === 'priority') return value
  if (value === 'do_not_chase') return value
  return DEFAULT_OVERRIDE_LEVEL
}

function parseCollectionActionType(value: string): CollectionActionType | null {
  if (COLLECTION_ACTION_TYPES.includes(value as CollectionActionType)) {
    return value as CollectionActionType
  }
  return null
}

function parseCollectionActionOutcome(value: string | null): CollectionActionOutcome | null {
  if (!value) return null
  if (COLLECTION_ACTION_OUTCOMES.includes(value as CollectionActionOutcome)) {
    return value as CollectionActionOutcome
  }
  return null
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const limit = parseLimit(searchParams.get('limit'))
    const overdueOnly = parseOverdueOnly(searchParams.get('overdueOnly'))
    const requestedTenantId = parseTenantId(searchParams.get('tenantId'))

    const accessAdmin = createSupabaseAdminClient()
    const access = await claimCollectionAccess({
      admin: accessAdmin, userId: user.id, tenantId: requestedTenantId, supabase,
    })
    const entitlement = access.entitlement
    const tenantId = entitlement.tenantId

    if (!tenantId) {
      return NextResponse.json(
        {
          ok: false,
          code: 'NO_XERO_TENANT',
          error: 'No connected Xero tenant found',
          entitlement,
        },
        { status: 400 }
      )
    }

    if (!entitlement.hasActionsAccess) {
      return NextResponse.json(
        {
          ok: false,
          code: 'ACTION_USAGE_LIMIT_REACHED',
          entitlement,
        },
        { status: 402 }
      )
    }

    const supabaseAdmin = accessAdmin
    const resultAssemblyStartedAt = monotonicNow()
    recordFirstValueLatency({
      stage: 'T9',
      outcome: 'started',
      userId: user.id,
      tenantId,
    })

    // The additive programme migrations may not yet be installed in a staged
    // environment. Only an absent schema or legacy accounting uses the old
    // authoritative loader; a stale/current-generation calculation is never
    // silently replaced with an older persisted score.
    let fastProjection = null
    try {
      fastProjection = await readCollectionQueueProjection({
        admin: supabaseAdmin, userId: user.id, tenantId,
        evaluationInstant: new Date(), overdueOnly, limit,
        requireCurrentDate: true,
        legacyTodayDateIso: entitlement.usageDate,
      })
    } catch (error) {
      if (!(error instanceof FastQueueUnavailable) ||
          (error.reason !== 'schema' && error.reason !== 'legacy' && error.reason !== 'transport')) throw error
    }
    if (fastProjection) {
      const { metadata, version, metrics } = fastProjection
      const currencyAccess = resolveCollectionsCurrencyAccess({
        entitlement, currencyContext: metadata.currencyContext,
      })
      if (!currencyAccess.allowed) {
        return NextResponse.json({ ok: false, code: MULTI_CURRENCY_REQUIRES_PRO_CODE,
          entitlement, currencyContext: metadata.currencyContext, currencyAccess }, { status: 402 })
      }
      recordFirstValueLatency({
        stage: 'T10', outcome: 'succeeded', userId: user.id, tenantId,
        syncRunId: version.accountingGenerationId,
        durationMs: elapsedMilliseconds(resultAssemblyStartedAt),
        metrics: { customers: metadata.sourceCounts.customers,
          invoices: metadata.sourceCounts.invoices, payments: metadata.sourceCounts.payments,
          result_rows: fastProjection.rows.length, projection_db_ms: metrics.databaseWaitMs,
          projection_db_round_trips: metrics.roundTrips,
          projection_customers_examined: metrics.customersExamined,
          projection_calculation_rebuilt: Number(metrics.calculationRebuilt) },
        detail: fastProjection.queue.status,
      })
      return NextResponse.json({
        ok: true, tenantId, entitlement, currencyContext: metadata.currencyContext,
        currencyAccess, organisationBaseCurrency: metadata.organisationBaseCurrency,
        currencyHealth: metadata.currencyHealth, reviewRequiredCustomers: fastProjection.reviews,
        snapshot: { mode: 'generation', syncRunId: version.accountingGenerationId },
        ...(fastProjection.followUpSchedule ? { followUpSchedule: fastProjection.followUpSchedule } : {}),
        experience: fastProjection.experience, rows: fastProjection.rows,
        actionsTakenByCustomerId: fastProjection.actionsTakenByCustomerId,
        portfolio: fastProjection.portfolio, queue: fastProjection.queue,
        version,
      })
    }

    const summaryStartedAt = monotonicNow()
    const summaryPromise = loadCustomerCollectionsSummaryWithMetadata(
      supabaseAdmin,
      user.id,
      tenantId
    ).then((value) => ({ value, durationMs: elapsedMilliseconds(summaryStartedAt) }))
    const summaryResult = await summaryPromise
    const {
      rows: summaryRows,
      sourceCounts,
      organisationBaseCurrency,
      organisationTimezone,
      currencyHealth,
      currencyEvaluation,
      currencyContext,
      reviewRequiredCustomers,
      snapshot,
    } = summaryResult.value
    const currencyAccess = resolveCollectionsCurrencyAccess({ entitlement, currencyContext })

    if (!currencyAccess.allowed) {
      recordFirstValueLatency({
        stage: 'T10',
        outcome: 'blocked',
        userId: user.id,
        tenantId,
        durationMs: elapsedMilliseconds(resultAssemblyStartedAt),
        detail: MULTI_CURRENCY_REQUIRES_PRO_CODE,
      })
      return NextResponse.json(
        {
          ok: false,
          code: MULTI_CURRENCY_REQUIRES_PRO_CODE,
          entitlement,
          currencyContext,
          currencyAccess,
        },
        { status: 402 }
      )
    }

    const overridesStartedAt = monotonicNow()
    const overridesPromise = supabaseAdmin
      .from('customer_overrides')
      .select('customer_source_id, override_level')
      .eq('user_id', user.id)
      .eq('tenant_id', tenantId)
      .then((value) => ({ value, durationMs: elapsedMilliseconds(overridesStartedAt) }))
    const actionsStartedAt = monotonicNow()
    const actionsPromise = loadLatestQueueActions({
      admin: supabaseAdmin,
      userId: user.id,
      tenantId,
      customerSourceIds: summaryRows.map((row) => row.customer_source_id),
    })
      .then((value) => ({ value, durationMs: elapsedMilliseconds(actionsStartedAt) }))
    const [overridesResult, actionsResult] = await Promise.all([
      overridesPromise,
      actionsPromise,
    ])

    const overrideLevelByCustomerSourceId = new Map<string, CustomerOverrideLevel>()
    const latestLegacyActionByCustomerSourceId = new Map<string, LoggedCollectionAction>()
    const latestV1ByCustomerSourceId = new Map<string, (typeof actionRows)[number]>()
    const actionsTakenByCustomerId: Record<string, LoggedCollectionAction> = {}
    const legacyTodayDateIso = entitlement.usageDate
    const followUpSchedule = followUpPresets(organisationTimezone ?? null)
    const organisationTodayDateIso = followUpSchedule.today

    const { data: overrideRows, error: overrideError } = overridesResult.value
    const hasPriorOverrideActivity = (overrideRows?.length ?? 0) > 0

    if (overrideError) {
      if (!isMissingRelationError(overrideError, 'customer_overrides')) {
        throw new Error(`Failed to load customer overrides: ${overrideError.message}`)
      }
    } else {
      for (const row of (overrideRows ?? []) as CustomerOverrideRow[]) {
        overrideLevelByCustomerSourceId.set(
          row.customer_source_id,
          parseOverrideLevel(row.override_level)
        )
      }
    }

    const { rows: actionRows, hasPriorActionActivity } = actionsResult.value
    const hasPriorCollectionActivity = hasPriorOverrideActivity || hasPriorActionActivity

    for (const row of actionRows) {
      if (row.action_format === 'v1') {
        latestV1ByCustomerSourceId.set(row.customer_source_id, row)
        continue
      }
      const actionType = parseCollectionActionType(row.action_type)
      if (!actionType) throw new Error('Latest legacy action had an invalid type')
      latestLegacyActionByCustomerSourceId.set(row.customer_source_id, {
          type: actionType,
          takenAtIso: row.action_timestamp,
          outcome: parseCollectionActionOutcome(row.outcome),
          nextActionDate: row.next_action_date,
          actionId: row.id,
      })
    }

    for (const [customerSourceId, latestAction] of latestLegacyActionByCustomerSourceId.entries()) {
      const actionDateIso = toUtcDateIso(latestAction.takenAtIso)
      if (actionDateIso === legacyTodayDateIso) {
        actionsTakenByCustomerId[customerSourceId] = latestAction
      }
    }

    logCollectionsCurrencyHealth({
      route: 'collections.actions.get',
      accountId: user.id,
      tenantId,
      evaluation: currencyEvaluation,
    })

    if (currencyHealth.status === 'unavailable' || !organisationBaseCurrency) {
      recordFirstValueLatency({
        stage: 'T10',
        outcome: 'blocked',
        userId: user.id,
        tenantId,
        durationMs: elapsedMilliseconds(resultAssemblyStartedAt),
        detail: 'currency_data_unavailable',
      })
      return NextResponse.json({
        ok: true,
        tenantId,
        entitlement,
        currencyContext,
        currencyAccess,
        organisationBaseCurrency,
        currencyHealth,
        reviewRequiredCustomers,
        snapshot,
        experience: { hasPriorCollectionActivity },
        rows: [],
        actionsTakenByCustomerId: {},
        portfolio: null,
        queue: {
          status: 'currency_data_unavailable' satisfies CollectionQueueStatus,
          rankingStatus: currencyHealth.rankingStatus,
          mappedCustomerCount: sourceCounts.customers,
          mappedInvoiceCount: sourceCounts.invoices,
          mappedPaymentCount: sourceCounts.payments,
          eligibleCustomerCount: 0,
          suppressedCustomerCount: 0,
          actionedTodayCount: 0,
          remainingCustomerCount: 0,
          returnedCustomerCount: 0,
          reviewRequiredCustomerCount: reviewRequiredCustomers.length,
          relativeLateness: buildRelativeLatenessContext([]),
        },
      })
    }

    const benchmarks = calculatePortfolioBenchmarks({ rows: summaryRows, overdueOnly })
    const baseScores = calculatePortfolioBaseScores(benchmarks, organisationBaseCurrency)
    const projection = projectCollectionQueue({
      benchmarks, baseScores, organisationBaseCurrency, currencyHealth, sourceCounts,
      reviewRequiredCustomerCount: reviewRequiredCustomers.length,
      overrideLevelByCustomerSourceId, latestV1ByCustomerSourceId,
      latestLegacyActionByCustomerSourceId, actionsTakenByCustomerId,
      organisationTodayDateIso, legacyTodayDateIso, limit,
    })
    const prioritizedRows = projection.rows
    const queueStatus = projection.queue.status

    recordFirstValueLatency({
      stage: 'T10',
      outcome: 'succeeded',
      userId: user.id,
      tenantId,
      syncRunId: snapshot?.mode === 'generation' ? snapshot.syncRunId : null,
      durationMs: elapsedMilliseconds(resultAssemblyStartedAt),
      metrics: {
        customers: sourceCounts.customers,
        invoices: sourceCounts.invoices,
        payments: sourceCounts.payments,
        result_rows: prioritizedRows.length,
        summary_ms: summaryResult.durationMs,
        overrides_ms: overridesResult.durationMs,
        actions_ms: actionsResult.durationMs,
      },
      detail: queueStatus,
    })

    return NextResponse.json({
      ok: true,
      tenantId,
      entitlement,
      currencyContext,
      currencyAccess,
      organisationBaseCurrency,
      currencyHealth,
      reviewRequiredCustomers,
      snapshot,
      followUpSchedule,
      experience: { hasPriorCollectionActivity },
      rows: prioritizedRows,
      actionsTakenByCustomerId,
      portfolio: projection.portfolio,
      queue: projection.queue,
    })
  } catch (error) {
    console.error('[collections.actions.get] Failed to load prioritised collection actions', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return NextResponse.json({ error: 'Failed to load prioritised collection actions' }, { status: 500 })
  }
}
