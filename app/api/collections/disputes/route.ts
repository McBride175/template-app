import { NextRequest, NextResponse } from 'next/server'
import { loadDisputeWorklist } from '@/lib/collections/dispute-worklist-server'
import { parseDisputeWorklistQuery } from '@/lib/collections/dispute-worklist'
import { InvoiceDisputeOperationError } from '@/lib/collections/invoice-disputes-server'

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const worklist = await loadDisputeWorklist({
      tenantId: params.get('tenantId')?.trim() || null,
      query: parseDisputeWorklistQuery(params),
    })
    return NextResponse.json(worklist)
  } catch (error) {
    if (error instanceof InvoiceDisputeOperationError) {
      const status = { unauthorized: 401, forbidden: 403, not_found: 404, invalid_input: 400, conflict: 409 }[error.code]
      return NextResponse.json({ code: error.code, error: error.code === 'unauthorized'
        ? 'Your session has expired. Sign in again.'
        : 'Disputes are unavailable for this account or tenant. Check your collections access.' }, { status })
    }
    console.error('[collections.disputes] Read failed', {
      errorType: error instanceof Error ? error.name : 'Unknown',
    })
    return NextResponse.json({ error: 'Could not load disputes. Refresh and try again.' }, { status: 500 })
  }
}
