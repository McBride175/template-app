import { NextRequest, NextResponse } from 'next/server'
import {
  ActionHistoryInputError, ActionHistoryOperationError,
  createActionHistory, deleteActionHistory, readCustomerActionHistory, readLatestActionHistory,
  type ActionHistoryCommandContext,
} from '@/lib/collections/action-history-server'
import { readCollectionQueueProjection } from '@/lib/collections/fast-queue-projection-server'
import { resolveCollectionsCurrencyAccess } from '@/lib/billing/collections-access'

function failure(error: unknown) {
  if (error instanceof ActionHistoryInputError) {
    return NextResponse.json({ ok: false, code: 'invalid_input', error: error.message }, { status: 400 })
  }
  if (error instanceof ActionHistoryOperationError) {
    const status = { unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409 }[error.code]
    return NextResponse.json({ ok: false, code: error.code }, { status })
  }
  console.error('[collections.action_history] Operation failed', {
    error: error instanceof Error ? error.message : 'Unknown error',
  })
  return NextResponse.json({ ok: false, code: 'unavailable' }, { status: 503 })
}

async function body(request: Request) {
  const value: unknown = await request.json().catch(() => {
    throw new ActionHistoryInputError('Invalid JSON')
  })
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ActionHistoryInputError('Expected an object')
  }
  return value as Record<string, unknown>
}

async function committedProjection(input: Record<string, unknown>, context: ActionHistoryCommandContext) {
  try {
    const projection = await readCollectionQueueProjection({
      admin: context.admin, userId: context.userId, tenantId: context.tenantId,
      evaluationInstant: new Date(), overdueOnly: input.queue_overdue_only === true,
      requireCurrentDate: true,
      limit: Number.isInteger(input.queue_limit)
        ? Math.max(1, Math.min(200, input.queue_limit as number)) : 200,
      legacyTodayDateIso: context.entitlement.usageDate,
    })
    const currencyAccess = resolveCollectionsCurrencyAccess({
      entitlement: context.entitlement,
      currencyContext: projection.metadata.currencyContext,
    })
    // The action has committed, but its response must obey the same queue-view
    // entitlement as GET. Recovery reads enforce that boundary as well.
    if (!currencyAccess.allowed) return { projectionUnavailable: true }
    return { projection: { rows: projection.rows,
      actionsTakenByCustomerId: projection.actionsTakenByCustomerId,
      queue: projection.queue, portfolio: projection.portfolio, version: projection.version,
      experience: projection.experience, reviewRequiredCustomers: projection.reviews,
      organisationBaseCurrency: projection.metadata.organisationBaseCurrency,
      currencyContext: projection.metadata.currencyContext,
      currencyHealth: projection.metadata.currencyHealth, currencyAccess,
      followUpSchedule: projection.followUpSchedule, tenantId: context.tenantId,
      entitlement: context.entitlement } }
  } catch (error) {
    console.error('[collections.action_history] Action committed; projection unavailable', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return { projectionUnavailable: true }
  }
}

export async function POST(request: Request) {
  try {
    const input = await body(request)
    const result = await createActionHistory(input, new Date(),
      context => committedProjection(input, context))
    return NextResponse.json({ ok: true, committed: true, ...result }, { status: result.replayed ? 200 : 201 })
  } catch (error) { return failure(error) }
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const input = {
      tenant_id: params.get('tenantId'),
      source_system: params.get('sourceSystem'),
      customer_source_id: params.get('customerSourceId'),
      limit: params.get('limit'),
      cursor: params.get('cursor'),
    }
    const view = params.get('view')
    if (view === 'latest') {
      return NextResponse.json({ ok: true, action: await readLatestActionHistory(input) })
    }
    if (view === 'history') {
      return NextResponse.json({ ok: true, ...await readCustomerActionHistory(input) })
    }
    throw new ActionHistoryInputError('Invalid view')
  } catch (error) { return failure(error) }
}

export async function DELETE(request: Request) {
  try {
    const input = await body(request)
    const result = await deleteActionHistory(input,
      context => committedProjection(input, context))
    return NextResponse.json({ ok: true, committed: true, ...result })
  } catch (error) { return failure(error) }
}
