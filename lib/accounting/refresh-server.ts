import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { acceptAccountingRefresh, AccountingControlError, readAccountingRefreshControl, type AccountingControlClient } from './control-server'
import { resolveAccountingConnection, getAccountingAuthority } from './connection-server'
import { deriveAccountingRefreshStatus } from './refresh-status'
import type { AccountingRefreshRequest } from './refresh'

interface AccountingSessionReader { auth: { getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }> } }
async function authenticated(session?: AccountingSessionReader) {
  const client = session ?? await createServerSupabaseClient()
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) throw new AccountingControlError('unauthorized')
  return data.user.id
}
/** Dormant service entry point. No route imports this in Phase 7.1. No usage
 * claim, token operation, HTTP dispatch, generation or derivative write.
 */
export async function requestAccountingRefresh(request: AccountingRefreshRequest, dependencies: { session?: AccountingSessionReader; admin?: AccountingControlClient } = {}) {
  const owner = await authenticated(dependencies.session), admin = dependencies.admin ?? createSupabaseAdminClient()
  const resolved = await resolveAccountingConnection({ admin, authenticatedOwnerId: owner,
    provider: request.provider, providerOrganisationId: request.providerOrganisationId })
  if (resolved.health !== 'healthy') throw new AccountingControlError('connection_unavailable')
  return acceptAccountingRefresh({ admin, connection: resolved.connection, request })
}
export async function readAccountingRefreshStatus(request: Pick<AccountingRefreshRequest, 'provider' | 'providerOrganisationId'>, dependencies: {
  session?: AccountingSessionReader; admin?: AccountingControlClient; now?: Date
} = {}) {
  const owner = await authenticated(dependencies.session), admin = dependencies.admin ?? createSupabaseAdminClient(), now = dependencies.now ?? new Date()
  const resolved = await resolveAccountingConnection({ admin, authenticatedOwnerId: owner, ...request })
  const control = await readAccountingRefreshControl(admin, resolved.connection)
  const authority = await getAccountingAuthority({ admin, authenticatedOwnerId: owner, ...request, now })
  // A concurrent relink invalidates this composed status rather than mixing epochs.
  const final = await readAccountingRefreshControl(admin, control.connection)
  if (final.connection.epoch !== control.connection.epoch) throw new AccountingControlError('conflict')
  return deriveAccountingRefreshStatus({ connection: final.connection, health: final.invalidated ? 'disconnected' : resolved.health,
    authority, job: final.job, now })
}
