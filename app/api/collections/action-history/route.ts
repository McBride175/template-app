import { NextRequest, NextResponse } from 'next/server'
import {
  ActionHistoryInputError, ActionHistoryOperationError,
  createActionHistory, deleteActionHistory, readCustomerActionHistory, readLatestActionHistory,
} from '@/lib/collections/action-history-server'

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

export async function POST(request: Request) {
  try {
    const result = await createActionHistory(await body(request))
    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201 })
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
    return NextResponse.json({ ok: true, ...await deleteActionHistory(await body(request)) })
  } catch (error) { return failure(error) }
}
