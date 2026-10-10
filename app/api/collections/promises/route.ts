import { NextRequest, NextResponse } from 'next/server'
import { loadPromiseWorklist } from '@/lib/collections/promise-worklist-server'
import { parsePromiseWorklist, PromiseWorklistInputError } from '@/lib/collections/promise-worklist'
import { InvoiceDisputeOperationError } from '@/lib/collections/invoice-disputes-server'
export async function GET(request: NextRequest) {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
  try {
    const params = request.nextUrl.searchParams
    return json(await loadPromiseWorklist({ tenantId: params.get('tenantId'), query: parsePromiseWorklist(params) }))
  } catch (error) {
    if (error instanceof PromiseWorklistInputError) return json({ ok: false, error: error.message }, 400)
    if (error instanceof InvoiceDisputeOperationError) {
      const status = error.code === 'unauthorized' ? 401 : error.code === 'forbidden' ? 403 : error.code === 'invalid_input' ? 400 : 409
      return json({ ok: false, error: status === 401 ? 'Sign in to view promises.' : status === 403 ? 'Promise access is unavailable for this organisation or plan.' : 'Promise context is unavailable.' }, status)
    }
    console.error('Promise worklist unavailable', { type: error instanceof Error ? error.name : 'unknown' })
    return json({ ok: false, error: 'Could not load promises. Please retry.' }, 500)
  }
}
