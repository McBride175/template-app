import 'server-only'

import { FREE_USAGE_DAYS } from '@/lib/billing/config'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createServerSupabaseClient } from '@/lib/supabase-server'

type BillingPlan = 'free' | 'paid'

interface SubscriptionRow {
  status: string
  current_period_end: string | null
}

interface XeroConnectionPublicRow {
  tenant_id: string
  auth_state: 'active' | 'reauth_required' | 'disconnected' | 'error'
  updated_at: string
}

type ServerSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>

export interface ActionsEntitlementStatus {
  plan: BillingPlan
  isPaid: boolean
  tenantId: string | null
  usageDaysConsumed: number
  usageDaysRemaining: number | null
  freeUsageDaysLimit: number
  hasActionsAccess: boolean
}

export function getTodayUsageDate() {
  return new Date().toISOString().slice(0, 10)
}

function isSubscriptionPaid(subscription: SubscriptionRow | null | undefined) {
  if (!subscription) return false

  const activeStatuses = ['active', 'trialing']
  if (!activeStatuses.includes(subscription.status)) return false

  if (subscription.current_period_end === null) return true

  const periodEnd = new Date(subscription.current_period_end)
  if (Number.isNaN(periodEnd.getTime())) return false

  return periodEnd > new Date()
}

function buildEntitlementStatus(params: {
  isPaid: boolean
  tenantId: string | null
  usageDaysConsumed: number
}): ActionsEntitlementStatus {
  const plan: BillingPlan = params.isPaid ? 'paid' : 'free'
  const usageDaysRemaining = params.isPaid
    ? null
    : Math.max(0, FREE_USAGE_DAYS - params.usageDaysConsumed)
  const hasActionsAccess = Boolean(
    params.tenantId &&
      (params.isPaid || params.usageDaysConsumed < FREE_USAGE_DAYS)
  )

  return {
    plan,
    isPaid: params.isPaid,
    tenantId: params.tenantId,
    usageDaysConsumed: params.usageDaysConsumed,
    usageDaysRemaining,
    freeUsageDaysLimit: FREE_USAGE_DAYS,
    hasActionsAccess,
  }
}

async function loadUsageDaysConsumed(tenantId: string) {
  const supabaseAdmin = createSupabaseAdminClient()
  const { count, error } = await supabaseAdmin
    .from('billing_usage_days')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)

  if (error) {
    throw new Error(`Failed to count billing usage days: ${error.message}`)
  }

  return count ?? 0
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
}): Promise<ActionsEntitlementStatus> {
  const supabase = params.supabase ?? (await createServerSupabaseClient())

  const { data: subscription, error: subscriptionError } = await supabase
    .from('subscriptions')
    .select('status, current_period_end')
    .eq('user_id', params.userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle<SubscriptionRow>()

  if (subscriptionError && subscriptionError.code !== 'PGRST116') {
    throw new Error(`Failed to load subscription status: ${subscriptionError.message}`)
  }

  const isPaid = isSubscriptionPaid(subscription)
  const tenantId = await resolveConnectedXeroTenantId(
    supabase,
    params.userId,
    params.preferredTenantId
  )
  const usageDaysConsumed = tenantId ? await loadUsageDaysConsumed(tenantId) : 0

  return buildEntitlementStatus({
    isPaid,
    tenantId,
    usageDaysConsumed,
  })
}

export async function recordFreeActionsUsageDay(params: {
  tenantId: string
  userId: string
  usageDate?: string
}) {
  const usageDate = params.usageDate ?? getTodayUsageDate()
  const supabaseAdmin = createSupabaseAdminClient()
  const { error } = await supabaseAdmin
    .from('billing_usage_days')
    .upsert(
      {
        tenant_id: params.tenantId,
        usage_date: usageDate,
        user_id: params.userId,
      },
      {
        onConflict: 'tenant_id,usage_date',
        ignoreDuplicates: true,
      }
    )

  if (error) {
    throw new Error(`Failed to record billing usage day: ${error.message}`)
  }

  return getActionsEntitlementStatus({
    userId: params.userId,
    preferredTenantId: params.tenantId,
  })
}
