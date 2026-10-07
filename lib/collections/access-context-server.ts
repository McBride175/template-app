import 'server-only'
import type { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type { createServerSupabaseClient } from '@/lib/supabase-server'
import { buildEntitlementStatus, claimActionsEntitlementStatus } from '@/lib/billing/entitlements'
import { FREE_USAGE_DAYS } from '@/lib/billing/config'
import { getConfiguredPaidPriceIds, getUtcUsageDate, isSubscriptionPaid,
  resolveConfiguredPaidPlan, type SubscriptionEntitlementInput } from '@/lib/billing/policy'
import type { XeroSnapshotReference } from '@/lib/xero/authoritative-snapshot'
import type { CollectionsCurrencyContext } from '@/lib/collections/currency-context'

type Admin = ReturnType<typeof createSupabaseAdminClient>
export interface CollectionAccessDatabaseContext {
  userId: string; sourceSystem: 'xero';
  subscription: SubscriptionEntitlementInput | null; paid: boolean;
  connection: { tenant_id: string; tenant_name: string | null;
    auth_state: 'active' | 'reauth_required' | 'disconnected' | 'error';
    last_refresh_error: string | null; grant_id: string | null; reauth_required_at: string | null } | null;
  grantScopes: string[] | null; snapshot: XeroSnapshotReference | null;
  lastSyncedAt: string | null; invalidSnapshot: boolean; statusUnavailable: boolean;
  latestRun: { id: string; status: string; lease_expires_at: string | null;
    started_at: string; error_code: string | null } | null;
  financialEpoch: string; projectionRevision: string; accessDigest: string;
  userUsageDays: number; usageDateConsumed: boolean;
  organisation: { base_currency_code: string | null; source_timezone: string | null; country_code: string | null } | null;
  currencyPopulation: { relevantInvoiceCount: number; invoicedCurrencies: string[] } | null;
}
export class CollectionAccessSchemaUnavailable extends Error {}

/** Caller supplies userId only after authoritative route/helper getUser().
 * No process cache: every request gets its own coherent database snapshot. */
export async function readCollectionAccessDatabaseContext(params: {
  admin: Admin; userId: string; tenantId: string | null; now: Date;
}): Promise<CollectionAccessDatabaseContext> {
  const { data, error } = await params.admin.rpc('read_collection_access_context', {
    p_user_id: params.userId, p_tenant_id: params.tenantId,
    p_usage_date: getUtcUsageDate(params.now), p_paid_price_ids: [...getConfiguredPaidPriceIds()],
    p_now: params.now.toISOString(), p_source_system: 'xero',
  })
  if (error?.code === 'PGRST202' || error?.code === '42883') throw new CollectionAccessSchemaUnavailable()
  if (error || !data || data.userId !== params.userId || data.sourceSystem !== 'xero' ||
    !/^(0|[1-9]\d*)$/.test(data.financialEpoch) || !/^(0|[1-9]\d*)$/.test(data.projectionRevision)) {
    throw new Error('Collection access context unavailable')
  }
  return data as CollectionAccessDatabaseContext
}

export function collectionAccessCurrencyContext(context: CollectionAccessDatabaseContext): CollectionsCurrencyContext {
  const p = context.currencyPopulation
  if (context.invalidSnapshot || !p || !Array.isArray(p.invoicedCurrencies) ||
    !Number.isSafeInteger(p.relevantInvoiceCount) || p.relevantInvoiceCount < 0) {
    throw new Error('Collection currency context unavailable')
  }
  return { ...p, mode: p.invoicedCurrencies.length > 1 ? 'multi_currency' : 'single_currency' }
}

export async function claimCollectionAccess(params: {
  admin: Admin; supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  userId: string; tenantId: string | null; now?: Date;
}) {
  const now = params.now ?? new Date(), usageDate = getUtcUsageDate(now)
  let context: CollectionAccessDatabaseContext
  try { context = await readCollectionAccessDatabaseContext({ ...params, now }) }
  catch (error) {
    if (!(error instanceof CollectionAccessSchemaUnavailable)) throw error
    // Explicit ordered-rollout compatibility only; transport/security errors
    // never silently grant access or downgrade invalid accounting.
    return { context: null, entitlement: await claimActionsEntitlementStatus({
      userId: params.userId, preferredTenantId: params.tenantId, supabase: params.supabase,
      supabaseAdmin: params.admin, now }) }
  }
  const paid = isSubscriptionPaid({ subscription: context.subscription, now, paidPriceIds: getConfiguredPaidPriceIds() })
  if (paid !== context.paid) throw new Error('Collection entitlement mismatch')
  const tenantId = context.connection?.auth_state === 'active' &&
    (!params.tenantId || params.tenantId === context.connection.tenant_id) ? context.connection.tenant_id : null
  let claim: { allowed: boolean; usage_days_consumed: number; usage_date_already_recorded: boolean } | null = null
  if (!paid && tenantId) {
    // Independent commit remains even if the later business command fails.
    const { data, error } = await params.admin.rpc('claim_billing_usage_day', {
      p_user_id: params.userId, p_tenant_id: tenantId, p_usage_date: usageDate,
      p_free_usage_days_limit: FREE_USAGE_DAYS,
    })
    claim = (Array.isArray(data) ? data[0] : data) ?? null
    if (error || !claim) throw new Error('Collection usage claim unavailable')
  }
  return { context, entitlement: buildEntitlementStatus({
    isPaid: paid, paidPlan: paid ? resolveConfiguredPaidPlan(context.subscription?.stripe_price_id) : null,
    tenantId, usageDaysConsumed: paid ? 0 : claim?.usage_days_consumed ?? context.userUsageDays, usageDate,
    usageDateConsumed: paid ? false : claim ? Boolean(claim.allowed || claim.usage_date_already_recorded) : context.usageDateConsumed,
    hasFreeUsageAccess: Boolean(claim?.allowed),
  }) }
}
