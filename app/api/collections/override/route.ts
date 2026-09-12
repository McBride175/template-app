import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type { CustomerOverrideLevel } from '@/lib/collections/prioritization'
import { isMissingRelationError } from '@/lib/collections/tenant-context'
import { claimActionsEntitlementStatus } from '@/lib/billing/entitlements'
import {
  MULTI_CURRENCY_REQUIRES_PRO_CODE,
  resolveCollectionsCurrencyAccess,
} from '@/lib/billing/collections-access'
import { loadCollectionsCurrencyContext } from '@/lib/collections/currency-context-server'

const VALID_OVERRIDE_LEVELS: CustomerOverrideLevel[] = [
  'safe',
  'normal',
  'priority',
  'do_not_chase',
]

function parseCustomerSourceId(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseOverrideLevel(value: unknown): CustomerOverrideLevel | null {
  if (typeof value !== 'string') return null
  return VALID_OVERRIDE_LEVELS.includes(value as CustomerOverrideLevel)
    ? (value as CustomerOverrideLevel)
    : null
}

function parseTenantId(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
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

    const payload = (await request.json().catch(() => null)) as
        | {
          customer_source_id?: unknown
          override_level?: unknown
          tenant_id?: unknown
        }
      | null

    const customerSourceId = parseCustomerSourceId(payload?.customer_source_id)
    const overrideLevel = parseOverrideLevel(payload?.override_level)
    const requestedTenantId = parseTenantId(payload?.tenant_id)

    if (!customerSourceId || !overrideLevel) {
      return NextResponse.json(
        {
          error:
            'Invalid request body. Provide customer_source_id and override_level (safe|normal|priority|do_not_chase).',
        },
        { status: 400 }
      )
    }

    const entitlement = await claimActionsEntitlementStatus({
      userId: user.id,
      preferredTenantId: requestedTenantId,
      supabase,
    })
    const tenantId = entitlement.tenantId
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant context found' }, { status: 400 })
    }
    if (!entitlement.hasActionsAccess) {
      return NextResponse.json(
        { error: 'Free usage allowance exhausted', code: 'ACTION_USAGE_LIMIT_REACHED', entitlement },
        { status: 402 }
      )
    }

    const supabaseAdmin = createSupabaseAdminClient()
    const currencyContext = await loadCollectionsCurrencyContext({
      supabaseAdmin,
      userId: user.id,
      tenantId,
    })
    const currencyAccess = resolveCollectionsCurrencyAccess({ entitlement, currencyContext })
    if (!currencyAccess.allowed) {
      return NextResponse.json(
        {
          error: 'Multi-currency collections require Pro',
          code: MULTI_CURRENCY_REQUIRES_PRO_CODE,
          entitlement,
          currencyContext,
          currencyAccess,
        },
        { status: 402 }
      )
    }

    if (overrideLevel === 'normal') {
      const { error: deleteError } = await supabaseAdmin
        .from('customer_overrides')
        .delete()
        .eq('user_id', user.id)
        .eq('tenant_id', tenantId)
        .eq('customer_source_id', customerSourceId)

      if (deleteError) {
        if (isMissingRelationError(deleteError, 'customer_overrides')) {
          return NextResponse.json(
            { error: 'Priority overrides are unavailable until database migrations are applied.' },
            { status: 503 }
          )
        }
        return NextResponse.json({ error: 'Failed to clear customer override' }, { status: 500 })
      }

      return NextResponse.json({ ok: true })
    }

    const { error: upsertError } = await supabaseAdmin.from('customer_overrides').upsert(
      {
        user_id: user.id,
        tenant_id: tenantId,
        customer_source_id: customerSourceId,
        override_level: overrideLevel,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'user_id,tenant_id,customer_source_id',
      }
    )

    if (upsertError) {
      if (isMissingRelationError(upsertError, 'customer_overrides')) {
        return NextResponse.json(
          { error: 'Priority overrides are unavailable until database migrations are applied.' },
          { status: 503 }
        )
      }
      return NextResponse.json({ error: 'Failed to save customer override' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[collections.override.post] Failed to upsert customer override', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ error: 'Failed to save customer override' }, { status: 500 })
  }
}
