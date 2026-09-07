import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import {
  CustomerCollectionsSummaryRow,
  loadCustomerCollectionsSummary,
} from '@/lib/collections/customer-summary'
import { claimActionsEntitlementStatus } from '@/lib/billing/entitlements'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

type SortBy =
  | 'overdue_outstanding'
  | 'total_outstanding'
  | 'oldest_overdue_days'
  | 'customer_name'

type SortDir = 'asc' | 'desc'

function parseLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT
  return Math.min(parsed, MAX_LIMIT)
}

function parseSortBy(value: string | null): SortBy {
  if (value === 'overdue_outstanding') return value
  if (value === 'total_outstanding') return value
  if (value === 'oldest_overdue_days') return value
  if (value === 'customer_name') return value
  return 'overdue_outstanding'
}

function parseSortDir(value: string | null): SortDir {
  return value === 'asc' ? 'asc' : 'desc'
}

function parseOverdueOnly(value: string | null) {
  return value?.trim().toLowerCase() === 'true'
}

function parseTenantId(value: string | null) {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function compareNullableNumber(a: number | null, b: number | null, sortDir: SortDir) {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return sortDir === 'asc' ? a - b : b - a
}

function compareNullableString(a: string | null, b: string | null, sortDir: SortDir) {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  const compared = a.localeCompare(b, undefined, { sensitivity: 'base' })
  return sortDir === 'asc' ? compared : -compared
}

function sortRows(rows: CustomerCollectionsSummaryRow[], sortBy: SortBy, sortDir: SortDir) {
  rows.sort((a, b) => {
    let compared = 0

    if (sortBy === 'customer_name') {
      compared = compareNullableString(a.customer_name, b.customer_name, sortDir)
    } else if (sortBy === 'overdue_outstanding') {
      compared = compareNullableNumber(a.overdue_outstanding, b.overdue_outstanding, sortDir)
    } else if (sortBy === 'total_outstanding') {
      compared = compareNullableNumber(a.total_outstanding, b.total_outstanding, sortDir)
    } else if (sortBy === 'oldest_overdue_days') {
      compared = compareNullableNumber(a.oldest_overdue_days, b.oldest_overdue_days, sortDir)
    }

    if (compared !== 0) return compared
    return compareNullableString(a.customer_name, b.customer_name, 'asc')
  })
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
    const overdueOnly = parseOverdueOnly(searchParams.get('overdueOnly'))
    const limit = parseLimit(searchParams.get('limit'))
    const sortBy = parseSortBy(searchParams.get('sortBy'))
    const sortDir = parseSortDir(searchParams.get('sortDir'))
    const requestedTenantId = parseTenantId(searchParams.get('tenantId'))
    const entitlement = await claimActionsEntitlementStatus({
      userId: user.id,
      preferredTenantId: requestedTenantId,
      supabase,
    })
    const tenantId = entitlement.tenantId

    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant context found' }, { status: 400 })
    }
    if (!entitlement.hasActionsAccess) {
      return NextResponse.json(
        { error: 'Free usage allowance exhausted', code: 'ACTION_USAGE_LIMIT_REACHED', entitlement },
        { status: 402 }
      )
    }

    const supabaseAdmin = createSupabaseAdminClient()
    const rows = await loadCustomerCollectionsSummary(supabaseAdmin, user.id, tenantId)

    const filteredRows = overdueOnly
      ? rows.filter((row) => row.overdue_invoices_count > 0)
      : rows

    sortRows(filteredRows, sortBy, sortDir)

    return NextResponse.json({
      ok: true,
      tenantId,
      rows: filteredRows.slice(0, limit),
    })
  } catch (error) {
    console.error('[collections.customers.get] Failed to aggregate collections customers', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ error: 'Failed to load customer collections summary' }, { status: 500 })
  }
}
