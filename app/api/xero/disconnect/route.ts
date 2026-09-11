import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createServerSupabaseClient } from '@/lib/supabase-server'

interface DisconnectPayload {
  tenantId?: unknown
  disconnectAll?: unknown
  purgeData?: unknown
}

interface XeroConnectionRow {
  tenant_id: string
  grant_id: string | null
}

function parseTenantId(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseBoolean(value: unknown) {
  return value === true
}

async function purgeTenantData(params: {
  userId: string
  tenantId: string
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>
}) {
  const tenantScopedTables = [
    'xero_raw',
    'canonical_organisations',
    'canonical_customers',
    'canonical_invoices',
    'canonical_payments',
    'customer_overrides',
  ] as const

  for (const table of tenantScopedTables) {
    const { error } = await params.supabaseAdmin
      .from(table)
      .delete()
      .eq('user_id', params.userId)
      .eq('tenant_id', params.tenantId)

    if (error) {
      throw new Error(`Failed to purge ${table}: ${error.message}`)
    }
  }
}

async function deleteGrantIfUnused(params: {
  userId: string
  grantId: string
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>
}) {
  const { count, error: usageError } = await params.supabaseAdmin
    .from('xero_connections_public')
    .select('tenant_id', { count: 'exact', head: true })
    .eq('user_id', params.userId)
    .eq('grant_id', params.grantId)

  if (usageError) {
    throw new Error(`Failed to determine grant usage: ${usageError.message}`)
  }

  if ((count ?? 0) > 0) {
    return
  }

  const { error: deleteError } = await params.supabaseAdmin
    .from('xero_oauth_grants')
    .delete()
    .eq('user_id', params.userId)
    .eq('id', params.grantId)

  if (deleteError) {
    throw new Error(`Failed to delete OAuth grant: ${deleteError.message}`)
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = (await request.json().catch(() => null)) as DisconnectPayload | null
    const tenantId = parseTenantId(payload?.tenantId)
    const disconnectAll = parseBoolean(payload?.disconnectAll)
    const purgeData = parseBoolean(payload?.purgeData)
    const supabaseAdmin = createSupabaseAdminClient()

    if (!disconnectAll && !tenantId) {
      return NextResponse.json(
        { error: 'Missing tenantId', code: 'XERO_TENANT_ID_REQUIRED' },
        { status: 400 }
      )
    }

    if (disconnectAll) {
      const { data: existingConnections, error: existingConnectionsError } = await supabaseAdmin
        .from('xero_connections_public')
        .select('tenant_id, grant_id')
        .eq('user_id', user.id)

      if (existingConnectionsError) {
        console.error('[xero.disconnect] Failed to load connections before disconnect all', {
          message: existingConnectionsError.message,
          code: existingConnectionsError.code,
          user_id: user.id,
        })
        return NextResponse.json({ error: 'Failed to disconnect Xero' }, { status: 500 })
      }

      const connectionRows = (existingConnections ?? []) as XeroConnectionRow[]

      const { error: publicUpdateError } = await supabaseAdmin
        .from('xero_connections_public')
        .update({
          grant_id: null,
          auth_state: 'disconnected',
          last_refresh_error: null,
          reauth_required_at: null,
        })
        .eq('user_id', user.id)

      if (publicUpdateError) {
        console.error('[xero.disconnect] Failed to mark all Xero public connections disconnected', {
          message: publicUpdateError.message,
          code: publicUpdateError.code,
          user_id: user.id,
        })
        return NextResponse.json({ error: 'Failed to disconnect Xero' }, { status: 500 })
      }

      const { error: grantDeleteError } = await supabaseAdmin
        .from('xero_oauth_grants')
        .delete()
        .eq('user_id', user.id)

      if (grantDeleteError) {
        console.error('[xero.disconnect] Failed to delete OAuth grants for disconnect all', {
          message: grantDeleteError.message,
          code: grantDeleteError.code,
          user_id: user.id,
        })
        return NextResponse.json({ error: 'Failed to disconnect Xero' }, { status: 500 })
      }

      if (purgeData) {
        const tenantIds = Array.from(
          new Set(connectionRows.map((row) => row.tenant_id).filter((value) => typeof value === 'string'))
        )

        try {
          for (const tenantIdForPurge of tenantIds) {
            await purgeTenantData({
              userId: user.id,
              tenantId: tenantIdForPurge,
              supabaseAdmin,
            })
          }
        } catch (purgeError) {
          console.error('[xero.disconnect] Failed to purge tenant data after disconnect all', {
            message: purgeError instanceof Error ? purgeError.message : 'Unknown error',
            user_id: user.id,
          })
          return NextResponse.json({ error: 'Failed to purge Xero data' }, { status: 500 })
        }
      }

      return NextResponse.json({ ok: true, disconnectAll: true, purgedData: purgeData })
    }

    if (!tenantId) {
      return NextResponse.json(
        { error: 'Missing tenantId', code: 'XERO_TENANT_ID_REQUIRED' },
        { status: 400 }
      )
    }

    const { data: connection, error: connectionError } = await supabaseAdmin
      .from('xero_connections_public')
      .select('tenant_id, grant_id')
      .eq('user_id', user.id)
      .eq('tenant_id', tenantId)
      .maybeSingle<XeroConnectionRow>()

    if (connectionError) {
      console.error('[xero.disconnect] Failed to load tenant connection', {
        message: connectionError.message,
        code: connectionError.code,
        user_id: user.id,
        tenant_id: tenantId,
      })
      return NextResponse.json({ error: 'Failed to disconnect Xero' }, { status: 500 })
    }

    if (!connection) {
      return NextResponse.json(
        { error: 'Tenant connection not found', code: 'XERO_TENANT_NOT_CONNECTED' },
        { status: 404 }
      )
    }

    const { error: publicUpdateError } = await supabaseAdmin
      .from('xero_connections_public')
      .update({
        grant_id: null,
        auth_state: 'disconnected',
        last_refresh_error: null,
        reauth_required_at: null,
      })
      .eq('user_id', user.id)
      .eq('tenant_id', tenantId)

    if (publicUpdateError) {
      console.error('[xero.disconnect] Failed to mark Xero public connection disconnected', {
        message: publicUpdateError.message,
        code: publicUpdateError.code,
        user_id: user.id,
        tenant_id: tenantId,
      })
      return NextResponse.json({ error: 'Failed to disconnect Xero' }, { status: 500 })
    }

    if (connection.grant_id) {
      try {
        await deleteGrantIfUnused({
          userId: user.id,
          grantId: connection.grant_id,
          supabaseAdmin,
        })
      } catch (deleteGrantError) {
        console.error('[xero.disconnect] Failed to clean up OAuth grant', {
          message: deleteGrantError instanceof Error ? deleteGrantError.message : 'Unknown error',
          user_id: user.id,
          tenant_id: tenantId,
          grant_id: connection.grant_id,
        })
        return NextResponse.json({ error: 'Failed to disconnect Xero' }, { status: 500 })
      }
    }

    if (purgeData) {
      try {
        await purgeTenantData({
          userId: user.id,
          tenantId,
          supabaseAdmin,
        })
      } catch (purgeError) {
        console.error('[xero.disconnect] Failed to purge tenant-scoped data', {
          message: purgeError instanceof Error ? purgeError.message : 'Unknown error',
          user_id: user.id,
          tenant_id: tenantId,
        })
        return NextResponse.json({ error: 'Failed to purge Xero data' }, { status: 500 })
      }
    }

    return NextResponse.json({
      ok: true,
      tenantId,
      disconnectAll: false,
      purgedData: purgeData,
    })
  } catch (error) {
    console.error('[xero.disconnect] Unexpected error', {
      message: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ error: 'Failed to disconnect Xero' }, { status: 500 })
  }
}
