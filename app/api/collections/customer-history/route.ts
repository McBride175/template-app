import { NextRequest, NextResponse } from 'next/server'
import { CustomerHistoryOperationError, readCustomerHistory } from '@/lib/collections/customer-history-server'

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const result = await readCustomerHistory({
      tenantId: params.get('tenantId'), sourceSystem: params.get('sourceSystem'),
      customerSourceId: params.get('customerSourceId'),
      limit: params.get('limit'), cursor: params.get('cursor'),
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof CustomerHistoryOperationError) {
      const status = { unauthorized: 401, forbidden: 403, not_found: 404, invalid_input: 400 }[error.code]
      return NextResponse.json({ ok: false, code: error.code }, { status })
    }
    console.error('[collections.customer_history] Read failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ ok: false, code: 'unavailable' }, { status: 503 })
  }
}
