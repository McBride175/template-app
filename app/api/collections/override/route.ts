import { claimCollectionAccess, collectionAccessCurrencyContext } from '@/lib/collections/access-context-server'
import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type { CustomerOverrideLevel } from '@/lib/collections/prioritization'
import { isMissingRelationError } from '@/lib/collections/tenant-context'
import {
  MULTI_CURRENCY_REQUIRES_PRO_CODE,
  resolveCollectionsCurrencyAccess,
} from '@/lib/billing/collections-access'
import { loadCollectionsCurrencyContext } from '@/lib/collections/currency-context-server'
import { readCollectionQueueProjection } from '@/lib/collections/fast-queue-projection-server'

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
          queue_overdue_only?: unknown
          queue_limit?: unknown
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

    const accessAdmin = createSupabaseAdminClient()
    const access = await claimCollectionAccess({
      admin: accessAdmin, userId: user.id, tenantId: requestedTenantId, supabase,
    })
    const entitlement = access.entitlement
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

    const supabaseAdmin = accessAdmin
    const currencyContext = access.context ? collectionAccessCurrencyContext(access.context) : await loadCollectionsCurrencyContext({
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

    const queueOverdueOnly = payload?.queue_overdue_only === true
    const queueLimit = Number.isInteger(payload?.queue_limit)
      ? Math.max(1, Math.min(200, payload!.queue_limit as number)) : 200
    const committedResponse = async () => {
      try {
        const projection = await readCollectionQueueProjection({
          admin: supabaseAdmin, userId: user.id, tenantId,
          evaluationInstant: new Date(), overdueOnly: queueOverdueOnly,
          requireCurrentDate: true,
          limit: queueLimit, legacyTodayDateIso: entitlement.usageDate,
        })
        return NextResponse.json({ ok: true, committed: true, overrideLevel,
          projection: { rows: projection.rows, actionsTakenByCustomerId: projection.actionsTakenByCustomerId,
            queue: projection.queue, portfolio: projection.portfolio, version: projection.version,
            experience: projection.experience, reviewRequiredCustomers: projection.reviews,
            organisationBaseCurrency: projection.metadata.organisationBaseCurrency,
            currencyContext: projection.metadata.currencyContext,
            currencyHealth: projection.metadata.currencyHealth,
            currencyAccess, followUpSchedule: projection.followUpSchedule,
            tenantId, entitlement },
        })
      } catch (error) {
        console.error('[collections.override.post] Override committed; projection unavailable', {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        return NextResponse.json({ ok: true, committed: true, overrideLevel,
          projectionUnavailable: true })
      }
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

      return committedResponse()
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

    return committedResponse()
  } catch (error) {
    console.error('[collections.override.post] Failed to upsert customer override', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ error: 'Failed to save customer override' }, { status: 500 })
  }
}
