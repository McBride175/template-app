import 'server-only'

import type Stripe from 'stripe'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type AdminSupabaseClient = ReturnType<typeof createSupabaseAdminClient>

function asStripeId(value: string | { id: string } | null) {
  if (typeof value === 'string') return value
  return value?.id ?? null
}

export async function ensureStripeCustomerMapping(params: {
  supabaseAdmin: AdminSupabaseClient
  customerId: string
  userId: string
}) {
  const loadExisting = async () =>
    params.supabaseAdmin
      .from('stripe_customers')
      .select('user_id')
      .eq('stripe_customer_id', params.customerId)
      .maybeSingle<{ user_id: string }>()

  const { data: existing, error: lookupError } = await loadExisting()
  if (lookupError) {
    throw new Error(`Failed to resolve Stripe customer owner: ${lookupError.message}`)
  }
  if (existing) {
    if (existing.user_id !== params.userId) {
      throw new Error('Stripe customer is already associated with a different user')
    }
    return
  }

  const { error: insertError } = await params.supabaseAdmin
    .from('stripe_customers')
    .insert({
      stripe_customer_id: params.customerId,
      user_id: params.userId,
    })

  if (!insertError) return
  if (insertError.code !== '23505') {
    throw new Error(`Failed to store Stripe customer owner: ${insertError.message}`)
  }

  const { data: racedOwner, error: racedLookupError } = await loadExisting()
  if (racedLookupError || racedOwner?.user_id !== params.userId) {
    throw new Error('Stripe customer ownership changed during checkout')
  }
}

export async function resolveStripeSubscriptionUser(params: {
  supabaseAdmin: AdminSupabaseClient
  subscription: Stripe.Subscription
  userHint?: string | null
}) {
  const customerId = asStripeId(params.subscription.customer)
  if (!customerId) return null

  const { data: customerMapping, error: customerMappingError } = await params.supabaseAdmin
    .from('stripe_customers')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle<{ user_id: string }>()

  if (customerMappingError) {
    throw new Error(`Failed to resolve Stripe customer mapping: ${customerMappingError.message}`)
  }

  if (customerMapping?.user_id) {
    if (params.userHint && customerMapping.user_id !== params.userHint) {
      throw new Error('Stripe checkout user does not own the session customer')
    }
    return customerMapping.user_id
  }

  const { data: existingSubscription, error: subscriptionLookupError } =
    await params.supabaseAdmin
      .from('subscriptions')
      .select('user_id')
      .eq('stripe_subscription_id', params.subscription.id)
      .maybeSingle<{ user_id: string }>()

  if (subscriptionLookupError) {
    throw new Error(`Failed to resolve Stripe subscription owner: ${subscriptionLookupError.message}`)
  }

  if (
    params.userHint &&
    existingSubscription?.user_id &&
    existingSubscription.user_id !== params.userHint
  ) {
    throw new Error('Stripe checkout user does not own the session subscription')
  }

  return existingSubscription?.user_id ?? params.userHint ?? null
}

export async function applyStripeSubscriptionCache(params: {
  supabaseAdmin: AdminSupabaseClient
  subscription: Stripe.Subscription
  userId: string
}) {
  const customerId = asStripeId(params.subscription.customer)
  if (!customerId) {
    throw new Error('Stripe subscription has no customer ID')
  }

  const primaryItem = params.subscription.items.data[0]
  const priceId = primaryItem?.price.id ?? null
  const periodEndSeconds = primaryItem?.current_period_end
  const currentPeriodEnd = periodEndSeconds
    ? new Date(periodEndSeconds * 1000).toISOString()
    : null
  const subscriptionCreatedAt = new Date(params.subscription.created * 1000).toISOString()

  const { data: applied, error } = await params.supabaseAdmin.rpc(
    'apply_stripe_subscription_cache',
    {
      p_user_id: params.userId,
      p_stripe_customer_id: customerId,
      p_stripe_subscription_id: params.subscription.id,
      p_stripe_price_id: priceId,
      p_status: params.subscription.status,
      p_current_period_end: currentPeriodEnd,
      p_stripe_subscription_created_at: subscriptionCreatedAt,
    }
  )

  if (error) {
    throw new Error(`Failed to update subscription cache: ${error.message}`)
  }

  await ensureStripeCustomerMapping({
    supabaseAdmin: params.supabaseAdmin,
    customerId,
    userId: params.userId,
  })

  return {
    applied: applied === true,
    customerId,
    currentPeriodEnd,
    priceId,
  }
}
