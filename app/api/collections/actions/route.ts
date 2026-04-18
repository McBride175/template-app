import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { loadCustomerCollectionsSummary } from '@/lib/collections/customer-summary'
import {
  type CustomerOverrideLevel,
  prioritiseCustomer,
} from '@/lib/collections/prioritization'
import {
  isMissingRelationError,
  resolveCollectionsTenantId,
} from '@/lib/collections/tenant-context'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const DEFAULT_OVERRIDE_LEVEL: CustomerOverrideLevel = 'normal'

interface CustomerOverrideRow {
  customer_source_id: string
  override_level: CustomerOverrideLevel
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

    const tenantId = await resolveCollectionsTenantId(supabase, user.id, requestedTenantId)
    const overrideLevelByCustomerSourceId = new Map<string, CustomerOverrideLevel>()

    if (tenantId) {
      const { data: overrideRows, error: overrideError } = await supabase
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
    }

    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant context found' }, { status: 400 })
    }

    const summaryRows = await loadCustomerCollectionsSummary(supabase, user.id, tenantId)

    const filteredRows = overdueOnly
      ? summaryRows.filter((row) => row.overdue_outstanding > 0)
      : summaryRows
    const overdueRows = filteredRows.filter((row) => row.overdue_outstanding > 0)
    const totalOverdueOutstanding = filteredRows.reduce(
      (sum, row) => sum + Math.max(0, row.overdue_outstanding),
      0
    )
    const maxOverdueOutstanding = filteredRows.reduce(
      (max, row) => Math.max(max, Math.max(0, row.overdue_outstanding)),
      0
    )
    const overallWeightedAvgOverdueDays =
      totalOverdueOutstanding > 0
        ? overdueRows.reduce(
            (sum, row) =>
              sum + Math.max(0, row.weighted_avg_overdue_days) * Math.max(0, row.overdue_outstanding),
            0
          ) / totalOverdueOutstanding
        : 0
    const maxWeightedAvgOverdueDays = overdueRows.reduce(
      (max, row) => Math.max(max, Math.max(0, row.weighted_avg_overdue_days)),
      0
    )

    const prioritizedRows = filteredRows
      .map((row) =>
        prioritiseCustomer(
          {
            customer_source_id: row.customer_source_id,
            customer_name: row.customer_name,
            customer_email: row.customer_email,
            overdue_outstanding: row.overdue_outstanding,
            total_outstanding: row.total_outstanding,
            overdue_invoices_count: row.overdue_invoices_count,
            open_invoices_count: row.open_invoices_count,
            weighted_avg_overdue_days: row.weighted_avg_overdue_days,
            last_payment_date: row.last_payment_date,
            last_payment_days_ago: row.last_payment_days_ago,
            has_recent_partial_payment: row.has_recent_partial_payment,
            currency_code: row.currency_code,
          },
          {
            totalOverdueOutstanding,
            maxOverdueOutstanding,
            overallWeightedAvgOverdueDays,
            maxWeightedAvgOverdueDays,
          },
          overrideLevelByCustomerSourceId.get(row.customer_source_id) ?? DEFAULT_OVERRIDE_LEVEL
        )
      )
      .sort((a, b) => {
        const aDoNotChase = a.override_level === 'do_not_chase'
        const bDoNotChase = b.override_level === 'do_not_chase'
        if (aDoNotChase !== bDoNotChase) {
          return aDoNotChase ? 1 : -1
        }

        if (b.priority_score !== a.priority_score) {
          return b.priority_score - a.priority_score
        }

        if (b.overdue_outstanding !== a.overdue_outstanding) {
          return b.overdue_outstanding - a.overdue_outstanding
        }

        return a.customer_name.localeCompare(b.customer_name, undefined, {
          sensitivity: 'base',
        })
      })
      .slice(0, limit)
      .map((row) => ({
        customer_source_id: row.customer_source_id,
        customer_name: row.customer_name,
        customer_email: row.customer_email,
        overdue_outstanding: row.overdue_outstanding,
        total_outstanding: row.total_outstanding,
        overdue_invoices_count: row.overdue_invoices_count,
        open_invoices_count: row.open_invoices_count,
        weighted_avg_overdue_days: row.weighted_avg_overdue_days,
        last_payment_date: row.last_payment_date,
        override_level: row.override_level,
        override_multiplier: row.override_multiplier,
        base_score: row.base_score,
        final_score: row.final_score,
        priority_score: row.priority_score,
        recommended_action: row.recommended_action,
        reason: row.reason,
        score_breakdown_lines: row.score_breakdown_lines,
        currency_code: row.currency_code ?? null,
      }))

    return NextResponse.json({
      ok: true,
      tenantId,
      rows: prioritizedRows,
    })
  } catch (error) {
    console.error('[collections.actions.get] Failed to load prioritised collection actions', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return NextResponse.json({ error: 'Failed to load prioritised collection actions' }, { status: 500 })
  }
}
