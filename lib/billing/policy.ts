export const PAID_SUBSCRIPTION_STATUSES = ['active', 'trialing'] as const

export interface SubscriptionEntitlementInput {
  status: string
  current_period_end: string | null
  stripe_price_id: string | null
}

export interface FreeUsageDecision {
  usageDate: string
  usageDateConsumed: boolean
  usageDaysConsumed: number
  usageDaysRemaining: number
  canUseFreeAllowance: boolean
}

export function getUtcUsageDate(now: Date) {
  if (Number.isNaN(now.getTime())) {
    throw new Error('Cannot derive a billing usage date from an invalid clock value')
  }

  return now.toISOString().slice(0, 10)
}

export function getConfiguredPaidPriceIds(
  environment: Record<string, string | undefined> = process.env
) {
  return new Set(
    [environment.STRIPE_PRICE_ID_BASIC, environment.STRIPE_PRICE_ID_PRO]
      .map((value) => value?.trim() ?? '')
      .filter((value) => value.length > 0)
  )
}

export function isSubscriptionPaid(params: {
  subscription: SubscriptionEntitlementInput | null | undefined
  now: Date
  paidPriceIds: ReadonlySet<string>
}) {
  const { subscription, now, paidPriceIds } = params
  if (!subscription) return false
  if (!(PAID_SUBSCRIPTION_STATUSES as readonly string[]).includes(subscription.status)) {
    return false
  }

  const priceId = subscription.stripe_price_id?.trim() ?? ''
  if (!priceId || !paidPriceIds.has(priceId)) return false
  if (!subscription.current_period_end) return false

  const periodEnd = new Date(subscription.current_period_end)
  if (Number.isNaN(periodEnd.getTime()) || Number.isNaN(now.getTime())) return false

  return periodEnd.getTime() > now.getTime()
}

export function decideFreeUsage(params: {
  usageDates: Iterable<string>
  tenantUsageDates?: Iterable<string>
  usageDate: string
  freeUsageDaysLimit: number
}): FreeUsageDecision {
  const distinctUsageDates = new Set(params.usageDates)
  const distinctTenantUsageDates = new Set(params.tenantUsageDates ?? [])
  const usageDaysConsumed = Math.max(
    distinctUsageDates.size,
    distinctTenantUsageDates.size
  )
  const userUsageDateConsumed = distinctUsageDates.has(params.usageDate)
  const tenantUsageDateConsumed = distinctTenantUsageDates.has(params.usageDate)
  const usageDateConsumed = userUsageDateConsumed || tenantUsageDateConsumed

  return {
    usageDate: params.usageDate,
    usageDateConsumed,
    usageDaysConsumed,
    usageDaysRemaining: Math.max(0, params.freeUsageDaysLimit - usageDaysConsumed),
    canUseFreeAllowance:
      (userUsageDateConsumed || distinctUsageDates.size < params.freeUsageDaysLimit) &&
      (tenantUsageDateConsumed || distinctTenantUsageDates.size < params.freeUsageDaysLimit),
  }
}
