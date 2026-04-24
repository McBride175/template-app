import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import {
  isMissingRelationError,
  resolveCollectionsTenantId,
} from '@/lib/collections/tenant-context'

type CollectionActionType = 'called' | 'emailed' | 'postponed'

const VALID_ACTION_TYPES: CollectionActionType[] = ['called', 'emailed', 'postponed']
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

function parseActionId(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!UUID_REGEX.test(trimmed)) return null
  return trimmed
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
          tenant_id?: unknown
          next_action_date?: unknown
        }
      | null

    const customerSourceId = parseCustomerSourceId(payload?.customer_source_id)
    const actionType = parseActionType(payload?.action_type)
    const requestedTenantId = parseTenantId(payload?.tenant_id)
    const hasNextActionDate =
      payload?.next_action_date !== undefined && payload?.next_action_date !== null
    const parsedNextActionDate = hasNextActionDate
      ? parseDateOnly(payload?.next_action_date)
      : null

    if (!customerSourceId || !actionType) {
      return NextResponse.json(
        {
          error:
            'Invalid request body. Provide customer_source_id and action_type (called|emailed|postponed).',
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

    if (actionType !== 'postponed' && hasNextActionDate) {
      return NextResponse.json(
        { error: 'next_action_date is only valid when action_type is postponed.' },
        { status: 400 }
      )
    }

    if (actionType === 'postponed' && !parsedNextActionDate) {
      return NextResponse.json(
        { error: 'next_action_date is required when action_type is postponed.' },
        { status: 400 }
      )
    }

    const tenantId = await resolveCollectionsTenantId(supabase, user.id, requestedTenantId)
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant context found' }, { status: 400 })
    }

    const { data, error: insertError } = await supabase
      .from('collection_actions')
      .insert({
        user_id: user.id,
        tenant_id: tenantId,
        customer_source_id: customerSourceId,
        action_type: actionType,
        outcome: null,
        next_action_date: actionType === 'postponed' ? parsedNextActionDate : null,
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
      return NextResponse.json({ error: 'Failed to log action' }, { status: 500 })
    }

    if (!data?.id) {
      return NextResponse.json({ error: 'Failed to log action' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, action_id: data.id })
  } catch (error) {
    console.error('[collections.action.post] Failed to create collection action', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ error: 'Failed to log action' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
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
          action_id?: unknown
        }
      | null

    const actionId = parseActionId(payload?.action_id)
    if (!actionId) {
      return NextResponse.json(
        { error: 'Invalid request body. Provide action_id as a UUID.' },
        { status: 400 }
      )
    }

    const { data, error: deleteError } = await supabase
      .from('collection_actions')
      .delete()
      .eq('id', actionId)
      .eq('user_id', user.id)
      .select('id')
      .maybeSingle<{ id: string }>()

    if (deleteError) {
      if (isMissingRelationError(deleteError, 'collection_actions')) {
        return NextResponse.json(
          { error: 'Collection action logging is unavailable until database migrations are applied.' },
          { status: 503 }
        )
      }
      return NextResponse.json({ error: 'Failed to undo action' }, { status: 500 })
    }

    if (!data?.id) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[collections.action.delete] Failed to undo collection action', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ error: 'Failed to undo action' }, { status: 500 })
  }
}
