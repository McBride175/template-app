import { NextRequest, NextResponse } from 'next/server'
import { authenticateDisputeTenant, InvoiceDisputeOperationError } from '@/lib/collections/invoice-disputes-server'
import { reconcileCollectionFinancialMutation } from '@/lib/collections/financial-mutation-reconciliation-server'

/** Recovery reads derivatives only. No command replay, version advancement or
 * domain writes; authorization is identical to the original mutation surface. */
export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get('tenantId')?.trim()
  const customerSourceId = request.nextUrl.searchParams.get('customerSourceId')?.trim()
  if (!tenantId || !customerSourceId) return NextResponse.json({ error: 'Tenant and customer are required.' }, { status: 400 })
  try {
    const context = await authenticateDisputeTenant(tenantId)
    const reconciliation = await reconcileCollectionFinancialMutation({ ...context, customerSourceId })
    return NextResponse.json({ ok: true, reconciliation }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const status = error instanceof InvoiceDisputeOperationError
      ? { unauthorized: 401, forbidden: 403, not_found: 404, invalid_input: 400, conflict: 409 }[error.code] : 503
    return NextResponse.json({ error: 'Current collection details are unavailable.' }, { status })
  }
}
