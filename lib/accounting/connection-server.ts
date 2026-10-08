import 'server-only'
import { classifyXeroGrant } from '@/lib/xero/scopes'
import { resolveXeroAuthoritativeSnapshot } from '@/lib/xero/authoritative-snapshot'
import { accountingIdentity, accountingProvider, type AccountingAuthority, type AccountingConnectionHealth } from './refresh'
import { accountingControlRpc, AccountingControlError, parseAccountingConnection, type AccountingControlClient } from './control-server'

/** Only implemented connector. No authentication refresh or provider requests. */
export async function resolveAccountingConnection(params: {
  admin: AccountingControlClient; authenticatedOwnerId: string; provider: string; providerOrganisationId: string
}) {
  const provider = accountingProvider(params.provider), org = accountingIdentity(params.providerOrganisationId)
  if (provider !== 'xero') throw new AccountingControlError('unsupported_provider')
  const { data: row, error } = await params.admin.from('xero_connections_public')
    .select('user_id, tenant_id, grant_id, auth_state').eq('user_id', params.authenticatedOwnerId).eq('tenant_id', org)
    .maybeSingle<{ user_id: string; tenant_id: string; grant_id: string | null; auth_state: 'active' | 'reauth_required' | 'disconnected' | 'error' }>()
  if (error) throw new AccountingControlError('unavailable')
  if (!row || row.user_id !== params.authenticatedOwnerId || row.tenant_id !== org) throw new AccountingControlError('not_found')
  let health: AccountingConnectionHealth = row.auth_state === 'disconnected' ? 'disconnected' :
    row.auth_state === 'reauth_required' ? 'reconnect_required' : row.auth_state === 'error' ? 'attention_required' : 'healthy'
  if (health === 'healthy') {
    if (!row.grant_id) health = 'reconnect_required'
    else {
      const { data: grant, error: grantError } = await params.admin.from('xero_oauth_grants').select('scopes')
        .eq('id', row.grant_id).eq('user_id', params.authenticatedOwnerId).maybeSingle<{ scopes: string[] | null }>()
      if (grantError) throw new AccountingControlError('unavailable')
      const classification = classifyXeroGrant({ scopes: grant?.scopes ?? null, authState: row.auth_state,
        scopeMetadataKnown: Boolean(grant?.scopes?.length) })
      if (!['granular_ready', 'legacy_broad_compatible'].includes(classification)) health = 'reconnect_required'
    }
  }
  const registered = await accountingControlRpc<Record<string, unknown>>(params.admin, 'register_accounting_refresh_connection', {
    p_user_id: params.authenticatedOwnerId, p_provider: provider, p_provider_organisation_id: org,
    p_connection_key: row.tenant_id, p_authority_key: row.grant_id ?? 'unlinked',
  })
  const connection = parseAccountingConnection(registered)
  if (connection.ownerId !== params.authenticatedOwnerId || connection.provider !== provider || connection.providerOrganisationId !== org) throw new AccountingControlError('unavailable')
  if (registered.invalidated === true) health = 'disconnected'
  return { connection, health }
}

/** Existing generation/calculation readers remain authoritative. This is a
 * read-only compatibility bridge, never an ensure/materialization operation.
 */
export async function getAccountingAuthority(params: {
  admin: AccountingControlClient; authenticatedOwnerId: string; provider: string; providerOrganisationId: string; now: Date
}): Promise<AccountingAuthority> {
  if (accountingProvider(params.provider) !== 'xero') throw new AccountingControlError('unsupported_provider')
  const org = accountingIdentity(params.providerOrganisationId)
  const unavailable: AccountingAuthority = { state: 'unavailable', mode: null, activeGenerationId: null,
    lastSuccessfulRefreshAt: null, accountingObservedAt: null,
    derivatives: { state: 'unavailable', generationId: null, financialEpoch: null, evaluationDate: null } }
  const snapshot = await resolveXeroAuthoritativeSnapshot({ supabaseAdmin: params.admin, userId: params.authenticatedOwnerId, tenantId: org }).catch(() => null)
  if (!snapshot) return unavailable
  if (snapshot.mode === 'legacy') return { ...unavailable, state: 'missing', mode: 'legacy', derivatives: { ...unavailable.derivatives, state: 'not_applicable' } }
  const { data: run, error } = await params.admin.from('xero_sync_runs').select('snapshot_as_of')
    .eq('id', snapshot.syncRunId).eq('user_id', params.authenticatedOwnerId).eq('tenant_id', org).maybeSingle<{ snapshot_as_of: string | null }>()
  if (error || !run?.snapshot_as_of || !Number.isFinite(Date.parse(run.snapshot_as_of))) return unavailable
  const date = params.now.toISOString().slice(0, 10)
  let derivatives: AccountingAuthority['derivatives'] = { state: 'preparing', generationId: snapshot.syncRunId, financialEpoch: null, evaluationDate: date }
  try {
    const probe = await accountingControlRpc<{
      ready: boolean; context: { generationId: string; financialEpoch: string }; evaluationDate: string
    }>(params.admin,'read_accounting_preparation_readiness',{p_user_id:params.authenticatedOwnerId,p_provider:params.provider,
      p_provider_organisation_id:org,p_evaluation_date:date})
    if (probe.context.generationId !== snapshot.syncRunId || probe.evaluationDate !== date) return unavailable
    derivatives.financialEpoch = probe.context.financialEpoch
    if (probe.ready) derivatives = { ...derivatives,state:'ready' }
  } catch { derivatives = { ...derivatives, state: 'unavailable' } }
  // Recheck accounting after the separate calculation reads; never combine Gs.
  const current = await resolveXeroAuthoritativeSnapshot({ supabaseAdmin: params.admin, userId: params.authenticatedOwnerId, tenantId: org }).catch(() => null)
  if (!current || current.mode !== 'generation' || current.syncRunId !== snapshot.syncRunId) return unavailable
  return { state: 'valid', mode: 'generation', activeGenerationId: snapshot.syncRunId,
    lastSuccessfulRefreshAt: snapshot.lastSuccessfulSyncAt, accountingObservedAt: run.snapshot_as_of, derivatives }
}
