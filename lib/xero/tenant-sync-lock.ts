import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { XERO_AUTO_SYNC_LOCK_TTL_SECONDS } from '@/lib/xero/auto-sync'

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>

interface TenantSyncLockParams {
  userId: string
  tenantId: string
  lockId: string
  supabaseAdmin?: SupabaseAdminClient
}

interface TenantSyncLockResult {
  acquired: boolean
  error: Error | null
}

export async function acquireXeroTenantSyncLock(
  params: TenantSyncLockParams
): Promise<TenantSyncLockResult> {
  const supabaseAdmin = params.supabaseAdmin ?? createSupabaseAdminClient()
  const { data, error } = await supabaseAdmin.rpc('acquire_xero_tenant_auto_sync_lock', {
    p_user_id: params.userId,
    p_tenant_id: params.tenantId,
    p_lock_id: params.lockId,
    p_ttl_seconds: XERO_AUTO_SYNC_LOCK_TTL_SECONDS,
  })

  return {
    acquired: Boolean(data),
    error: error
      ? new Error(error.message)
      : null,
  }
}

export async function releaseXeroTenantSyncLock(params: TenantSyncLockParams) {
  const supabaseAdmin = params.supabaseAdmin ?? createSupabaseAdminClient()
  const { error } = await supabaseAdmin.rpc('release_xero_tenant_auto_sync_lock', {
    p_user_id: params.userId,
    p_tenant_id: params.tenantId,
    p_lock_id: params.lockId,
  })

  if (error) {
    return new Error(error.message)
  }

  return null
}
