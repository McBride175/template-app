import type { ActionsEntitlementStatus } from '@/lib/billing/entitlements'
import type { CollectionsCurrencyContext } from '@/lib/collections/currency-context'

export const MULTI_CURRENCY_REQUIRES_PRO_CODE = 'MULTI_CURRENCY_REQUIRES_PRO'

export interface CollectionsCurrencyAccess {
  allowed: boolean
  requiresPro: boolean
  reason: 'allowed' | 'actions_access_required' | 'multi_currency_requires_pro'
}

/**
 * The free allowance evaluates the complete product. Once paid, Basic supports
 * a current single-currency portfolio and Pro supports either currency mode.
 */
export function resolveCollectionsCurrencyAccess(params: {
  entitlement: ActionsEntitlementStatus
  currencyContext: CollectionsCurrencyContext
}): CollectionsCurrencyAccess {
  if (!params.entitlement.hasActionsAccess) {
    return {
      allowed: false,
      requiresPro: false,
      reason: 'actions_access_required',
    }
  }

  if (
    params.currencyContext.mode === 'single_currency' ||
    !params.entitlement.isPaid ||
    params.entitlement.paidPlan === 'pro'
  ) {
    return {
      allowed: true,
      requiresPro: false,
      reason: 'allowed',
    }
  }

  return {
    allowed: false,
    requiresPro: true,
    reason: 'multi_currency_requires_pro',
  }
}
