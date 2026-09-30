import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type Admin = ReturnType<typeof createSupabaseAdminClient>

export interface QueueActionRow {
  customer_source_id: string
  action_format: 'v1' | 'legacy'
  id: string
  action_type: string
  outcome: string | null
  note: string | null
  next_action_date: string | null
  action_timestamp: string
}

const BATCH_SIZE = 500

/** Required data: an unavailable RPC fails the queue closed, never as "no deferral". */
export async function loadLatestQueueActions(params: {
  admin: Admin
  userId: string
  tenantId: string
  customerSourceIds: string[]
}) {
  const { admin, userId, tenantId } = params
  const customerSourceIds = [...new Set(params.customerSourceIds)]
  const { data: presence, error: presenceError } = await admin
    .from('collection_actions').select('id')
    .eq('user_id', userId).eq('tenant_id', tenantId)
    .eq('source_system', 'xero').limit(1)
  if (presenceError) throw new Error(`Failed to read collection activity: ${presenceError.message}`)

  const rows: QueueActionRow[] = []
  for (let from = 0; from < customerSourceIds.length; from += BATCH_SIZE) {
    const ids = customerSourceIds.slice(from, from + BATCH_SIZE)
    const { data, error } = await admin.rpc('latest_collection_queue_actions', {
      p_user_id: userId,
      p_tenant_id: tenantId,
      p_source_system: 'xero',
      p_customer_source_ids: ids,
    })
    if (error) throw new Error(`Failed to read latest collection actions: ${error.message}`)
    if (!Array.isArray(data)) throw new Error('Latest collection actions returned no result')
    for (const row of data as QueueActionRow[]) {
      if (!ids.includes(row.customer_source_id) ||
          !['v1', 'legacy'].includes(row.action_format) ||
          typeof row.id !== 'string' ||
          typeof row.action_timestamp !== 'string' ||
          (row.action_format === 'v1' &&
            (row.action_type !== 'outcome' || typeof row.next_action_date !== 'string'))) {
        throw new Error('Latest collection actions returned invalid data')
      }
      rows.push(row)
    }
  }
  return { rows, hasPriorActionActivity: (presence?.length ?? 0) > 0 }
}
