import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { encryptXeroToken } from '@/lib/xero/secrets'
import {
  getXeroConnectionsUrl,
  getXeroConfig,
  getXeroTokenUrl,
  safeEqualStrings,
  XERO_STATE_COOKIE_NAME,
  XERO_STATE_USER_COOKIE_NAME,
  type XeroConnection,
  type XeroTokenResponse,
} from '@/lib/xero/server'

const REQUIRED_OFFLINE_SCOPE = 'offline_access'

function redirectWithError(request: NextRequest, reason: string, status = 302) {
  const url = new URL('/account', request.url)
  url.searchParams.set('xero', 'error')
  url.searchParams.set('reason', reason)
  return NextResponse.redirect(url, status)
}

function clearStateCookies(response: NextResponse) {
  response.cookies.set({
    name: XERO_STATE_COOKIE_NAME,
    value: '',
    maxAge: 0,
    path: '/api/xero',
  })
  response.cookies.set({
    name: XERO_STATE_USER_COOKIE_NAME,
    value: '',
    maxAge: 0,
    path: '/api/xero',
  })
}

function redirectWithErrorAndClear(request: NextRequest, reason: string, status = 302) {
  const response = redirectWithError(request, reason, status)
  clearStateCookies(response)
  return response
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const returnedState = searchParams.get('state')
  const storedState = request.cookies.get(XERO_STATE_COOKIE_NAME)?.value
  const storedStateUserId = request.cookies.get(XERO_STATE_USER_COOKIE_NAME)?.value

  if (!code) {
    return redirectWithErrorAndClear(request, 'missing_code')
  }

  if (!returnedState || !storedState || !safeEqualStrings(returnedState, storedState)) {
    return redirectWithErrorAndClear(request, 'invalid_state')
  }

  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      console.error('[xero.callback] No authenticated user in session', {
        has_user_error: Boolean(userError),
        user_error_message: userError?.message,
      })
      return redirectWithErrorAndClear(request, 'unauthorized')
    }

    if (!storedStateUserId || storedStateUserId !== user.id) {
      return redirectWithErrorAndClear(request, 'invalid_state')
    }

    const { clientId, clientSecret, redirectUri } = getXeroConfig()
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

    const tokenResponse = await fetch(getXeroTokenUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
    })

    if (!tokenResponse.ok) {
      console.error('[xero.callback] Token exchange failed', {
        status: tokenResponse.status,
        status_text: tokenResponse.statusText,
        user_id: user.id,
      })
      return redirectWithErrorAndClear(request, 'token_exchange_failed')
    }

    const tokenData = (await tokenResponse.json()) as Partial<XeroTokenResponse>
    if (
      !tokenData.access_token ||
      !tokenData.refresh_token ||
      typeof tokenData.expires_in !== 'number'
    ) {
      console.error('[xero.callback] Token response missing required fields', {
        has_access_token: Boolean(tokenData.access_token),
        has_refresh_token: Boolean(tokenData.refresh_token),
        has_expires_in: Boolean(tokenData.expires_in),
        user_id: user.id,
      })
      return redirectWithErrorAndClear(request, 'invalid_token_response')
    }

    const scopes =
      typeof tokenData.scope === 'string'
        ? tokenData.scope
            .split(' ')
            .map((scope) => scope.trim())
            .filter((scope) => scope.length > 0)
        : []

    if (!scopes.includes(REQUIRED_OFFLINE_SCOPE)) {
      console.error('[xero.callback] Missing required offline_access scope in token response', {
        user_id: user.id,
        scopes,
      })
      return redirectWithErrorAndClear(request, 'missing_offline_access_scope')
    }

    const accessToken = tokenData.access_token
    const refreshToken = tokenData.refresh_token
    const expiresInSeconds = tokenData.expires_in

    const connectionsResponse = await fetch(getXeroConnectionsUrl(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!connectionsResponse.ok) {
      console.error('[xero.callback] Failed to fetch Xero connections', {
        status: connectionsResponse.status,
        status_text: connectionsResponse.statusText,
        user_id: user.id,
      })
      return redirectWithErrorAndClear(request, 'connections_fetch_failed')
    }

    const connections = (await connectionsResponse.json()) as XeroConnection[]
    const tenantById = new Map<
      string,
      {
        tenantName: string | null
        tenantType: string | null
      }
    >()

    for (const connection of connections) {
      const tenantId = connection.tenantId?.trim()
      if (!tenantId) continue

      if (!tenantById.has(tenantId)) {
        tenantById.set(tenantId, {
          tenantName: connection.tenantName?.trim() || null,
          tenantType: connection.tenantType?.trim() || null,
        })
      }
    }

    const tenantRows = Array.from(tenantById.entries()).map(([tenantId, value]) => ({
      tenantId,
      tenantName: value.tenantName,
      tenantType: value.tenantType,
    }))

    if (tenantRows.length === 0) {
      console.error('[xero.callback] No tenants returned by Xero', {
        connection_count: Array.isArray(connections) ? connections.length : 0,
        user_id: user.id,
      })
      return redirectWithErrorAndClear(request, 'no_tenant_found')
    }

    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString()
    const xeroUserId = tokenData.xero_userid?.trim() ?? ''
    const accessTokenEncrypted = encryptXeroToken(accessToken)
    const refreshTokenEncrypted = encryptXeroToken(refreshToken)

    const supabaseAdmin = createSupabaseAdminClient()
    const { data: grantRow, error: grantError } = await supabaseAdmin
      .from('xero_oauth_grants')
      .upsert(
        {
          user_id: user.id,
          xero_user_id: xeroUserId,
          scopes,
          access_token_encrypted: accessTokenEncrypted,
          refresh_token_encrypted: refreshTokenEncrypted,
          expires_at: expiresAt,
        },
        { onConflict: 'user_id,xero_user_id' }
      )
      .select('id')
      .single<{ id: string }>()

    if (grantError) {
      throw new Error(`Failed to store Xero OAuth grant: ${grantError.message}`)
    }
    if (!grantRow?.id) {
      throw new Error('Missing grant ID after Xero OAuth grant upsert')
    }

    const grantId = grantRow.id
    const tenantIds = tenantRows.map((tenant) => tenant.tenantId)
    const { data: existingRows, error: existingRowsError } = await supabaseAdmin
      .from('xero_connections_public')
      .select('tenant_id')
      .eq('user_id', user.id)

    if (existingRowsError) {
      console.error('[xero.callback] Failed to load existing public connections', {
        message: existingRowsError.message,
        code: existingRowsError.code,
        user_id: user.id,
      })
      return redirectWithErrorAndClear(request, 'storage_failed')
    }

    const existingTenantIds = new Set((existingRows ?? []).map((row) => row.tenant_id))
    const removedTenantIds = Array.from(existingTenantIds).filter((tenantId) => !tenantById.has(tenantId))

    const { error: publicUpsertError } = await supabaseAdmin.from('xero_connections_public').upsert(
      tenantRows.map((tenant) => ({
        user_id: user.id,
        tenant_id: tenant.tenantId,
        tenant_name: tenant.tenantName,
        grant_id: grantId,
        auth_state: 'active',
        last_refresh_error: null,
        reauth_required_at: null,
        metadata: {
          xero_user_id: xeroUserId.length > 0 ? xeroUserId : null,
          scopes,
          tenant_type: tenant.tenantType,
        },
      })),
      { onConflict: 'user_id,tenant_id' }
    )

    if (publicUpsertError) {
      console.error('[xero.callback] Failed to store Xero public connection', {
        message: publicUpsertError.message,
        code: publicUpsertError.code,
        user_id: user.id,
      })
      return redirectWithErrorAndClear(request, 'storage_failed')
    }

    if (removedTenantIds.length > 0) {
      const { error: publicDisconnectError } = await supabaseAdmin
        .from('xero_connections_public')
        .update({
          grant_id: null,
          auth_state: 'disconnected',
          last_refresh_error: null,
          reauth_required_at: null,
        })
        .eq('user_id', user.id)
        .in('tenant_id', removedTenantIds)

      if (publicDisconnectError) {
        console.error('[xero.callback] Failed to disconnect removed tenants', {
          message: publicDisconnectError.message,
          code: publicDisconnectError.code,
          user_id: user.id,
        })
        return redirectWithErrorAndClear(request, 'storage_failed')
      }
    }

    const primaryTenantId = tenantIds[0] ?? tenantRows[0]?.tenantId
    if (!primaryTenantId) {
      return redirectWithErrorAndClear(request, 'no_tenant_found')
    }

    const callbackUrl = new URL('/account', request.url)
    callbackUrl.searchParams.set('xero', 'connected')
    callbackUrl.searchParams.set('tenantId', primaryTenantId)
    const response = NextResponse.redirect(callbackUrl)
    clearStateCookies(response)

    return response
  } catch (error) {
    console.error('[xero.callback] Unexpected callback error', {
      message: error instanceof Error ? error.message : 'Unknown error',
    })
    return redirectWithErrorAndClear(request, 'unexpected_error')
  }
}
