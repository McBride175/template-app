/**
 * Subscription utility functions
 * 
 * TEMPLATE CODE: Helper functions for checking subscription status
 * 
 * SECURITY: This file MUST NOT be imported in client components.
 * It uses server-only Supabase helpers.
 */
import 'server-only'
import { createServerSupabaseClient } from './supabase-server'
import { getConfiguredPaidPriceIds, isSubscriptionPaid } from './billing/policy'

/**
 * Get the current user's subscription status
 * 
 * TEMPLATE CODE: Returns subscription data for the authenticated user
 * Returns null if user has no subscription
 */
export async function getUserSubscription() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .single()

  return subscription
}

/**
 * Check if user has an active subscription
 * 
 * TEMPLATE CODE: Returns true if user has an active (not cancelled) subscription
 * APP-SPECIFIC: You may want to adjust the status check based on your needs
 */
export async function hasActiveSubscription(): Promise<boolean> {
  const subscription = await getUserSubscription()

  if (!subscription) {
    return false
  }

  return isSubscriptionPaid({
    subscription,
    now: new Date(),
    paidPriceIds: getConfiguredPaidPriceIds(),
  })
}
