import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import {
  CustomerCollectionsSummaryRow,
  loadCustomerCollectionsSummaryWithMetadata,
} from '@/lib/collections/customer-summary'
import { claimActionsEntitlementStatus } from '@/lib/billing/entitlements'
import {
  MULTI_CURRENCY_REQUIRES_PRO_CODE,
  resolveCollectionsCurrencyAccess,
} from '@/lib/billing/collections-access'
import { logCollectionsCurrencyHealth } from '@/lib/collections/currency-health'
import { compareDecimalValues } from '@/lib/money/currency'
import { loadCollectionsCurrencyContext } from '@/lib/collections/currency-context-server'
import { resolveXeroAuthoritativeSnapshot } from '@/lib/xero/authoritative-snapshot'
import { isMissingRelationError } from '@/lib/collections/tenant-context'
import {
  DEFAULT_FOUNDER_CONTEXT_LEVEL,
  type FounderContextLevel,
} from '@/lib/collections/founder-context'
import { ensureCustomerFinancialFeaturesForPortfolioWithIdentity,
  CustomerMaterializationNotReady } from '@/lib/collections/customer-materialization-server'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type SortBy =
  | 'overdue_outstanding'
  | 'total_outstanding'
  | 'oldest_overdue_days'
  | 'customer_name'

type SortDir = 'asc' | 'desc'

interface CustomerOverrideRow {
  customer_source_id: string
  override_level: FounderContextLevel
}

function parseFounderContextLevel(value: unknown): FounderContextLevel {
  if (value === 'priority' || value === 'safe' || value === 'do_not_chase') return value
  return DEFAULT_FOUNDER_CONTEXT_LEVEL
}

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

function compareBaseDecimal(a: string | null, b: string | null, sortDir: SortDir) {
  // An unavailable gross balance is never a zero balance or a known subtotal.
  if (a === null) return b === null ? 0 : 1
  if (b === null) return -1
  const compared = compareDecimalValues(a, b) ?? 0
  return sortDir === 'asc' ? compared : -compared
}

function sortRows(rows: CustomerCollectionsSummaryRow[], sortBy: SortBy, sortDir: SortDir) {
  rows.sort((a, b) => {
    let compared = 0

    if (sortBy === 'customer_name') {
      compared = compareNullableString(a.customer_name, b.customer_name, sortDir)
    } else if (sortBy === 'overdue_outstanding') {
      compared = compareBaseDecimal(
        a.overdue_outstanding_base_decimal,
        b.overdue_outstanding_base_decimal,
        sortDir
      )
    } else if (sortBy === 'total_outstanding') {
      compared = compareBaseDecimal(
        a.total_outstanding_base_decimal,
        b.total_outstanding_base_decimal,
        sortDir
      )
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
    const requestedCustomerSourceId = parseTenantId(searchParams.get('customerSourceId'))
    const scopedCustomerSourceId = parseTenantId(searchParams.get('scopeCustomerSourceId'))
    if (scopedCustomerSourceId && !requestedTenantId) return NextResponse.json({ error: 'Tenant is required.' }, { status: 400 })
    const entitlement = await claimActionsEntitlementStatus({
      userId: user.id,
      preferredTenantId: requestedTenantId,
      supabase,
    })
    const tenantId = entitlement.tenantId

    if (scopedCustomerSourceId && entitlement.tenantId !== requestedTenantId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
    const heldSnapshot = scopedCustomerSourceId ? await resolveXeroAuthoritativeSnapshot({ supabaseAdmin, userId: user.id, tenantId }) : undefined
    // A scoped refresh must not weaken the tenant-wide gross currency entitlement boundary.
    const grossCurrencyContext = heldSnapshot ? await loadCollectionsCurrencyContext({ supabaseAdmin, userId: user.id, tenantId, snapshot: heldSnapshot }) : null
    let summaryResult
    if (!scopedCustomerSourceId) {
      try {
        const certified = await ensureCustomerFinancialFeaturesForPortfolioWithIdentity({
          admin: supabaseAdmin, userId: user.id, tenantId, sourceSystem: 'xero',
          evaluationInstant: new Date(),
        })
        summaryResult = { ...certified.result,
          snapshot: { mode: 'generation' as const, syncRunId: certified.identity.generationId } }
      } catch (cause) {
        const missingSchema = cause instanceof Error &&
          (cause.message.includes('PGRST202') || cause.message.includes('42883') ||
            cause.message.includes('Could not find the function'))
        if (!(cause instanceof CustomerMaterializationNotReady &&
          (cause.reason === 'legacy' ||
            (cause.reason === 'scope' && !UUID.test(user.id)))) &&
          !missingSchema) throw cause
      }
    }
    summaryResult ??= await loadCustomerCollectionsSummaryWithMetadata(supabaseAdmin, user.id, tenantId,
      scopedCustomerSourceId && heldSnapshot ? { customerSourceId: scopedCustomerSourceId, snapshot: heldSnapshot } : undefined)
    const {
      rows,
      organisationBaseCurrency,
      currencyHealth,
      currencyEvaluation,
      currencyContext: summaryCurrencyContext,
      reviewRequiredCustomers,
      snapshot,
    } = summaryResult
    const currencyContext = grossCurrencyContext ?? summaryCurrencyContext
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

    logCollectionsCurrencyHealth({
      route: 'collections.customers.get',
      accountId: user.id,
      tenantId,
      evaluation: currencyEvaluation,
    })

    if (currencyHealth.status === 'unavailable' || !organisationBaseCurrency) {
      return NextResponse.json({
        ok: true,
        tenantId,
        currencyContext,
        currencyAccess,
        organisationBaseCurrency,
        currencyHealth,
        reviewRequiredCustomers,
        snapshot,
        rows: [],
      })
    }

    let overrideQuery = supabaseAdmin
      .from('customer_overrides')
      .select('customer_source_id, override_level')
      .eq('user_id', user.id)
      .eq('tenant_id', tenantId)
    if (scopedCustomerSourceId) overrideQuery = overrideQuery.eq('customer_source_id', scopedCustomerSourceId)
    const { data: overrideRows, error: overrideError } = await overrideQuery

    if (overrideError) {
      if (isMissingRelationError(overrideError, 'customer_overrides')) {
        return NextResponse.json(
          { error: 'Customer context is unavailable until database migrations are applied.' },
          { status: 503 }
        )
      }
      throw overrideError
    }

    const overrideLevelByCustomerSourceId = new Map(
      ((overrideRows ?? []) as CustomerOverrideRow[]).map((row) => [
        row.customer_source_id,
        parseFounderContextLevel(row.override_level),
      ])
    )

    // This customer accounting list retains its gross overdue filter. The
    // actions queue separately filters for collectible overdue debt.
    const filteredRows = overdueOnly
      ? rows.filter((row) => row.overdue_invoices_count > 0)
      : rows

    sortRows(filteredRows, sortBy, sortDir)

    // A recommendation can link to a customer beyond the first list page.
    // Include that owned customer from the same authoritative summary.
    const pageRows = filteredRows.slice(0, limit)
    if (requestedCustomerSourceId &&
      !pageRows.some((row) => row.customer_source_id === requestedCustomerSourceId)) {
      const requestedRow = filteredRows.find((row) => row.customer_source_id === requestedCustomerSourceId)
      if (requestedRow) pageRows.push(requestedRow)
    }

    return NextResponse.json({
      ok: true,
      tenantId,
      currencyContext,
      currencyAccess,
      organisationBaseCurrency,
      currencyHealth,
      reviewRequiredCustomers,
      snapshot,
      rows: pageRows.map((row) => ({
        ...row,
        override_level:
          overrideLevelByCustomerSourceId.get(row.customer_source_id) ??
          DEFAULT_FOUNDER_CONTEXT_LEVEL,
      })),
    })
  } catch (error) {
    console.error('[collections.customers.get] Failed to aggregate collections customers', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ error: 'Failed to load customer collections summary' }, { status: 500 })
  }
}
