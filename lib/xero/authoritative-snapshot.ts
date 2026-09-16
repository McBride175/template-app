import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

const SNAPSHOT_BRAND: unique symbol = Symbol('xero-authoritative-snapshot')

type SupabaseReader = Pick<SupabaseClient, 'from'>

interface TenantStateRow {
  active_sync_run_id: string | null
  last_successful_sync_at: string | null
}

interface SyncRunRow {
  id: string
  user_id: string
  tenant_id: string
  status: string
}

interface RawFreshnessRow {
  fetched_at: string
}

interface SnapshotFilterQuery {
  eq(column: string, value: string): SnapshotFilterQuery
  is(column: string, value: null): SnapshotFilterQuery
}

export type XeroAuthoritativeSnapshot =
  | {
      readonly mode: 'generation'
      readonly syncRunId: string
      readonly userId: string
      readonly tenantId: string
      readonly lastSuccessfulSyncAt: string
      readonly [SNAPSHOT_BRAND]: true
    }
  | {
      readonly mode: 'legacy'
      readonly syncRunId: null
      readonly userId: string
      readonly tenantId: string
      readonly lastSuccessfulSyncAt: null
      readonly [SNAPSHOT_BRAND]: true
    }

export interface XeroSnapshotReference {
  mode: XeroAuthoritativeSnapshot['mode']
  syncRunId: string | null
}

export type XeroAuthoritativeSnapshotErrorCode =
  | 'tenant_state_unavailable'
  | 'tenant_state_inconsistent'
  | 'active_run_unavailable'
  | 'active_run_invalid'
  | 'snapshot_identity_mismatch'
  | 'legacy_freshness_unavailable'

export class XeroAuthoritativeSnapshotError extends Error {
  readonly code: XeroAuthoritativeSnapshotErrorCode

  constructor(code: XeroAuthoritativeSnapshotErrorCode, message: string) {
    super(message)
    this.name = 'XeroAuthoritativeSnapshotError'
    this.code = code
  }
}

function requireIdentity(value: string, field: 'userId' | 'tenantId') {
  const normalized = value.trim()
  if (!normalized) {
    throw new XeroAuthoritativeSnapshotError(
      'snapshot_identity_mismatch',
      `An exact ${field} is required to resolve the authoritative Xero snapshot`
    )
  }
  return normalized
}

function assertTrustedSnapshot(snapshot: XeroAuthoritativeSnapshot) {
  if (!snapshot || snapshot[SNAPSHOT_BRAND] !== true) {
    throw new XeroAuthoritativeSnapshotError(
      'snapshot_identity_mismatch',
      'The Xero snapshot was not produced by the authoritative server resolver'
    )
  }
}

export async function resolveXeroAuthoritativeSnapshot(params: {
  supabaseAdmin: SupabaseReader
  userId: string
  tenantId: string
}): Promise<XeroAuthoritativeSnapshot> {
  const userId = requireIdentity(params.userId, 'userId')
  const tenantId = requireIdentity(params.tenantId, 'tenantId')
  const { data: tenantStateData, error: tenantStateError } = await params.supabaseAdmin
    .from('xero_sync_tenant_state')
    .select('active_sync_run_id, last_successful_sync_at')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .maybeSingle<TenantStateRow>()

  if (tenantStateError) {
    throw new XeroAuthoritativeSnapshotError(
      'tenant_state_unavailable',
      'Failed to resolve the authoritative Xero snapshot'
    )
  }

  if (!tenantStateData) {
    return {
      mode: 'legacy',
      syncRunId: null,
      userId,
      tenantId,
      lastSuccessfulSyncAt: null,
      [SNAPSHOT_BRAND]: true,
    }
  }

  if (!tenantStateData.active_sync_run_id) {
    if (tenantStateData.last_successful_sync_at !== null) {
      throw new XeroAuthoritativeSnapshotError(
        'tenant_state_inconsistent',
        'The Xero active snapshot pointer is inconsistent'
      )
    }

    return {
      mode: 'legacy',
      syncRunId: null,
      userId,
      tenantId,
      lastSuccessfulSyncAt: null,
      [SNAPSHOT_BRAND]: true,
    }
  }

  if (!tenantStateData.last_successful_sync_at) {
    throw new XeroAuthoritativeSnapshotError(
      'tenant_state_inconsistent',
      'The Xero active snapshot is missing its successful promotion timestamp'
    )
  }

  const activeSyncRunId = tenantStateData.active_sync_run_id
  const { data: runData, error: runError } = await params.supabaseAdmin
    .from('xero_sync_runs')
    .select('id, user_id, tenant_id, status')
    .eq('id', activeSyncRunId)
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .maybeSingle<SyncRunRow>()

  if (runError) {
    throw new XeroAuthoritativeSnapshotError(
      'active_run_unavailable',
      'Failed to verify the active Xero generation'
    )
  }

  if (
    !runData ||
    runData.id !== activeSyncRunId ||
    runData.user_id !== userId ||
    runData.tenant_id !== tenantId ||
    runData.status !== 'succeeded'
  ) {
    throw new XeroAuthoritativeSnapshotError(
      'active_run_invalid',
      'The active Xero generation is invalid'
    )
  }

  return {
    mode: 'generation',
    syncRunId: activeSyncRunId,
    userId,
    tenantId,
    lastSuccessfulSyncAt: tenantStateData.last_successful_sync_at,
    [SNAPSHOT_BRAND]: true,
  }
}

export function assertXeroSnapshotIdentity(
  snapshot: XeroAuthoritativeSnapshot,
  identity: { userId: string; tenantId: string }
) {
  assertTrustedSnapshot(snapshot)
  if (snapshot.userId !== identity.userId || snapshot.tenantId !== identity.tenantId) {
    throw new XeroAuthoritativeSnapshotError(
      'snapshot_identity_mismatch',
      'The resolved Xero snapshot does not match the requested tenant identity'
    )
  }
}

export function applyXeroAuthoritativeSnapshot<Query>(
  query: Query,
  snapshot: XeroAuthoritativeSnapshot
): Query {
  assertTrustedSnapshot(snapshot)
  const filterableQuery = query as unknown as SnapshotFilterQuery
  const filtered =
    snapshot.mode === 'generation'
      ? filterableQuery.eq('sync_run_id', snapshot.syncRunId)
      : filterableQuery.is('sync_run_id', null)
  return filtered as unknown as Query
}

export function toXeroSnapshotReference(
  snapshot: XeroAuthoritativeSnapshot
): XeroSnapshotReference {
  assertTrustedSnapshot(snapshot)
  return {
    mode: snapshot.mode,
    syncRunId: snapshot.syncRunId,
  }
}

export async function loadXeroAuthoritativeFreshness(params: {
  supabaseAdmin: SupabaseReader
  snapshot: XeroAuthoritativeSnapshot
}) {
  assertTrustedSnapshot(params.snapshot)
  if (params.snapshot.mode === 'generation') {
    return params.snapshot.lastSuccessfulSyncAt
  }

  const query = params.supabaseAdmin
    .from('xero_raw')
    .select('fetched_at')
    .eq('user_id', params.snapshot.userId)
    .eq('tenant_id', params.snapshot.tenantId)
  const { data, error } = await applyXeroAuthoritativeSnapshot(query, params.snapshot)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle<RawFreshnessRow>()

  if (error) {
    throw new XeroAuthoritativeSnapshotError(
      'legacy_freshness_unavailable',
      'Failed to load legacy Xero freshness'
    )
  }

  return data?.fetched_at ?? null
}
