import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { loadCustomerCollectionsSummaryWithMetadata } from '@/lib/collections/customer-summary'
import { logCollectionsCurrencyHealth } from '@/lib/collections/currency-health'
import {
  type CustomerOverrideLevel,
  prioritiseCustomer,
} from '@/lib/collections/prioritization'
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

interface CollectionActionRow {
  id: string
  customer_source_id: string
  action_type: string
  outcome: string | null
  next_action_date: string | null
  action_timestamp: string
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

function shouldSuppressCustomerFromQueue(
  latestAction: LoggedCollectionAction | undefined,
  todayDateIso: string
) {
  if (!latestAction?.nextActionDate) return false

  const suppressesQueue =
    latestAction.type === 'postponed' || latestAction.outcome === 'promised_to_pay'

  if (!suppressesQueue) return false

  return latestAction.nextActionDate > todayDateIso
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

    const {
      rows: summaryRows,
      sourceCounts,
      organisationBaseCurrency,
      currencyHealth,
      currencyEvaluation,
      currencyContext,
      reviewRequiredCustomers,
    } = await loadCustomerCollectionsSummaryWithMetadata(supabaseAdmin, user.id, tenantId)
    const currencyAccess = resolveCollectionsCurrencyAccess({ entitlement, currencyContext })

    if (!currencyAccess.allowed) {
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

    const overrideLevelByCustomerSourceId = new Map<string, CustomerOverrideLevel>()
    const latestActionByCustomerSourceId = new Map<string, LoggedCollectionAction>()
    const actionsTakenByCustomerId: Record<string, LoggedCollectionAction> = {}
    const todayDateIso = entitlement.usageDate

    const { data: overrideRows, error: overrideError } = await supabaseAdmin
      .from('customer_overrides')
      .select('customer_source_id, override_level')
      .eq('user_id', user.id)
      .eq('tenant_id', tenantId)

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

    const { data: actionRows, error: actionError } = await supabaseAdmin
      .from('collection_actions')
      .select(
        'id, customer_source_id, action_type, outcome, next_action_date, action_timestamp'
      )
      .eq('user_id', user.id)
      .eq('tenant_id', tenantId)
      .order('action_timestamp', { ascending: false })

    if (actionError) {
      if (!isMissingRelationError(actionError, 'collection_actions')) {
        throw new Error(`Failed to load collection actions: ${actionError.message}`)
      }
    } else {
      for (const row of (actionRows ?? []) as CollectionActionRow[]) {
        if (latestActionByCustomerSourceId.has(row.customer_source_id)) continue

        const actionType = parseCollectionActionType(row.action_type)
        if (!actionType) continue

        latestActionByCustomerSourceId.set(row.customer_source_id, {
          type: actionType,
          takenAtIso: row.action_timestamp,
          outcome: parseCollectionActionOutcome(row.outcome),
          nextActionDate: row.next_action_date,
          actionId: row.id,
        })
      }

      for (const [customerSourceId, latestAction] of latestActionByCustomerSourceId.entries()) {
        const actionDateIso = toUtcDateIso(latestAction.takenAtIso)
        if (actionDateIso === todayDateIso) {
          actionsTakenByCustomerId[customerSourceId] = latestAction
        }
      }
    }

    logCollectionsCurrencyHealth({
      route: 'collections.actions.get',
      accountId: user.id,
      tenantId,
      evaluation: currencyEvaluation,
    })

    if (currencyHealth.status === 'unavailable' || !organisationBaseCurrency) {
      return NextResponse.json({
        ok: true,
        tenantId,
        entitlement,
        currencyContext,
        currencyAccess,
        organisationBaseCurrency,
        currencyHealth,
        reviewRequiredCustomers,
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

    const scopeRows = overdueOnly
      ? summaryRows.filter((row) => row.overdue_outstanding_base > 0)
      : summaryRows

    const queueEligibleRows = summaryRows.filter((row) => {
      const latestAction = latestActionByCustomerSourceId.get(row.customer_source_id)
      return !shouldSuppressCustomerFromQueue(latestAction, todayDateIso)
    })

    const filteredRows = overdueOnly
      ? queueEligibleRows.filter((row) => row.overdue_outstanding_base > 0)
      : queueEligibleRows
    const suppressedCustomerCount = scopeRows.length - filteredRows.length
    const actionedTodayCount = filteredRows.filter(
      (row) => actionsTakenByCustomerId[row.customer_source_id]
    ).length
    const remainingCustomerCount = filteredRows.length - actionedTodayCount
    const mappedRecordCount =
      sourceCounts.customers + sourceCounts.invoices + sourceCounts.payments
    let queueStatus: CollectionQueueStatus = 'ready'

    if (mappedRecordCount === 0) {
      queueStatus = 'no_mapped_data'
    } else if (scopeRows.length === 0) {
      queueStatus = overdueOnly ? 'no_overdue_customers' : 'no_eligible_customers'
    } else if (remainingCustomerCount === 0) {
      queueStatus = 'complete_today'
    }
    if (currencyHealth.status === 'degraded') {
      queueStatus = 'currency_data_degraded'
    }

    const overdueRows = filteredRows.filter((row) => row.overdue_outstanding_base > 0)
    const relativeLatenessContext = buildRelativeLatenessContext(
      overdueRows.map((row) => ({
        overdueOutstandingBase: row.overdue_outstanding_base,
        relativeLatenessDays: row.relative_lateness_days,
      }))
    )
    const totalOverdueOutstandingBaseDecimal = sumDecimalValues(
      filteredRows.map((row) => row.overdue_outstanding_base_decimal)
    )
    const maxOverdueOutstandingBaseDecimal = filteredRows.reduce((max, row) => {
      return compareDecimalValues(row.overdue_outstanding_base_decimal, max) === 1
        ? row.overdue_outstanding_base_decimal
        : max
    }, '0')
    const totalOverdueOutstandingBase = decimalValueToFiniteNumber(
      totalOverdueOutstandingBaseDecimal
    )
    const maxOverdueOutstandingBase = decimalValueToFiniteNumber(
      maxOverdueOutstandingBaseDecimal
    )
    if (totalOverdueOutstandingBase === null || maxOverdueOutstandingBase === null) {
      throw new Error('Base-currency portfolio totals exceeded the supported calculation range')
    }
    const overallWeightedAvgOverdueDays =
      totalOverdueOutstandingBase > 0
        ? overdueRows.reduce(
            (sum, row) =>
              sum +
              Math.max(0, row.weighted_avg_overdue_days) *
                Math.max(0, row.overdue_outstanding_base),
            0
          ) / totalOverdueOutstandingBase
        : 0
    const maxWeightedAvgOverdueDays = overdueRows.reduce(
      (max, row) => Math.max(max, Math.max(0, row.weighted_avg_overdue_days)),
      0
    )

    const prioritizedRows = filteredRows
      .map((row) => ({
        ...prioritiseCustomer(
          {
            customer_source_id: row.customer_source_id,
            customer_name: row.customer_name,
            customer_email: row.customer_email,
            overdue_outstanding_base: row.overdue_outstanding_base,
            total_outstanding_base: row.total_outstanding_base,
            overdue_invoices_count: row.overdue_invoices_count,
            open_invoices_count: row.open_invoices_count,
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
        overdue_outstanding_base_decimal: row.overdue_outstanding_base_decimal,
        total_outstanding_base_decimal: row.total_outstanding_base_decimal,
        native_currency_breakdown: row.native_currency_breakdown,
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
          b.overdue_outstanding_base_decimal,
          a.overdue_outstanding_base_decimal
        )
        if (baseAmountComparison !== null && baseAmountComparison !== 0) {
          return baseAmountComparison
        }

        return a.customer_name.localeCompare(b.customer_name, undefined, {
          sensitivity: 'base',
        })
      })
      .slice(0, limit)
      .map((row) => {
        const latestAction = latestActionByCustomerSourceId.get(row.customer_source_id)

        return {
          customer_source_id: row.customer_source_id,
          customer_name: row.customer_name,
          customer_email: row.customer_email,
          overdue_outstanding_base_decimal: row.overdue_outstanding_base_decimal,
          total_outstanding_base_decimal: row.total_outstanding_base_decimal,
          overdue_outstanding_base: row.overdue_outstanding_base,
          total_outstanding_base: row.total_outstanding_base,
          // Compatibility aliases are base-denominated during the API migration.
          overdue_outstanding: row.overdue_outstanding_base,
          total_outstanding: row.total_outstanding_base,
          overdue_invoices_count: row.overdue_invoices_count,
          open_invoices_count: row.open_invoices_count,
          weighted_avg_overdue_days: row.weighted_avg_overdue_days,
          relative_lateness_days: row.relative_lateness_days,
          relative_lateness_score: row.relative_lateness_score,
          last_payment_date: row.last_payment_date,
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
          reason: row.reason,
          score_breakdown_lines: row.score_breakdown_lines,
          organisation_base_currency_code: organisationBaseCurrency,
          currency_code: organisationBaseCurrency,
          native_currency_breakdown: row.native_currency_breakdown,
          last_action_type: latestAction?.type ?? null,
          last_action_outcome: latestAction?.outcome ?? null,
          last_action_timestamp: latestAction?.takenAtIso ?? null,
        }
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
      rows: prioritizedRows,
      actionsTakenByCustomerId,
      portfolio:
        currencyHealth.status === 'degraded' && filteredRows.length === 0
          ? null
          : {
              totalOverdueBase: totalOverdueOutstandingBase,
              totalOverdueBaseDecimal: totalOverdueOutstandingBaseDecimal,
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
