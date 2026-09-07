import 'server-only'

import { FREE_USAGE_DAYS } from '@/lib/billing/config'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import {
  decideFreeUsage,
  getConfiguredPaidPriceIds,
  getUtcUsageDate,
  isSubscriptionPaid,
  type SubscriptionEntitlementInput,
} from '@/lib/billing/policy'

type BillingPlan = 'free' | 'paid'

interface SubscriptionRow {
  status: string
  current_period_end: string | null
  stripe_price_id: string | null
}

interface XeroConnectionPublicRow {
  tenant_id: string
  auth_state: 'active' | 'reauth_required' | 'disconnected' | 'error'
  updated_at: string
}

type ServerSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>
type AdminSupabaseClient = ReturnType<typeof createSupabaseAdminClient>

export interface ActionsEntitlementStatus {
  plan: BillingPlan
  isPaid: boolean
  tenantId: string | null
  usageDaysConsumed: number
  usageDaysRemaining: number | null
  freeUsageDaysLimit: number
  hasActionsAccess: boolean
  usageDate: string
  usageDateConsumed: boolean
}

function buildEntitlementStatus(params: {
  isPaid: boolean
  tenantId: string | null
  usageDaysConsumed: number
  usageDate: string
  usageDateConsumed: boolean
  hasFreeUsageAccess: boolean
}): ActionsEntitlementStatus {
  const plan: BillingPlan = params.isPaid ? 'paid' : 'free'
  const usageDaysRemaining = params.isPaid
    ? null
    : Math.max(0, FREE_USAGE_DAYS - params.usageDaysConsumed)
  const hasActionsAccess = Boolean(
    params.tenantId &&
      (params.isPaid || params.hasFreeUsageAccess)
  )

  return {
    plan,
    isPaid: params.isPaid,
    tenantId: params.tenantId,
    usageDaysConsumed: params.usageDaysConsumed,
    usageDaysRemaining,
    freeUsageDaysLimit: FREE_USAGE_DAYS,
    hasActionsAccess,
    usageDate: params.usageDate,
    usageDateConsumed: params.usageDateConsumed,
  }
}

async function loadUsageDates(params: {
  column: 'user_id' | 'tenant_id'
  value: string
  supabaseAdmin: AdminSupabaseClient
}) {
  const { data, error } = await params.supabaseAdmin
    .from('billing_usage_days')
    .select('usage_date')
    .eq(params.column, params.value)

  if (error) {
    throw new Error(`Failed to load billing usage days: ${error.message}`)
  }

  return ((data ?? []) as Array<{ usage_date: string }>).map((row) => row.usage_date)
}

async function resolveConnectedXeroTenantId(
  supabase: ServerSupabaseClient,
  userId: string,
  preferredTenantId?: string | null
) {
  const { data: publicConnectionRowsData, error: publicConnectionError } = await supabase
    .from('xero_connections_public')
    .select('tenant_id, auth_state, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (publicConnectionError) {
    throw new Error(`Failed to load Xero tenant: ${publicConnectionError.message}`)
  }

  const activeConnections = ((publicConnectionRowsData ?? []) as XeroConnectionPublicRow[])
    .filter((connection) => connection.auth_state === 'active')

  if (preferredTenantId) {
    return activeConnections.find((connection) => connection.tenant_id === preferredTenantId)
      ?.tenant_id ?? null
  }

  return activeConnections[0]?.tenant_id ?? null
}

export async function getActionsEntitlementStatus(params: {
  userId: string
  preferredTenantId?: string | null
  supabase?: ServerSupabaseClient
  supabaseAdmin?: AdminSupabaseClient
  now?: Date
}): Promise<ActionsEntitlementStatus> {
  const supabase = params.supabase ?? (await createServerSupabaseClient())
  const supabaseAdmin = params.supabaseAdmin ?? createSupabaseAdminClient()
  const now = params.now ?? new Date()
  const usageDate = getUtcUsageDate(now)

  const { data: subscription, error: subscriptionError } = await supabase
    .from('subscriptions')
    .select('status, current_period_end, stripe_price_id')
    .eq('user_id', params.userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle<SubscriptionRow>()

  if (subscriptionError && subscriptionError.code !== 'PGRST116') {
    throw new Error(`Failed to load subscription status: ${subscriptionError.message}`)
  }

  const isPaid = isSubscriptionPaid({
    subscription: subscription as SubscriptionEntitlementInput | null,
    now,
    paidPriceIds: getConfiguredPaidPriceIds(),
  })
  const tenantId = await resolveConnectedXeroTenantId(
    supabase,
    params.userId,
    params.preferredTenantId
  )

  // A valid, locally cached paid-through entitlement is sufficient to serve a
  // paying user. Do not make paid access depend on the free-usage ledger also
  // being readable during a partial database failure.
  if (isPaid) {
    return buildEntitlementStatus({
      isPaid: true,
      tenantId,
      usageDaysConsumed: 0,
      usageDate,
      usageDateConsumed: false,
      hasFreeUsageAccess: false,
    })
  }

  const [usageDates, tenantUsageDates] = await Promise.all([
    loadUsageDates({ column: 'user_id', value: params.userId, supabaseAdmin }),
    tenantId
      ? loadUsageDates({ column: 'tenant_id', value: tenantId, supabaseAdmin })
      : Promise.resolve([]),
  ])
  const usageDecision = decideFreeUsage({
    usageDates,
    tenantUsageDates,
    usageDate,
    freeUsageDaysLimit: FREE_USAGE_DAYS,
  })

  return buildEntitlementStatus({
    isPaid,
    tenantId,
    usageDaysConsumed: usageDecision.usageDaysConsumed,
    usageDate,
    usageDateConsumed: usageDecision.usageDateConsumed,
    hasFreeUsageAccess: usageDecision.canUseFreeAllowance,
  })
}

interface BillingUsageClaimRow {
  allowed: boolean
  usage_days_consumed: number
  usage_date_already_recorded: boolean
}

export async function claimActionsEntitlementStatus(params: {
  userId: string
  preferredTenantId?: string | null
  supabase?: ServerSupabaseClient
  supabaseAdmin?: AdminSupabaseClient
  now?: Date
  usageDate?: string
}): Promise<ActionsEntitlementStatus> {
  const supabase = params.supabase ?? (await createServerSupabaseClient())
  const supabaseAdmin = params.supabaseAdmin ?? createSupabaseAdminClient()
  const now = params.now ?? new Date()
  const usageDate = params.usageDate ?? getUtcUsageDate(now)
  const current = await getActionsEntitlementStatus({
    userId: params.userId,
    preferredTenantId: params.preferredTenantId,
    supabase,
    supabaseAdmin,
    now,
  })

  if (current.isPaid || !current.tenantId) return current

  const { data, error } = await supabaseAdmin
    .rpc('claim_billing_usage_day', {
      p_user_id: params.userId,
      p_tenant_id: current.tenantId,
      p_usage_date: usageDate,
      p_free_usage_days_limit: FREE_USAGE_DAYS,
    })
    .single<BillingUsageClaimRow>()

  if (error) {
    throw new Error(`Failed to claim billing usage day: ${error.message}`)
  }

  if (!data) {
    throw new Error('Failed to claim billing usage day: database returned no decision')
  }

  return buildEntitlementStatus({
    isPaid: false,
    tenantId: current.tenantId,
    usageDaysConsumed: data.usage_days_consumed,
    usageDate,
    usageDateConsumed: data.usage_date_already_recorded || data.allowed,
    hasFreeUsageAccess: data.allowed,
  })
}
