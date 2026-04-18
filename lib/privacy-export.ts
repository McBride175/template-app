import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getSafeAuthUser } from '@/lib/privacy-utils.js'

export async function buildUserExportBundle(userId: string) {
  const admin = createSupabaseAdminClient()

  const [authUserResult, preferencesResult, notesResult, subscriptionsResult, stripeCustomersResult, supportTicketsResult] =
    await Promise.all([
      admin.auth.admin.getUserById(userId),
      admin
        .from('user_privacy_preferences')
        .select('processing_restricted, marketing_opt_out, analytics_opt_out, ai_processing_opt_out, created_at, updated_at')
        .eq('user_id', userId)
        .maybeSingle(),
      admin
        .from('notes')
        .select('id, content, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      admin
        .from('subscriptions')
        .select('stripe_customer_id, stripe_subscription_id, stripe_price_id, status, current_period_end, created_at, updated_at')
        .eq('user_id', userId),
      admin
        .from('stripe_customers')
        .select('stripe_customer_id, created_at')
        .eq('user_id', userId),
      admin
        .from('support_tickets')
        .select('id, email, subject, message, status, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
    ])

  if (authUserResult.error) {
    throw authUserResult.error
  }

  if (preferencesResult.error) throw preferencesResult.error
  if (notesResult.error) throw notesResult.error
  if (subscriptionsResult.error) throw subscriptionsResult.error
  if (stripeCustomersResult.error) throw stripeCustomersResult.error
  if (supportTicketsResult.error) throw supportTicketsResult.error

  const safeAuthUser = getSafeAuthUser(authUserResult.data.user)

  return {
    generatedAt: new Date().toISOString(),
    user: safeAuthUser,
    data: {
      privacy_preferences: preferencesResult.data,
      notes: notesResult.data ?? [],
      subscriptions: subscriptionsResult.data ?? [],
      stripe_customers: stripeCustomersResult.data ?? [],
      support_tickets: supportTicketsResult.data ?? [],
    },
    metadata: {
      formatVersion: '1.0',
      pathPrefix: `exports/${userId}/`,
      includes: [
        'auth_user_safe_fields',
        'user_privacy_preferences',
        'notes',
        'subscriptions',
        'stripe_customers',
        'support_tickets',
      ],
      excludes: [
        'password_hash',
        'api_keys',
        'auth_tokens',
        'service_role_secrets',
      ],
    },
  }
}
