import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import {
  fetchXeroAccountingResource,
  getXeroSourceId,
  refreshXeroAccessToken,
  shouldRefreshXeroAccessToken,
  XeroAccountingApiError,
  XeroTokenRefreshError,
  type XeroResourceType,
} from '@/lib/xero/accounting'
import { decryptXeroToken, encryptXeroToken } from '@/lib/xero/secrets'
import { mapXeroRawToCanonical } from '@/lib/xero/canonical-mapper'
import { XERO_REFRESH_ISSUE_CODES } from '@/lib/xero/sync-status'

interface XeroConnectionPublicRow {
  user_id: string
  tenant_id: string
  grant_id: string | null
  auth_state: XeroAuthState
  last_refresh_error: string | null
  reauth_required_at: string | null
}

interface XeroOAuthGrantRow {
  id: string
  user_id: string
  xero_user_id: string
  scopes: string[]
  access_token_encrypted: string | null
  refresh_token_encrypted: string
  expires_at: string | null
  refresh_lock_id: string | null
  refresh_lock_expires_at: string | null
}

interface TokenAcquisitionSuccess {
  ok: true
  connection: XeroConnectionPublicRow
  accessToken: string
}

interface TokenAcquisitionFailure {
  ok: false
  response: NextResponse
}

type TokenAcquisitionResult = TokenAcquisitionSuccess | TokenAcquisitionFailure

type XeroAuthState = 'active' | 'reauth_required' | 'disconnected' | 'error'

const RESOURCE_TYPES: XeroResourceType[] = [
  'accounts',
  'contacts',
  'invoices',
  'organisations',
  'organisation_actions',
]
const REFRESH_LOCK_TTL_SECONDS = 45
const REFRESH_LOCK_WAIT_MS = 300
const MAX_REFRESH_RACE_RETRIES = 1

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>

function toRefreshErrorDiagnostic(error: unknown) {
  if (error instanceof XeroTokenRefreshError) {
    const parts = [`refresh_failed status=${error.status}`]
    if (error.code) parts.push(`code=${error.code}`)
    if (error.description) parts.push(`description=${error.description}`)
    return parts.join(' ')
  }
  if (error instanceof Error) return error.message
  return 'Unknown refresh error'
}

async function setTenantConnectionAuthState(params: {
  userId: string
  tenantId: string
  authState: XeroAuthState
  lastRefreshError?: string | null
  reauthRequiredAt?: string | null
}) {
  const supabaseAdmin = createSupabaseAdminClient()
  const { error } = await supabaseAdmin
    .from('xero_connections_public')
    .update({
      auth_state: params.authState,
      last_refresh_error: params.lastRefreshError ?? null,
      reauth_required_at: params.reauthRequiredAt ?? null,
    })
    .eq('user_id', params.userId)
    .eq('tenant_id', params.tenantId)

  if (error) {
    console.error('[xero.sync] Failed to update tenant auth state', {
      user_id: params.userId,
      tenant_id: params.tenantId,
      auth_state: params.authState,
      message: error.message,
    })
  }
}

async function setGrantConnectionsAuthState(params: {
  userId: string
  grantId: string
  authState: XeroAuthState
  lastRefreshError?: string | null
  reauthRequiredAt?: string | null
}) {
  const supabaseAdmin = createSupabaseAdminClient()
  const { error } = await supabaseAdmin
    .from('xero_connections_public')
    .update({
      auth_state: params.authState,
      last_refresh_error: params.lastRefreshError ?? null,
      reauth_required_at: params.reauthRequiredAt ?? null,
    })
    .eq('user_id', params.userId)
    .eq('grant_id', params.grantId)
    .neq('auth_state', 'disconnected')

  if (error) {
    console.error('[xero.sync] Failed to update grant auth state', {
      user_id: params.userId,
      grant_id: params.grantId,
      auth_state: params.authState,
      message: error.message,
    })
  }
}

async function clearStoredGrantAccessToken(params: { userId: string; grantId: string }) {
  const supabaseAdmin = createSupabaseAdminClient()
  const { error } = await supabaseAdmin
    .from('xero_oauth_grants')
    .update({
      access_token_encrypted: null,
      expires_at: null,
    })
    .eq('user_id', params.userId)
    .eq('id', params.grantId)

  if (error) {
    console.error('[xero.sync] Failed to clear stored grant access token', {
      user_id: params.userId,
      grant_id: params.grantId,
      message: error.message,
    })
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function parseTenantId(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function loadTenantConnectionRow(
  supabaseAdmin: SupabaseAdminClient,
  params: { userId: string; tenantId: string }
) {
  const { data, error } = await supabaseAdmin
    .from('xero_connections_public')
    .select('user_id, tenant_id, grant_id, auth_state, last_refresh_error, reauth_required_at')
    .eq('user_id', params.userId)
    .eq('tenant_id', params.tenantId)
    .maybeSingle<XeroConnectionPublicRow>()

  return { data, error }
}

async function loadGrantRow(
  supabaseAdmin: SupabaseAdminClient,
  params: { userId: string; grantId: string }
) {
  const { data, error } = await supabaseAdmin
    .from('xero_oauth_grants')
    .select(
      'id, user_id, xero_user_id, scopes, access_token_encrypted, refresh_token_encrypted, expires_at, refresh_lock_id, refresh_lock_expires_at'
    )
    .eq('user_id', params.userId)
    .eq('id', params.grantId)
    .maybeSingle<XeroOAuthGrantRow>()

  return { data, error }
}

async function acquireRefreshLock(
  supabaseAdmin: SupabaseAdminClient,
  params: { grantId: string; lockId: string }
) {
  const { data, error } = await supabaseAdmin.rpc('acquire_xero_grant_refresh_lock', {
    p_grant_id: params.grantId,
    p_lock_id: params.lockId,
    p_ttl_seconds: REFRESH_LOCK_TTL_SECONDS,
  })

  if (error) {
    throw new Error(`Failed to acquire Xero grant refresh lock: ${error.message}`)
  }

  return Boolean(data)
}

async function releaseRefreshLock(
  supabaseAdmin: SupabaseAdminClient,
  params: { grantId: string; lockId: string }
) {
  const { error } = await supabaseAdmin.rpc('release_xero_grant_refresh_lock', {
    p_grant_id: params.grantId,
    p_lock_id: params.lockId,
  })

  if (error) {
    console.error('[xero.sync] Failed to release grant refresh lock', {
      grant_id: params.grantId,
      message: error.message,
    })
  }
}

function buildReauthRequiredResponse() {
  return NextResponse.json(
    {
      error: 'Xero connection requires re-authentication',
      code: 'XERO_REAUTH_REQUIRED',
      authState: 'reauth_required',
      reauthRequired: true,
      reconnectUrl: '/api/xero/connect',
    },
    { status: 409 }
  )
}

function buildRetryableRefreshFailureResponse(params: {
  error: string
  code: string
  status: number
  tenantId?: string | null
  syncState?: 'temporary_sync_issue' | 'sync_in_progress'
}) {
  return NextResponse.json(
    {
      error: params.error,
      code: params.code,
      authState: 'active',
      syncState: params.syncState ?? 'temporary_sync_issue',
      reauthRequired: false,
      retryable: true,
      temporaryIssue: true,
      tenantId: params.tenantId ?? null,
    },
    { status: params.status }
  )
}

async function markGrantConnectionsReauthRequired(params: {
  userId: string
  grantId: string
  lastRefreshError: string
}) {
  await setGrantConnectionsAuthState({
    userId: params.userId,
    grantId: params.grantId,
    authState: 'reauth_required',
    lastRefreshError: params.lastRefreshError,
    reauthRequiredAt: new Date().toISOString(),
  })
}

async function markGrantConnectionsRetryableFailure(params: {
  userId: string
  grantId: string
  lastRefreshError: string
}) {
  await setGrantConnectionsAuthState({
    userId: params.userId,
    grantId: params.grantId,
    authState: 'active',
    lastRefreshError: params.lastRefreshError,
    reauthRequiredAt: null,
  })
}

async function getValidXeroAccessTokenForTenant(params: {
  supabaseAdmin: SupabaseAdminClient
  userId: string
  tenantId: string
  forceRefresh?: boolean
}): Promise<TokenAcquisitionResult> {
  const { supabaseAdmin, userId, tenantId, forceRefresh = false } = params

  const { data: connection, error: connectionError } = await loadTenantConnectionRow(supabaseAdmin, {
    userId,
    tenantId,
  })

  if (connectionError) {
    console.error('[xero.sync] Failed to load public connection', {
      user_id: userId,
      tenant_id: tenantId,
      message: connectionError.message,
    })
    return {
      ok: false,
      response: NextResponse.json({ error: 'Failed to load Xero connection' }, { status: 500 }),
    }
  }

  if (!connection) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Xero is not connected',
          code: 'XERO_NOT_CONNECTED',
          authState: 'disconnected',
          reauthRequired: false,
          tenantId,
        },
        { status: 400 }
      ),
    }
  }

  if (connection.auth_state === 'reauth_required') {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Xero connection requires re-authentication',
          code: 'XERO_AUTH_STATE_BLOCKED',
          authState: connection.auth_state,
          syncState: 'reconnect_required',
          reauthRequired: true,
          reconnectUrl: '/api/xero/connect',
          reauthRequiredAt: connection.reauth_required_at,
          tenantId: connection.tenant_id,
        },
        { status: 409 }
      ),
    }
  }

  if (connection.auth_state === 'disconnected') {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Xero is not connected',
          code: 'XERO_NOT_CONNECTED',
          authState: 'disconnected',
          reauthRequired: false,
          tenantId: connection.tenant_id,
        },
        { status: 400 }
      ),
    }
  }

  if (connection.auth_state === 'error' && connection.grant_id) {
    await markGrantConnectionsRetryableFailure({
      userId,
      grantId: connection.grant_id,
      lastRefreshError: XERO_REFRESH_ISSUE_CODES.LEGACY_ERROR_STATE,
    })
  }

  if (!connection.grant_id) {
    await setTenantConnectionAuthState({
      userId,
      tenantId: connection.tenant_id,
      authState: 'reauth_required',
      lastRefreshError: XERO_REFRESH_ISSUE_CODES.MISSING_OAUTH_GRANT,
      reauthRequiredAt: new Date().toISOString(),
    })
    return { ok: false, response: buildReauthRequiredResponse() }
  }

  const grantId = connection.grant_id
  const loadGrant = () =>
    loadGrantRow(supabaseAdmin, {
      userId,
      grantId,
    })

  const { data: grantRow, error: grantError } = await loadGrant()

  if (grantError) {
    console.error('[xero.sync] Failed to load OAuth grant', {
      user_id: userId,
      tenant_id: connection.tenant_id,
      grant_id: grantId,
      message: grantError.message,
    })
    return {
      ok: false,
      response: NextResponse.json({ error: 'Failed to load Xero connection' }, { status: 500 }),
    }
  }

  if (!grantRow) {
    await markGrantConnectionsReauthRequired({
      userId,
      grantId,
      lastRefreshError: XERO_REFRESH_ISSUE_CODES.MISSING_OAUTH_GRANT,
    })
    return { ok: false, response: buildReauthRequiredResponse() }
  }

  let accessToken: string | null = null
  let refreshToken: string

  try {
    if (grantRow.access_token_encrypted) {
      accessToken = decryptXeroToken(grantRow.access_token_encrypted)
    }
    refreshToken = decryptXeroToken(grantRow.refresh_token_encrypted)
  } catch {
    await markGrantConnectionsReauthRequired({
      userId,
      grantId,
      lastRefreshError: XERO_REFRESH_ISSUE_CODES.TOKEN_DECRYPTION_FAILED,
    })
    await clearStoredGrantAccessToken({
      userId,
      grantId,
    })
    return {
      ok: false,
      response: buildReauthRequiredResponse(),
    }
  }

  let expiresAt = grantRow.expires_at

  if (forceRefresh || !accessToken || shouldRefreshXeroAccessToken(expiresAt)) {
    let refreshRetryCount = 0

    while (refreshRetryCount <= MAX_REFRESH_RACE_RETRIES) {
      const lockId = randomUUID()
      let lockAcquired = false

      try {
        lockAcquired = await acquireRefreshLock(supabaseAdmin, {
          grantId,
          lockId,
        })
      } catch (lockError) {
        const lockErrorDiagnostic =
          lockError instanceof Error ? lockError.message : 'refresh_lock_error'
        console.error('[xero.sync] Grant refresh lock coordination failed', {
          user_id: userId,
          grant_id: grantId,
          detail: lockErrorDiagnostic,
        })
        await markGrantConnectionsRetryableFailure({
          userId,
          grantId,
          lastRefreshError: XERO_REFRESH_ISSUE_CODES.REFRESH_LOCK_FAILED,
        })
        return {
          ok: false,
          response: buildRetryableRefreshFailureResponse({
            error: 'Failed to coordinate Xero token refresh',
            code: 'XERO_REFRESH_LOCK_FAILED',
            status: 500,
            tenantId: connection.tenant_id,
          }),
        }
      }

      if (!lockAcquired) {
        await sleep(REFRESH_LOCK_WAIT_MS)

        const { data: latestGrant, error: latestGrantError } = await loadGrant()

        if (latestGrantError) {
          console.error('[xero.sync] Failed to reload grant after lock conflict', {
            user_id: userId,
            grant_id: grantId,
            detail: latestGrantError.message,
          })
          await markGrantConnectionsRetryableFailure({
            userId,
            grantId,
            lastRefreshError: XERO_REFRESH_ISSUE_CODES.REFRESH_RELOAD_FAILED,
          })
          return {
            ok: false,
            response: buildRetryableRefreshFailureResponse({
              error: 'Failed to reload Xero token state',
              code: 'XERO_REFRESH_RELOAD_FAILED',
              status: 500,
              tenantId: connection.tenant_id,
            }),
          }
        }

        if (!latestGrant) {
          await markGrantConnectionsReauthRequired({
            userId,
            grantId,
            lastRefreshError: XERO_REFRESH_ISSUE_CODES.MISSING_OAUTH_GRANT,
          })
          return { ok: false, response: buildReauthRequiredResponse() }
        }

        try {
          refreshToken = decryptXeroToken(latestGrant.refresh_token_encrypted)
          accessToken = latestGrant.access_token_encrypted
            ? decryptXeroToken(latestGrant.access_token_encrypted)
            : null
          expiresAt = latestGrant.expires_at
        } catch {
          await markGrantConnectionsReauthRequired({
            userId,
            grantId,
            lastRefreshError: XERO_REFRESH_ISSUE_CODES.TOKEN_DECRYPTION_FAILED,
          })
          await clearStoredGrantAccessToken({
            userId,
            grantId,
          })
          return {
            ok: false,
            response: buildReauthRequiredResponse(),
          }
        }

        if (accessToken && !shouldRefreshXeroAccessToken(expiresAt)) {
          break
        }

        refreshRetryCount += 1
        continue
      }

      try {
        const { data: latestGrant, error: latestGrantError } = await loadGrant()

        if (latestGrantError) {
          console.error('[xero.sync] Failed to load latest grant before refresh', {
            user_id: userId,
            grant_id: grantId,
            detail: latestGrantError.message,
          })
          await markGrantConnectionsRetryableFailure({
            userId,
            grantId,
            lastRefreshError: XERO_REFRESH_ISSUE_CODES.REFRESH_RELOAD_FAILED,
          })
          return {
            ok: false,
            response: buildRetryableRefreshFailureResponse({
              error: 'Failed to load latest Xero token state',
              code: 'XERO_REFRESH_RELOAD_FAILED',
              status: 500,
              tenantId: connection.tenant_id,
            }),
          }
        }

        if (!latestGrant) {
          await markGrantConnectionsReauthRequired({
            userId,
            grantId,
            lastRefreshError: XERO_REFRESH_ISSUE_CODES.MISSING_OAUTH_GRANT,
          })
          return { ok: false, response: buildReauthRequiredResponse() }
        }

        try {
          refreshToken = decryptXeroToken(latestGrant.refresh_token_encrypted)
          accessToken = latestGrant.access_token_encrypted
            ? decryptXeroToken(latestGrant.access_token_encrypted)
            : null
          expiresAt = latestGrant.expires_at
        } catch {
          await markGrantConnectionsReauthRequired({
            userId,
            grantId,
            lastRefreshError: XERO_REFRESH_ISSUE_CODES.TOKEN_DECRYPTION_FAILED,
          })
          await clearStoredGrantAccessToken({
            userId,
            grantId,
          })
          return {
            ok: false,
            response: buildReauthRequiredResponse(),
          }
        }

        if (!forceRefresh && accessToken && !shouldRefreshXeroAccessToken(expiresAt)) {
          break
        }

        let refreshed: Awaited<ReturnType<typeof refreshXeroAccessToken>>
        try {
          refreshed = await refreshXeroAccessToken(refreshToken)
        } catch (refreshError) {
          if (refreshError instanceof XeroTokenRefreshError && refreshError.requiresReauth) {
            console.error('[xero.sync] Token refresh requires reauthentication', {
              user_id: userId,
              grant_id: grantId,
              detail: toRefreshErrorDiagnostic(refreshError),
            })
            await markGrantConnectionsReauthRequired({
              userId,
              grantId,
              lastRefreshError: XERO_REFRESH_ISSUE_CODES.REFRESH_TOKEN_INVALID,
            })
            await clearStoredGrantAccessToken({
              userId,
              grantId,
            })
            return { ok: false, response: buildReauthRequiredResponse() }
          }

          console.error('[xero.sync] Token refresh failed with retryable issue', {
            user_id: userId,
            grant_id: grantId,
            detail: toRefreshErrorDiagnostic(refreshError),
          })
          await markGrantConnectionsRetryableFailure({
            userId,
            grantId,
            lastRefreshError: XERO_REFRESH_ISSUE_CODES.REFRESH_FAILED,
          })
          return {
            ok: false,
            response: buildRetryableRefreshFailureResponse({
              error: 'Failed to refresh Xero connection',
              code: 'XERO_REFRESH_FAILED',
              status: 502,
              tenantId: connection.tenant_id,
            }),
          }
        }

        const refreshedAccessTokenEncrypted = encryptXeroToken(refreshed.accessToken)
        const refreshedRefreshTokenEncrypted = encryptXeroToken(refreshed.refreshToken)
        const { data: persistedRows, error: updateError } = await supabaseAdmin
          .from('xero_oauth_grants')
          .update({
            access_token_encrypted: refreshedAccessTokenEncrypted,
            refresh_token_encrypted: refreshedRefreshTokenEncrypted,
            expires_at: refreshed.expiresAt,
          })
          .eq('user_id', userId)
          .eq('id', grantId)
          .eq('refresh_lock_id', lockId)
          .select('id')

        if (updateError) {
          console.error('[xero.sync] Failed to persist refreshed OAuth grant token', {
            user_id: userId,
            grant_id: grantId,
            message: updateError.message,
          })
          await markGrantConnectionsRetryableFailure({
            userId,
            grantId,
            lastRefreshError: XERO_REFRESH_ISSUE_CODES.REFRESH_PERSIST_FAILED,
          })
          return {
            ok: false,
            response: buildRetryableRefreshFailureResponse({
              error: 'Failed to refresh Xero connection',
              code: 'XERO_REFRESH_PERSIST_FAILED',
              status: 500,
              tenantId: connection.tenant_id,
            }),
          }
        }

        if (!persistedRows || persistedRows.length === 0) {
          await sleep(REFRESH_LOCK_WAIT_MS)
          const { data: latestAfterRace, error: latestAfterRaceError } = await loadGrant()

          if (latestAfterRaceError) {
            console.error('[xero.sync] Failed to reload grant state after refresh race', {
              user_id: userId,
              grant_id: grantId,
              detail: latestAfterRaceError.message,
            })
            await markGrantConnectionsRetryableFailure({
              userId,
              grantId,
              lastRefreshError: XERO_REFRESH_ISSUE_CODES.REFRESH_RELOAD_FAILED,
            })
            return {
              ok: false,
              response: buildRetryableRefreshFailureResponse({
                error: 'Failed to reload Xero token state after refresh race',
                code: 'XERO_REFRESH_RELOAD_FAILED',
                status: 500,
                tenantId: connection.tenant_id,
              }),
            }
          }

          if (latestAfterRace) {
            try {
              refreshToken = decryptXeroToken(latestAfterRace.refresh_token_encrypted)
              accessToken = latestAfterRace.access_token_encrypted
                ? decryptXeroToken(latestAfterRace.access_token_encrypted)
                : null
              expiresAt = latestAfterRace.expires_at
            } catch {
              await markGrantConnectionsReauthRequired({
                userId,
                grantId,
                lastRefreshError: XERO_REFRESH_ISSUE_CODES.TOKEN_DECRYPTION_FAILED,
              })
              await clearStoredGrantAccessToken({
                userId,
                grantId,
              })
              return {
                ok: false,
                response: buildReauthRequiredResponse(),
              }
            }

            if (accessToken && !shouldRefreshXeroAccessToken(expiresAt)) {
              break
            }
          }

          refreshRetryCount += 1
          continue
        }

        accessToken = refreshed.accessToken
        refreshToken = refreshed.refreshToken
        expiresAt = refreshed.expiresAt

        await setGrantConnectionsAuthState({
          userId,
          grantId,
          authState: 'active',
          lastRefreshError: null,
          reauthRequiredAt: null,
        })
        break
      } finally {
        await releaseRefreshLock(supabaseAdmin, {
          grantId,
          lockId,
        })
      }
    }

    if (!accessToken || shouldRefreshXeroAccessToken(expiresAt)) {
      await markGrantConnectionsRetryableFailure({
        userId,
        grantId,
        lastRefreshError: XERO_REFRESH_ISSUE_CODES.REFRESH_IN_PROGRESS,
      })
      return {
        ok: false,
        response: buildRetryableRefreshFailureResponse({
          error: forceRefresh
            ? 'Forced Xero token refresh could not be completed. Please retry.'
            : 'Xero token refresh is currently in progress. Please retry.',
          code: 'XERO_REFRESH_RACE_RETRY_EXHAUSTED',
          status: 409,
          tenantId: connection.tenant_id,
          syncState: 'sync_in_progress',
        }),
      }
    }
  }

  if (!accessToken) {
    await markGrantConnectionsRetryableFailure({
      userId,
      grantId,
      lastRefreshError: XERO_REFRESH_ISSUE_CODES.ACCESS_TOKEN_UNAVAILABLE,
    })
    return {
      ok: false,
      response: buildRetryableRefreshFailureResponse({
        error: 'Xero access token is unavailable. Please retry.',
        code: 'XERO_ACCESS_TOKEN_UNAVAILABLE',
        status: 503,
        tenantId: connection.tenant_id,
      }),
    }
  }

  return {
    ok: true,
    connection,
    accessToken,
  }
}

async function fetchAllAccountingResources(params: { accessToken: string; tenantId: string }) {
  const [accounts, contacts, invoices, organisations, organisationActions] = await Promise.all([
    fetchXeroAccountingResource('accounts', params.accessToken, params.tenantId),
    fetchXeroAccountingResource('contacts', params.accessToken, params.tenantId),
    fetchXeroAccountingResource('invoices', params.accessToken, params.tenantId),
    fetchXeroAccountingResource('organisations', params.accessToken, params.tenantId),
    fetchXeroAccountingResource('organisation_actions', params.accessToken, params.tenantId),
  ])

  return {
    accounts,
    contacts,
    invoices,
    organisations,
    organisation_actions: organisationActions,
  }
}

function isXeroAuthApiError(error: unknown): error is XeroAccountingApiError {
  return error instanceof XeroAccountingApiError && error.isAuthRelated
}

export async function syncXeroTenantForUser(params: { userId: string; tenantId: string }) {
  const supabaseAdmin = createSupabaseAdminClient()
  const { userId, tenantId } = params

  const tokenResult = await getValidXeroAccessTokenForTenant({
    supabaseAdmin,
    userId,
    tenantId,
  })

  if (!tokenResult.ok) {
    return tokenResult.response
  }

  let connection = tokenResult.connection
  let resources: Awaited<ReturnType<typeof fetchAllAccountingResources>>

  try {
    resources = await fetchAllAccountingResources({
      accessToken: tokenResult.accessToken,
      tenantId: connection.tenant_id,
    })
  } catch (firstAttemptError) {
    if (!isXeroAuthApiError(firstAttemptError)) {
      throw firstAttemptError
    }

    const forcedTokenResult = await getValidXeroAccessTokenForTenant({
      supabaseAdmin,
      userId,
      tenantId,
      forceRefresh: true,
    })

    if (!forcedTokenResult.ok) {
      return forcedTokenResult.response
    }

    connection = forcedTokenResult.connection

    try {
      resources = await fetchAllAccountingResources({
        accessToken: forcedTokenResult.accessToken,
        tenantId: connection.tenant_id,
      })
    } catch (retryError) {
      if (!isXeroAuthApiError(retryError)) {
        throw retryError
      }

      const grantId = connection.grant_id
      if (grantId) {
        console.error('[xero.sync] Xero API auth failed after forced refresh', {
          user_id: userId,
          grant_id: grantId,
          status: retryError.status,
        })
        await markGrantConnectionsReauthRequired({
          userId,
          grantId,
          lastRefreshError: XERO_REFRESH_ISSUE_CODES.API_AUTH_FAILED_AFTER_FORCED_REFRESH,
        })
        await clearStoredGrantAccessToken({
          userId,
          grantId,
        })
      }

      return buildReauthRequiredResponse()
    }
  }

  const fetchedAt = new Date().toISOString()
  const fetchedCounts = {
    accounts: resources.accounts.length,
    contacts: resources.contacts.length,
    invoices: resources.invoices.length,
    organisations: resources.organisations.length,
    organisation_actions: resources.organisation_actions.length,
  }
  const persistedCounts: Record<XeroResourceType, number> = {
    accounts: 0,
    contacts: 0,
    invoices: 0,
    organisations: 0,
    organisation_actions: 0,
  }

  for (const resourceType of RESOURCE_TYPES) {
    const rows = resources[resourceType]
      .map((record) => {
        const sourceId = getXeroSourceId(resourceType, record)
        if (!sourceId) return null
        return {
          user_id: userId,
          tenant_id: connection.tenant_id,
          resource_type: resourceType,
          source_id: sourceId,
          raw_json: record,
          fetched_at: fetchedAt,
        }
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))

    if (rows.length === 0) continue

    const { error: upsertError } = await supabaseAdmin.from('xero_raw').upsert(rows, {
      onConflict: 'user_id,tenant_id,resource_type,source_id',
    })

    if (upsertError) {
      console.error('[xero.sync] Failed to upsert xero_raw records', {
        user_id: userId,
        tenant_id: connection.tenant_id,
        resource_type: resourceType,
        message: upsertError.message,
      })
      return NextResponse.json({ error: 'Failed to store Xero raw data' }, { status: 500 })
    }

    persistedCounts[resourceType] = rows.length
  }

  let mappedCounts: Awaited<ReturnType<typeof mapXeroRawToCanonical>>
  try {
    mappedCounts = await mapXeroRawToCanonical({
      userId,
      tenantId: connection.tenant_id,
      supabaseAdmin,
    })
  } catch (error) {
    console.error('[xero.sync] Canonical mapping failed after raw persistence', {
      user_id: userId,
      tenant_id: connection.tenant_id,
      raw_fetched: fetchedCounts,
      raw_persisted: persistedCounts,
      message: error instanceof Error ? error.message : 'Unknown error',
    })

    return NextResponse.json(
      {
        error: 'Xero data was fetched but could not be prepared for collections',
        code: 'XERO_CANONICAL_MAPPING_FAILED',
        tenantId: connection.tenant_id,
        raw: {
          fetched: fetchedCounts,
          persisted: persistedCounts,
        },
        canonical: {
          ready: false,
        },
      },
      { status: 500 }
    )
  }

  if (connection.grant_id) {
    await setGrantConnectionsAuthState({
      userId,
      grantId: connection.grant_id,
      authState: 'active',
      lastRefreshError: null,
      reauthRequiredAt: null,
    })
  }

  console.info('[xero.sync] Sync complete', {
    user_id: userId,
    tenant_id: connection.tenant_id,
    raw_fetched: fetchedCounts,
    raw_persisted: persistedCounts,
    canonical_mapped: mappedCounts,
  })

  return NextResponse.json({
    ok: true,
    tenantId: connection.tenant_id,
    counts: fetchedCounts,
    raw: {
      fetched: fetchedCounts,
      persisted: persistedCounts,
    },
    canonical: {
      ready: true,
      mapped: mappedCounts,
    },
    syncedAt: fetchedAt,
  })
}
