import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { isMissingRelationError } from '@/lib/collections/tenant-context'
import { claimActionsEntitlementStatus } from '@/lib/billing/entitlements'

type CollectionActionType = 'called' | 'emailed' | 'postponed'
type CollectionActionOutcome =
  | 'no_response'
  | 'spoke_to_customer'
  | 'promised_to_pay'
  | 'disputed'

const VALID_ACTION_TYPES: CollectionActionType[] = ['called', 'emailed', 'postponed']
const VALID_OUTCOMES: CollectionActionOutcome[] = [
  'no_response',
  'spoke_to_customer',
  'promised_to_pay',
  'disputed',
]

function parseCustomerSourceId(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseActionType(value: unknown): CollectionActionType | null {
  if (typeof value !== 'string') return null
  return VALID_ACTION_TYPES.includes(value as CollectionActionType)
    ? (value as CollectionActionType)
    : null
}

function parseOutcome(value: unknown): CollectionActionOutcome | null {
  if (typeof value !== 'string') return null
  return VALID_OUTCOMES.includes(value as CollectionActionOutcome)
    ? (value as CollectionActionOutcome)
    : null
}

function parseTenantId(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseDateOnly(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null
  const parsed = new Date(`${trimmed}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10) === trimmed ? trimmed : null
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
          action_type?: unknown
          outcome?: unknown
          tenant_id?: unknown
          next_action_date?: unknown
        }
      | null

    const customerSourceId = parseCustomerSourceId(payload?.customer_source_id)
    const actionType = parseActionType(payload?.action_type)
    const outcome = parseOutcome(payload?.outcome)
    const requestedTenantId = parseTenantId(payload?.tenant_id)
    const hasNextActionDate =
      payload?.next_action_date !== undefined && payload?.next_action_date !== null
    const parsedNextActionDate = hasNextActionDate
      ? parseDateOnly(payload?.next_action_date)
      : null

    if (!customerSourceId || !actionType || !outcome) {
      return NextResponse.json(
        {
          error:
            'Invalid request body. Provide customer_source_id, action_type (called|emailed|postponed), and outcome (no_response|spoke_to_customer|promised_to_pay|disputed).',
        },
        { status: 400 }
      )
    }

    if (hasNextActionDate && !parsedNextActionDate) {
      return NextResponse.json(
        { error: 'Invalid next_action_date. Provide an ISO date (YYYY-MM-DD).' },
        { status: 400 }
      )
    }

    const requiresNextActionDate =
      actionType === 'postponed' || outcome === 'promised_to_pay'

    if (hasNextActionDate && !requiresNextActionDate) {
      return NextResponse.json(
        {
          error:
            'next_action_date is only valid for postponed actions and promised_to_pay outcomes.',
        },
        { status: 400 }
      )
    }

    if (requiresNextActionDate && !parsedNextActionDate) {
      return NextResponse.json(
        {
          error:
            'next_action_date is required for postponed actions and promised_to_pay outcomes.',
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
    const { data, error: insertError } = await supabaseAdmin
      .from('collection_actions')
      .insert({
        user_id: user.id,
        tenant_id: tenantId,
        customer_source_id: customerSourceId,
        action_type: actionType,
        outcome,
        next_action_date: parsedNextActionDate,
      })
      .select('id')
      .single<{ id: string }>()

    if (insertError) {
      if (isMissingRelationError(insertError, 'collection_actions')) {
        return NextResponse.json(
          { error: 'Collection action logging is unavailable until database migrations are applied.' },
          { status: 503 }
        )
      }
      return NextResponse.json({ error: 'Failed to log action with outcome' }, { status: 500 })
    }

    if (!data?.id) {
      return NextResponse.json({ error: 'Failed to log action with outcome' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, action_id: data.id })
  } catch (error) {
    console.error('[collections.action_with_outcome.post] Failed to create collection action', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ error: 'Failed to log action with outcome' }, { status: 500 })
  }
}
