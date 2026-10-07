import { claimCollectionAccess } from '@/lib/collections/access-context-server'
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { resolveCollectionsCurrencyAccess, MULTI_CURRENCY_REQUIRES_PRO_CODE } from '@/lib/billing/collections-access'
import { CustomerDetailBootstrapUnavailable, readCustomerDetailBootstrap } from '@/lib/collections/customer-detail-bootstrap-server'
import { loadCustomerCollectionsSummaryWithMetadata } from '@/lib/collections/customer-summary'
import { loadCollectionsCurrencyContext } from '@/lib/collections/currency-context-server'
import { loadCustomerInvoiceDisputes } from '@/lib/collections/invoice-disputes-server'
import { resolveXeroAuthoritativeSnapshot } from '@/lib/xero/authoritative-snapshot'
import { DEFAULT_FOUNDER_CONTEXT_LEVEL } from '@/lib/collections/founder-context'

function identity(value: string | null) { return value?.trim() || null }

export async function GET(request: NextRequest) {
  const started = performance.now()
  const customerSourceId = identity(request.nextUrl.searchParams.get('customerSourceId'))
  const requestedTenantId = identity(request.nextUrl.searchParams.get('tenantId'))
  if (!customerSourceId) return NextResponse.json({ error: 'Customer is required.' }, { status: 400 })
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const accessAdmin = createSupabaseAdminClient()
    const access = await claimCollectionAccess({
      admin: accessAdmin, userId: user.id, tenantId: requestedTenantId, supabase,
    })
    const entitlement = access.entitlement
    const tenantId = entitlement.tenantId
    if (!tenantId || (requestedTenantId && requestedTenantId !== tenantId)) {
      return NextResponse.json({ error: 'Tenant is unavailable.' }, { status: 403 })
    }
    if (!entitlement.hasActionsAccess) return NextResponse.json({
      error: 'Free usage allowance exhausted', code: 'ACTION_USAGE_LIMIT_REACHED', entitlement,
    }, { status: 402 })
    const accessMs = performance.now() - started
    const admin = accessAdmin
    let detail
    try {
      detail = await readCustomerDetailBootstrap({ admin, userId: user.id, tenantId,
        customerSourceId, evaluationInstant: new Date() })
    } catch (cause) {
      if (cause instanceof CustomerDetailBootstrapUnavailable && cause.reason === 'missing') {
        return NextResponse.json({ error: 'Customer unavailable', code: 'CUSTOMER_NOT_FOUND' }, { status: 404 })
      }
      if (!(cause instanceof CustomerDetailBootstrapUnavailable) ||
        (cause.reason !== 'schema' && cause.reason !== 'legacy')) throw cause
      // Ordered migration rollout: legacy authority remains available while
      // the disposable materialization schema is absent. Never serve stale G.
      const snapshot = await resolveXeroAuthoritativeSnapshot({ supabaseAdmin: admin,
        userId: user.id, tenantId })
      const [summary, currencyContext, invoices, overrideResult] = await Promise.all([
        loadCustomerCollectionsSummaryWithMetadata(admin, user.id, tenantId,
          { customerSourceId, snapshot }),
        loadCollectionsCurrencyContext({ supabaseAdmin: admin, userId: user.id, tenantId, snapshot }),
        loadCustomerInvoiceDisputes({ tenantId, customerSourceId }),
        admin.from('customer_overrides').select('override_level')
          .eq('user_id', user.id).eq('tenant_id', tenantId)
          .eq('customer_source_id', customerSourceId).maybeSingle(),
      ])
      if (overrideResult.error) throw overrideResult.error
      const after = await resolveXeroAuthoritativeSnapshot({ supabaseAdmin: admin,
        userId: user.id, tenantId })
      if (after.mode !== snapshot.mode || after.syncRunId !== snapshot.syncRunId) {
        throw new CustomerDetailBootstrapUnavailable('preparing')
      }
      const row = summary.rows.find(item => item.customer_source_id === customerSourceId) ?? null
      const reviewRequiredCustomer = summary.reviewRequiredCustomers.find(
        item => item.customer_source_id === customerSourceId) ?? null
      if (!row && !reviewRequiredCustomer) {
        return NextResponse.json({ error: 'Customer unavailable', code: 'CUSTOMER_NOT_FOUND' }, { status: 404 })
      }
      detail = { row: row ? { ...row, override_level:
        overrideResult.data?.override_level ?? DEFAULT_FOUNDER_CONTEXT_LEVEL } : null,
        reviewRequiredCustomer, invoices, currencyContext,
        currencyHealth: summary.currencyHealth,
        organisationBaseCurrency: summary.organisationBaseCurrency,
        version: { generationId: snapshot.mode === 'generation' ? snapshot.syncRunId : null },
        metrics: { roundTrips: null, databaseWaitMs: null, featureRebuilt: true,
          invoiceRows: invoices.length, unrelatedCustomerRows: 0 } }
    }
    const currencyAccess = resolveCollectionsCurrencyAccess({ entitlement,
      currencyContext: detail.currencyContext })
    if (!currencyAccess.allowed) return NextResponse.json({ ok: false,
      code: MULTI_CURRENCY_REQUIRES_PRO_CODE, entitlement,
      currencyContext: detail.currencyContext, currencyAccess }, { status: 402 })
    // Diagnostic fields are timings/counts only; no financial payload is logged.
    const totalMs = performance.now() - started
    return NextResponse.json({ ok: true, tenantId, customerSourceId, entitlement, currencyAccess,
      ...detail, timings: { accessMs, detailMs: totalMs - accessMs, totalMs } })
  } catch (cause) {
    if (cause instanceof CustomerDetailBootstrapUnavailable && cause.reason === 'preparing') {
      return NextResponse.json({ error: 'Customer detail is preparing. Retry shortly.',
        code: 'CUSTOMER_DETAIL_PREPARING' }, { status: 503 })
    }
    console.error('[collections.customer-detail.get] Detail unavailable', {
      error: cause instanceof Error ? cause.message : 'Unknown error',
    })
    return NextResponse.json({ error: 'Customer detail unavailable', code: 'CUSTOMER_DETAIL_UNAVAILABLE' }, { status: 503 })
  }
}
