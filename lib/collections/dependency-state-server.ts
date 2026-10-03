import 'server-only'

import type { createSupabaseAdminClient } from '@/lib/supabase-admin'

type Admin = ReturnType<typeof createSupabaseAdminClient>

/** Decimal text preserves the full PostgreSQL bigint range across JSON. */
export type CollectionRevision = string
export interface CollectionDependencyScope {
  userId: string
  tenantId: string
  sourceSystem: 'xero'
}
export interface CollectionDependencyState extends CollectionDependencyScope {
  accounting: { mode: 'generation'; generationId: string } | { mode: 'legacy'; generationId: null }
  financialEpoch: CollectionRevision
  projectionRevision: CollectionRevision
  customer: { sourceId: string; financialRevision: CollectionRevision } | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REVISION = /^(0|[1-9]\d*)$/
const MAX_REVISION = BigInt('9223372036854775807')
function revision(value: unknown): CollectionRevision {
  if (typeof value !== 'string' || !REVISION.test(value) || BigInt(value) > MAX_REVISION) {
    throw new Error('Invalid collection dependency revision')
  }
  return value
}

/** Internal only: caller supplies an authenticated/entitled owner and tenant.
 * One statement snapshot reads G/F/P/customer revision, including sparse zeros.
 * Not called on existing page/queue routes. Missing schema/RPC fails explicitly.
 * Legacy accounting has no immutable generation identity and must not be reused
 * as though null were a generation. UTC date and calculation identity remain
 * separate validity inputs in the Phase 3.1 calculation contracts.
 */
export async function readCollectionDependencyState(params: CollectionDependencyScope & {
  admin: Admin
  customerSourceId?: string
}): Promise<CollectionDependencyState> {
  const { admin, userId, tenantId, sourceSystem, customerSourceId } = params
  if (!UUID.test(userId) || !tenantId.trim() || sourceSystem !== 'xero' ||
    (customerSourceId !== undefined && !customerSourceId.trim())) {
    throw new Error('Invalid collection dependency scope')
  }
  const { data, error } = await admin.rpc('read_collection_dependencies', {
    p_user_id: userId,
    p_tenant_id: tenantId,
    p_source_system: sourceSystem,
    p_customer_source_id: customerSourceId ?? null,
  })
  if (error) throw new Error(`Failed to read collection dependencies: ${error.message}`)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Missing collection dependency result')
  }
  const result = data as Record<string, unknown>
  if (result.userId !== userId || result.tenantId !== tenantId || result.sourceSystem !== sourceSystem ||
    result.customerSourceId !== (customerSourceId ?? null)) {
    throw new Error('Collection dependency scope mismatch')
  }
  const generationId = result.generationId
  if (generationId !== null && (typeof generationId !== 'string' || !UUID.test(generationId) || result.generationStatus !== 'succeeded')) {
    throw new Error('Collection accounting generation unavailable')
  }
  if (generationId === null && result.generationStatus !== null) {
    throw new Error('Invalid collection accounting identity')
  }
  return {
    userId, tenantId, sourceSystem,
    accounting: generationId === null ? { mode: 'legacy', generationId: null } : { mode: 'generation', generationId },
    financialEpoch: revision(result.financialEpoch),
    projectionRevision: revision(result.projectionRevision),
    customer: customerSourceId === undefined ? null : {
      sourceId: customerSourceId,
      financialRevision: revision(result.customerFinancialRevision),
    },
  }
}
