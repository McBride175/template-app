import 'server-only'

import { createServerSupabaseClient } from '@/lib/supabase-server'

interface XeroConnectionRow {
  tenant_id: string
  auth_state: 'active' | 'reauth_required' | 'disconnected' | 'error'
  updated_at: string
}

interface CanonicalTenantRow {
  tenant_id: string
}

interface SupabaseQueryErrorLike {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
}

type ServerSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>
type CanonicalTenantTable = 'canonical_customers' | 'canonical_invoices' | 'canonical_payments'

export function isMissingRelationError(
  error: SupabaseQueryErrorLike | null | undefined,
  relationName: string
) {
  if (!error) return false

  if (error.code === '42P01' || error.code === 'PGRST205') {
    return true
  }

  const message = [error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()

  if (message.includes('does not exist') && message.includes(relationName.toLowerCase())) {
    return true
  }

  return message.includes('schema cache') && message.includes(relationName.toLowerCase())
}

async function loadLatestCanonicalTenantId(
  supabase: ServerSupabaseClient,
  userId: string,
  tableName: CanonicalTenantTable
) {
  const { data, error } = await supabase
    .from(tableName)
    .select('tenant_id')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle<CanonicalTenantRow>()

  if (!error) {
    return data?.tenant_id ?? null
  }

  if (isMissingRelationError(error, tableName)) {
    return null
  }

  throw new Error(`Failed to infer tenant from ${tableName}: ${error.message}`)
}

export async function resolveCollectionsTenantId(
  supabase: ServerSupabaseClient,
  userId: string,
  preferredTenantId?: string | null
) {
  const { data: connectionRowsData, error: connectionError } = await supabase
    .from('xero_connections_public')
    .select('tenant_id, auth_state, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (!connectionError) {
    const connectionRows = (connectionRowsData ?? []) as XeroConnectionRow[]
    if (preferredTenantId) {
      const requestedConnection = connectionRows.find(
        (connection) => connection.tenant_id === preferredTenantId
      )
      if (requestedConnection) {
        return requestedConnection.tenant_id
      }
    }

    const activeConnection = connectionRows.find((connection) => connection.auth_state === 'active')
    if (activeConnection) {
      return activeConnection.tenant_id
    }

    return connectionRows[0]?.tenant_id ?? null
  }

  if (!isMissingRelationError(connectionError, 'xero_connections_public')) {
    throw new Error(`Failed to load Xero tenant: ${connectionError.message}`)
  }

  if (preferredTenantId) {
    return preferredTenantId
  }

  const inferredFromInvoices = await loadLatestCanonicalTenantId(supabase, userId, 'canonical_invoices')
  if (inferredFromInvoices) return inferredFromInvoices

  const inferredFromCustomers = await loadLatestCanonicalTenantId(supabase, userId, 'canonical_customers')
  if (inferredFromCustomers) return inferredFromCustomers

  return loadLatestCanonicalTenantId(supabase, userId, 'canonical_payments')
}
