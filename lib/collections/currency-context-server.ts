import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import {
  deriveCollectionsCurrencyContext,
  type CollectionsCurrencyContextInvoice,
} from '@/lib/collections/currency-context'
import {
  applyXeroAuthoritativeSnapshot,
  assertXeroSnapshotIdentity,
  resolveXeroAuthoritativeSnapshot,
  type XeroAuthoritativeSnapshot,
} from '@/lib/xero/authoritative-snapshot'

const PAGE_SIZE = 1000

type AdminSupabaseClient = ReturnType<typeof createSupabaseAdminClient>

export async function loadCollectionsCurrencyContext(params: {
  supabaseAdmin: AdminSupabaseClient
  userId: string
  tenantId: string
  snapshot?: XeroAuthoritativeSnapshot
}) {
  const snapshot =
    params.snapshot ??
    (await resolveXeroAuthoritativeSnapshot({
      supabaseAdmin: params.supabaseAdmin,
      userId: params.userId,
      tenantId: params.tenantId,
    }))
  assertXeroSnapshotIdentity(snapshot, {
    userId: params.userId,
    tenantId: params.tenantId,
  })
  const invoices: CollectionsCurrencyContextInvoice[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const query = params.supabaseAdmin
      .from('canonical_invoices')
      .select(
        'type, status, customer_source_id, transaction_currency_code, amount_due_native'
      )
      .eq('user_id', snapshot.userId)
      .eq('tenant_id', snapshot.tenantId)
    const { data, error } = await applyXeroAuthoritativeSnapshot(query, snapshot)
      .order('source_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      throw new Error(`Failed to load collections currency context: ${error.message}`)
    }

    const batch = (data ?? []) as CollectionsCurrencyContextInvoice[]
    invoices.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }

  return deriveCollectionsCurrencyContext(invoices)
}
