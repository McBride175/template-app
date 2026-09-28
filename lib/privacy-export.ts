import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getSafeAuthUser } from '@/lib/privacy-utils.mjs'

/** Export all owned records, not only the Data API's first page. */
async function promiseExportRows(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string, table: 'invoice_promises' | 'invoice_promise_events', columns: string) {
  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select(columns).eq('user_id', userId)
      .order('id', { ascending: true }).range(from, from + 999)
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('Promise export unavailable')
    rows.push(...data as unknown as Record<string, unknown>[])
    if (data.length < 1000) return rows
  }
}

export async function buildUserExportBundle(userId: string) {
  const admin = createSupabaseAdminClient()

  const [authUserResult, preferencesResult, notesResult, subscriptionsResult, stripeCustomersResult, supportTicketsResult, invoiceDisputesResult, invoicePromises, invoicePromiseEvents] =
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
      admin
        .from('invoice_disputes')
        .select('id, tenant_id, source_system, invoice_source_id, dispute_mode, recorded_disputed_amount_native, amount_due_at_last_review_native, note, is_active, resolved_at, created_at, updated_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      promiseExportRows(admin, userId, 'invoice_promises',
        'id, tenant_id, source_system, invoice_source_id, customer_source_id, currency_code, promised_amount_native::text, promised_date, note, status, qualifying_paid_amount_native::text, created_at, updated_at, resolved_at'),
      promiseExportRows(admin, userId, 'invoice_promise_events',
        'id, promise_id, tenant_id, event_sequence::text, event_type, occurred_at, effective_at, actor_kind, before_terms, after_terms'),
    ])

  if (authUserResult.error) {
    throw authUserResult.error
  }

  if (preferencesResult.error) throw preferencesResult.error
  if (notesResult.error) throw notesResult.error
  if (subscriptionsResult.error) throw subscriptionsResult.error
  if (stripeCustomersResult.error) throw stripeCustomersResult.error
  if (supportTicketsResult.error) throw supportTicketsResult.error
  if (invoiceDisputesResult.error) throw invoiceDisputesResult.error

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
      invoice_disputes: invoiceDisputesResult.data ?? [],
      invoice_promises: invoicePromises,
      invoice_promise_events: invoicePromiseEvents,
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
        'invoice_disputes',
        'invoice_promises',
        'invoice_promise_events',
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
