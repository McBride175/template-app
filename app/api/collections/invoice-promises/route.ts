import { NextRequest, NextResponse } from 'next/server'
import { InvoicePromiseOperationError, mutateInvoicePromise, readInvoicePromiseContext, readInvoicePromiseHistory } from '@/lib/collections/invoice-promises-server'

function failure(error: unknown) {
  if (error instanceof InvoicePromiseOperationError) {
    const status = { unauthorized: 401, forbidden: 403, not_found: 404, invalid_input: 400, conflict: 409, temporarily_unavailable: 503 }[error.code]
    return NextResponse.json({ code: error.code, error: error.code === 'conflict'
      ? 'Accounting or Promise state changed. Refresh and review before saving.'
      : error.code === 'temporarily_unavailable' ? 'Certified accounting evidence is temporarily unavailable.' : 'Could not complete this Promise request.' }, { status })
  }
  return NextResponse.json({ error: 'Could not complete this Promise request.' }, { status: 500 })
}
export async function POST(request: Request) {
  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }) }
  try { return NextResponse.json({ ok: true, ...await mutateInvoicePromise(body) }) } catch (error) { return failure(error) }
}
export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get('tenantId')
  const invoiceSourceId = request.nextUrl.searchParams.get('invoiceSourceId')
  const promiseId = request.nextUrl.searchParams.get('promiseId')
  if (!tenantId || (!invoiceSourceId && !promiseId) || (invoiceSourceId && promiseId)) return NextResponse.json({ error: 'Tenant and one invoice or Promise identity are required.' }, { status: 400 })
  try {
    return NextResponse.json({ ok: true, ...promiseId ? { events: await readInvoicePromiseHistory({ tenantId, promiseId }) }
      : await readInvoicePromiseContext({ tenantId, invoiceSourceId: invoiceSourceId!, includeHistory: request.nextUrl.searchParams.get('includeHistory') === 'true' }) })
  } catch (error) { return failure(error) }
}
