import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { loadCustomerCollectionsSummaryWithMetadata } from '@/lib/collections/customer-summary'
import { logCollectionsCurrencyHealth } from '@/lib/collections/currency-health'
import {
  type CustomerOverrideLevel,
  prioritiseCustomer,
} from '@/lib/collections/prioritization'
import { buildFirstValueReasons } from '@/lib/collections/first-value'
import { followUpPresets } from '@/lib/collections/action-history'
import { loadLatestQueueActions } from '@/lib/collections/action-history-queue-server'
import { resolveQueueEligibility } from '@/lib/collections/queue-eligibility'
import {
  buildRelativeLatenessContext,
} from '@/lib/collections/relative-lateness'
import {
  isMissingRelationError,
} from '@/lib/collections/tenant-context'
import {
  claimActionsEntitlementStatus,
} from '@/lib/billing/entitlements'
import {
  MULTI_CURRENCY_REQUIRES_PRO_CODE,
  resolveCollectionsCurrencyAccess,
} from '@/lib/billing/collections-access'
import {
  compareDecimalValues,
  decimalValueToFiniteNumber,
  sumDecimalValues,
} from '@/lib/money/currency'
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
type CollectionQueueStatus =
  | 'ready'
  | 'currency_data_degraded'
  | 'currency_data_unavailable'
  | 'no_mapped_data'
  | 'no_overdue_customers'
  | 'no_eligible_customers'
  | 'complete_today'

interface CustomerOverrideRow {
  customer_source_id: string
  override_level: CustomerOverrideLevel
}

interface LoggedCollectionAction {
  type: CollectionActionType
  takenAtIso: string
  outcome: CollectionActionOutcome | null
  nextActionDate: string | null
  actionId: string
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

    const entitlement = await claimActionsEntitlementStatus({
      userId: user.id,
      preferredTenantId: requestedTenantId,
      supabase,
    })
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

    const supabaseAdmin = createSupabaseAdminClient()
    const resultAssemblyStartedAt = monotonicNow()
    recordFirstValueLatency({
      stage: 'T9',
      outcome: 'started',
      userId: user.id,
      tenantId,
    })

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

    const invoiceEligibleRows = summaryRows.filter((row) =>
      !((row.has_active_dispute || row.has_active_promise) && row.collectible_outstanding_base <= 0)
    )
    const hasInvoiceOverdue = (row: (typeof summaryRows)[number]) =>
      compareDecimalValues(row.invoice_to_chase_overdue_base_decimal, '0') === 1
    // Preserve the invoice-derived ageing/reference population before the
    // customer-level accounting-zero gate removes covered monetary actions.
    const invoiceScopeRows = overdueOnly
      ? invoiceEligibleRows.filter(hasInvoiceOverdue)
      : invoiceEligibleRows
    const hasMonetaryOverdue = (row: (typeof summaryRows)[number]) =>
      compareDecimalValues(row.customer_to_chase_overdue_base_decimal, '0') === 1
    const monetaryQueueRows = invoiceEligibleRows.filter((row) =>
      !hasInvoiceOverdue(row) || hasMonetaryOverdue(row)
    )
    const scopeRows = overdueOnly
      ? monetaryQueueRows.filter(hasMonetaryOverdue)
      : monetaryQueueRows

    // These benchmark populations depend only on accounting and authoritative
    // Promise/Dispute/credit state. Neither V1 nor legacy contact history enters.
    const ageingRows = invoiceScopeRows.filter(hasInvoiceOverdue)
    const filteredRows = scopeRows
    const promisedToPayCustomerCount = 0 // Retained response compatibility; contact outcomes no longer suppress.
    const mappedRecordCount =
      sourceCounts.customers + sourceCounts.invoices + sourceCounts.payments

    const analysedOverdueRows = scopeRows.filter(hasMonetaryOverdue)
    const relativeLatenessContext = buildRelativeLatenessContext(
      ageingRows.map((row) => ({
        overdueOutstandingBase: row.invoice_to_chase_overdue_base,
        relativeLatenessDays: row.relative_lateness_days,
      }))
    )
    const totalOverdueOutstandingBaseDecimal = sumDecimalValues(
      filteredRows.map((row) => row.customer_to_chase_overdue_base_decimal)
    )
    const analysedOverdueBaseDecimal = sumDecimalValues(
      analysedOverdueRows.map((row) => row.customer_to_chase_overdue_base_decimal)
    )
    const maxOverdueOutstandingBaseDecimal = filteredRows.reduce((max, row) => {
      return compareDecimalValues(row.customer_to_chase_overdue_base_decimal, max) === 1
        ? row.customer_to_chase_overdue_base_decimal
        : max
    }, '0')
    const ageingOverdueBaseDecimal = sumDecimalValues(
      ageingRows.map((row) => row.invoice_to_chase_overdue_base_decimal)
    )
    const totalOverdueOutstandingBase = decimalValueToFiniteNumber(
      totalOverdueOutstandingBaseDecimal
    )
    const analysedOverdueBase = decimalValueToFiniteNumber(analysedOverdueBaseDecimal)
    const maxOverdueOutstandingBase = decimalValueToFiniteNumber(
      maxOverdueOutstandingBaseDecimal
    )
    const ageingOverdueBase = decimalValueToFiniteNumber(ageingOverdueBaseDecimal)
    if (
      totalOverdueOutstandingBase === null ||
      analysedOverdueBase === null ||
      maxOverdueOutstandingBase === null ||
      ageingOverdueBase === null
    ) {
      throw new Error('Base-currency portfolio totals exceeded the supported calculation range')
    }
    const overallWeightedAvgOverdueDays =
      ageingOverdueBase > 0
        ? ageingRows.reduce(
            (sum, row) =>
              sum +
              Math.max(0, row.weighted_avg_overdue_days) *
                Math.max(0, row.invoice_to_chase_overdue_base),
            0
          ) / ageingOverdueBase
        : 0
    const maxWeightedAvgOverdueDays = ageingRows.reduce(
      (max, row) => Math.max(max, Math.max(0, row.weighted_avg_overdue_days)),
      0
    )

    const scoredRows = filteredRows
      .map((row) => ({
        ...prioritiseCustomer(
          {
            customer_source_id: row.customer_source_id,
            customer_name: row.customer_name,
            customer_email: row.customer_email,
            customer_overdue_to_chase_base: row.customer_to_chase_overdue_base,
            has_actionable_overdue_balance: hasMonetaryOverdue(row),
            invoice_overdue_to_chase_base: row.invoice_to_chase_overdue_base,
            total_outstanding_base: row.collectible_outstanding_base,
            overdue_invoices_count: row.actionable_overdue_invoices_count,
            open_invoices_count: row.actionable_open_invoices_count,
            weighted_avg_overdue_days: row.weighted_avg_overdue_days,
            last_payment_date: row.last_payment_date,
            last_payment_days_ago: row.last_payment_days_ago,
            has_recent_partial_payment: row.has_recent_partial_payment,
            relative_lateness_days: row.relative_lateness_days,
            organisation_base_currency_code: organisationBaseCurrency,
          },
          {
            totalOverdueOutstandingBase,
            maxOverdueOutstandingBase,
            overallWeightedAvgOverdueDays,
            maxWeightedAvgOverdueDays,
            relativeLateness: relativeLatenessContext,
          },
          overrideLevelByCustomerSourceId.get(row.customer_source_id) ?? DEFAULT_OVERRIDE_LEVEL
        ),
        customer_to_chase_overdue_base_decimal: row.customer_to_chase_overdue_base_decimal,
        customer_credit_applied_base: row.customer_credit_applied_base,
        invoice_to_chase_overdue_base_decimal: row.invoice_to_chase_overdue_base_decimal,
        total_outstanding_base_decimal: row.collectible_outstanding_base_decimal,
        gross_outstanding_base_decimal: row.gross_outstanding_base_decimal,
        gross_overdue_base_decimal: row.gross_overdue_base_decimal,
        effective_disputed_outstanding_base_decimal: row.effective_disputed_outstanding_base_decimal,
        effective_disputed_overdue_base_decimal: row.effective_disputed_overdue_base_decimal,
        active_promised_outstanding_base_decimal: row.active_promised_outstanding_base_decimal,
        active_promised_overdue_base_decimal: row.active_promised_overdue_base_decimal,
        to_chase_outstanding_base_decimal: row.to_chase_outstanding_base_decimal,
        to_chase_overdue_base_decimal: row.to_chase_overdue_base_decimal,
        to_chase_outstanding_base: row.to_chase_outstanding_base,
        to_chase_overdue_base: row.to_chase_overdue_base,
        gross_total_outstanding_base: row.total_outstanding_base,
        gross_overdue_outstanding_base: row.overdue_outstanding_base,
        legacy_gross_total_outstanding_base_decimal: row.total_outstanding_base_decimal,
        legacy_gross_overdue_outstanding_base_decimal: row.overdue_outstanding_base_decimal,
        gross_open_invoices_count: row.open_invoices_count,
        gross_overdue_invoices_count: row.overdue_invoices_count,
        actionable_open_invoices_count: row.actionable_open_invoices_count,
        actionable_overdue_invoices_count: row.actionable_overdue_invoices_count,
        native_currency_breakdown: row.native_currency_breakdown,
        collectible_native_currency_breakdown: row.collectible_native_currency_breakdown,
      }))
      .sort((a, b) => {
        const aDoNotChase = a.override_level === 'do_not_chase'
        const bDoNotChase = b.override_level === 'do_not_chase'
        if (aDoNotChase !== bDoNotChase) {
          return aDoNotChase ? 1 : -1
        }

        if (b.priority_score !== a.priority_score) {
          return b.priority_score - a.priority_score
        }

        const baseAmountComparison = compareDecimalValues(
          b.customer_to_chase_overdue_base_decimal,
          a.customer_to_chase_overdue_base_decimal
        )
        if (baseAmountComparison !== null && baseAmountComparison !== 0) {
          return baseAmountComparison
        }

        return a.customer_name.localeCompare(b.customer_name, undefined, {
          sensitivity: 'base',
        })
      })
    const decisionByCustomerSourceId = new Map(
      scoredRows.map((row) => {
        const legacy = latestLegacyActionByCustomerSourceId.get(row.customer_source_id)
        return [row.customer_source_id, resolveQueueEligibility({
          v1NextActionDate: latestV1ByCustomerSourceId.get(row.customer_source_id)?.next_action_date,
          legacyActionType: legacy?.type,
          legacyNextActionDate: legacy?.nextActionDate,
          legacyActionedToday: Boolean(actionsTakenByCustomerId[row.customer_source_id]),
          organisationToday: organisationTodayDateIso,
          legacyToday: legacyTodayDateIso,
          overrideLevel: row.override_level,
          hasActionableOverdueBalance: row.has_actionable_overdue_balance,
          recommendedAction: row.recommended_action,
        })] as const
      })
    )
    const decisions = [...decisionByCustomerSourceId.values()]
    const suppressedCustomerCount = decisions.filter((decision) =>
      decision.reason === 'v1_deferred' || decision.reason === 'legacy_postponed'
    ).length
    const postponedCustomerCount = decisions.filter((decision) =>
      decision.reason === 'legacy_postponed'
    ).length
    const actionedTodayCount = decisions.filter((decision) =>
      decision.reason === 'legacy_actioned_today'
    ).length
    const remainingCustomerCount = decisions.filter((decision) => decision.eligible).length
    const nextReturnDate = decisions.reduce<string | null>((earliest, decision) =>
      decision.nextReturnDate && (!earliest || decision.nextReturnDate < earliest)
        ? decision.nextReturnDate : earliest, null)
    let queueStatus: CollectionQueueStatus = 'ready'
    if (mappedRecordCount === 0) {
      queueStatus = 'no_mapped_data'
    } else if (scopeRows.length === 0) {
      queueStatus = overdueOnly && invoiceScopeRows.length === 0
        ? 'no_overdue_customers' : 'no_eligible_customers'
    } else if (remainingCustomerCount === 0) {
      queueStatus = actionedTodayCount + suppressedCustomerCount > 0
        ? 'complete_today' : 'no_eligible_customers'
    }
    if (currencyHealth.status === 'degraded') queueStatus = 'currency_data_degraded'

    const prioritizedRows = scoredRows
      .filter((row) => {
        const reason = decisionByCustomerSourceId.get(row.customer_source_id)?.reason
        return reason !== 'v1_deferred' && reason !== 'legacy_postponed'
      })
      .slice(0, limit)
      .map((row) => {
        const latestAction = latestLegacyActionByCustomerSourceId.get(row.customer_source_id)
        const latestV1 = latestV1ByCustomerSourceId.get(row.customer_source_id)
        const recentActivity = latestV1 && (!latestAction ||
          latestV1.action_timestamp > latestAction.takenAtIso ||
          (latestV1.action_timestamp === latestAction.takenAtIso && latestV1.id > latestAction.actionId))
          ? {
              format: 'v1' as const,
              outcome: latestV1.outcome,
              note: latestV1.note,
              actionType: null,
              actionTimestamp: latestV1.action_timestamp,
              nextActionDate: latestV1.next_action_date,
            }
          : latestAction ? {
              format: 'legacy' as const,
              outcome: latestAction.outcome,
              note: null,
              actionType: latestAction.type,
              actionTimestamp: latestAction.takenAtIso,
              nextActionDate: latestAction.nextActionDate,
            } : null

        return {
          customer_source_id: row.customer_source_id,
          customer_name: row.customer_name,
          customer_email: row.customer_email,
          // Existing balance fields retain gross accounting meaning. The explicit
          // nullable gross fields signal when an FX-invalid invoice makes a
          // complete base-currency gross total unavailable.
          overdue_outstanding_base_decimal: row.legacy_gross_overdue_outstanding_base_decimal,
          total_outstanding_base_decimal: row.legacy_gross_total_outstanding_base_decimal,
          overdue_outstanding_base: row.gross_overdue_outstanding_base,
          total_outstanding_base: row.gross_total_outstanding_base,
          overdue_outstanding: row.gross_overdue_outstanding_base,
          total_outstanding: row.gross_total_outstanding_base,
          gross_outstanding_base_decimal: row.gross_outstanding_base_decimal,
          gross_overdue_base_decimal: row.gross_overdue_base_decimal,
          effective_disputed_outstanding_base_decimal: row.effective_disputed_outstanding_base_decimal,
          effective_disputed_overdue_base_decimal: row.effective_disputed_overdue_base_decimal,
          active_promised_outstanding_base_decimal: row.active_promised_outstanding_base_decimal,
          active_promised_overdue_base_decimal: row.active_promised_overdue_base_decimal,
          to_chase_outstanding_base_decimal: row.to_chase_outstanding_base_decimal,
          to_chase_overdue_base_decimal: row.to_chase_overdue_base_decimal,
          to_chase_outstanding_base: row.to_chase_outstanding_base,
          to_chase_overdue_base: row.to_chase_overdue_base,
          invoice_to_chase_overdue_base_decimal: row.invoice_to_chase_overdue_base_decimal,
          invoice_to_chase_overdue_base: row.invoice_overdue_to_chase_base,
          customer_to_chase_overdue_base_decimal: row.customer_to_chase_overdue_base_decimal,
          customer_to_chase_overdue_base: row.customer_overdue_to_chase_base,
          customer_credit_applied_base: row.customer_credit_applied_base,
          has_actionable_overdue_balance: row.has_actionable_overdue_balance,
          collectible_outstanding_base_decimal: row.total_outstanding_base_decimal,
          collectible_overdue_base_decimal: row.invoice_to_chase_overdue_base_decimal,
          collectible_outstanding_base: row.total_outstanding_base,
          collectible_overdue_base: row.invoice_overdue_to_chase_base,
          gross_open_invoices_count: row.gross_open_invoices_count,
          gross_overdue_invoices_count: row.gross_overdue_invoices_count,
          // Existing invoice counts retain accounting meaning across APIs.
          overdue_invoices_count: row.gross_overdue_invoices_count,
          open_invoices_count: row.gross_open_invoices_count,
          actionable_overdue_invoices_count: row.actionable_overdue_invoices_count,
          actionable_open_invoices_count: row.actionable_open_invoices_count,
          weighted_avg_overdue_days: row.weighted_avg_overdue_days,
          relative_lateness_days: row.relative_lateness_days,
          relative_lateness_score: row.relative_lateness_score,
          urgency_score: row.urgency_score,
          payment_recency_score: row.payment_recency_score,
          last_payment_date: row.last_payment_date,
          last_payment_days_ago: row.last_payment_days_ago,
          exposure_score: row.exposure_score,
          exposure_share_percent: row.exposure_share_percent,
          exposure_relative_to_largest_percent:
            row.exposure_relative_to_largest_percent,
          override_level: row.override_level,
          override_multiplier: row.override_multiplier,
          base_score: row.base_score,
          final_score: row.final_score,
          priority_score: row.priority_score,
          recommended_action: row.recommended_action,
          recent_activity: recentActivity,
          queue_eligibility_reason: decisionByCustomerSourceId.get(row.customer_source_id)!.reason,
          reason: row.reason,
          score_breakdown_lines: row.score_breakdown_lines,
          first_value_reasons: buildFirstValueReasons(row, {
            eligibleCustomerCount: remainingCustomerCount,
          }),
          organisation_base_currency_code: organisationBaseCurrency,
          currency_code: organisationBaseCurrency,
          native_currency_breakdown: row.native_currency_breakdown,
          collectible_native_currency_breakdown: row.collectible_native_currency_breakdown,
          last_action_type: latestAction?.type ?? null,
          last_action_outcome: latestAction?.outcome ?? null,
          last_action_timestamp: latestAction?.takenAtIso ?? null,
        }
      })

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
      portfolio:
        currencyHealth.status === 'degraded' && filteredRows.length === 0
          ? null
          : {
              // Monetary Exposure uses customer net overdue; ageing uses invoice overdue.
              totalOverdueBase: totalOverdueOutstandingBase,
              totalOverdueBaseDecimal: totalOverdueOutstandingBaseDecimal,
              collectibleTotalOverdueBase: totalOverdueOutstandingBase,
              collectibleTotalOverdueBaseDecimal: totalOverdueOutstandingBaseDecimal,
              analysedOverdueBase,
              analysedOverdueBaseDecimal,
              analysedOverdueCustomerCount: analysedOverdueRows.length,
              largestCustomerOverdueBase: maxOverdueOutstandingBase,
              largestCustomerOverdueBaseDecimal: maxOverdueOutstandingBaseDecimal,
              weightedAverageOverdueDays: overallWeightedAvgOverdueDays,
              rankingStatus: currencyHealth.rankingStatus,
            },
      queue: {
        status: queueStatus,
        rankingStatus: currencyHealth.rankingStatus,
        mappedCustomerCount: sourceCounts.customers,
        mappedInvoiceCount: sourceCounts.invoices,
        mappedPaymentCount: sourceCounts.payments,
        eligibleCustomerCount: scopeRows.length,
        suppressedCustomerCount,
        suppression: {
          postponedCustomerCount,
          promisedToPayCustomerCount,
          nextReturnDate,
        },
        actionedTodayCount,
        remainingCustomerCount,
        returnedCustomerCount: prioritizedRows.length,
        reviewRequiredCustomerCount: reviewRequiredCustomers.length,
        relativeLateness: relativeLatenessContext,
      },
    })
  } catch (error) {
    console.error('[collections.actions.get] Failed to load prioritised collection actions', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return NextResponse.json({ error: 'Failed to load prioritised collection actions' }, { status: 500 })
  }
}
