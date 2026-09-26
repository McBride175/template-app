import { NextRequest, NextResponse } from 'next/server'
import {
  confirmInvoiceDisputeReview,
  editInvoiceDisputeNote,
  InvoiceDisputeOperationError,
  loadCustomerInvoiceDisputes,
  reactivateInvoiceDispute,
  resolveInvoiceDispute,
  setFullCustomerInvoiceDisputes,
  setFullInvoiceDispute,
  setPartialInvoiceDispute,
} from '@/lib/collections/invoice-disputes-server'
import { InvoiceDisputeDomainError } from '@/lib/collections/invoice-disputes'

type Mutation = Record<string, unknown>

function requiredString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function optionalNote(value: unknown) {
  return value === undefined || value === null ||
    (typeof value === 'string' && value.length <= 2000)
}

function expectedRevision(value: unknown) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) &&
    BigInt(value) <= BigInt('9223372036854775807') ? value : null
}

function bulkRevisions(value: unknown) {
  if (!Array.isArray(value)) return null
  const entries: Array<{ invoiceSourceId: string; revision: string }> = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const record = item as Record<string, unknown>
    const invoiceSourceId = requiredString(record.invoiceSourceId)
    const revision = expectedRevision(record.revision)
    if (!invoiceSourceId || !revision) return null
    entries.push({ invoiceSourceId, revision })
  }
  return entries
}

function errorResponse(error: unknown) {
  if (error instanceof InvoiceDisputeOperationError) {
    const status = {
      unauthorized: 401, forbidden: 403, not_found: 404, invalid_input: 400, conflict: 409,
    }[error.code]
    const message = {
      unauthorized: 'Your session has expired. Sign in again.',
      forbidden: 'This tenant is unavailable to your account or collections access is restricted.',
      not_found: 'The invoice or dispute is no longer available in current accounting data.',
      invalid_input: 'Check the invoice selection and try again.',
      conflict: 'This dispute changed since you loaded it. Refresh and review the latest version before saving.',
    }[error.code]
    return NextResponse.json({ error: message, code: error.code }, { status })
  }
  if (error instanceof InvoiceDisputeDomainError) {
    const message = error.code === 'invalid_amount'
      ? 'The partial amount must be greater than zero and no more than the current invoice balance. Refresh and check the amount.'
      : 'This invoice is no longer an open receivable. Refresh and try again.'
    return NextResponse.json({ error: message, code: error.code }, { status: 409 })
  }
  console.error('[collections.invoice-disputes] Operation failed', {
    errorType: error instanceof Error ? error.name : 'Unknown',
  })
  return NextResponse.json({ error: 'Could not update invoice disputes. Try again.' }, { status: 500 })
}

export async function GET(request: NextRequest) {
  const tenantId = requiredString(request.nextUrl.searchParams.get('tenantId'))
  const customerSourceId = requiredString(request.nextUrl.searchParams.get('customerSourceId'))
  if (!tenantId || !customerSourceId) {
    return NextResponse.json({ error: 'Tenant and customer are required.' }, { status: 400 })
  }
  try {
    const invoices = await loadCustomerInvoiceDisputes({ tenantId, customerSourceId })
    return NextResponse.json({ ok: true, invoices })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Mutation | null
  const tenantId = requiredString(body?.tenantId)
  if (!tenantId || !body || !optionalNote(body.note)) {
    return NextResponse.json({ error: 'Check the tenant and note (maximum 2,000 characters).' }, { status: 400 })
  }
  const invoiceSourceId = requiredString(body.invoiceSourceId)
  const disputeId = requiredString(body.disputeId)
  const revision = body.expected_revision === undefined ? undefined : expectedRevision(body.expected_revision)
  const note = body.note === undefined ? undefined : body.note as string | null
  try {
    switch (body.operation) {
      case 'full': {
        if (!invoiceSourceId || revision === null) break
        const dispute = await setFullInvoiceDispute({ tenantId, invoiceSourceId, note, expectedRevision: revision })
        return NextResponse.json({ ok: true, dispute })
      }
      case 'partial': {
        if (!invoiceSourceId || revision === null || typeof body.disputedAmountNative !== 'string' ||
          !/^\d+(?:\.\d{1,8})?$/.test(body.disputedAmountNative.trim())) break
        const dispute = await setPartialInvoiceDispute({
          tenantId, invoiceSourceId, disputedAmountNative: body.disputedAmountNative, note,
          expectedRevision: revision,
        })
        return NextResponse.json({ ok: true, dispute })
      }
      case 'note': {
        if (!disputeId || !revision || body.note === undefined) break
        const dispute = await editInvoiceDisputeNote({ tenantId, disputeId, note: note ?? null, expectedRevision: revision })
        return NextResponse.json({ ok: true, dispute })
      }
      case 'resolve': {
        if (!disputeId || !revision) break
        const dispute = await resolveInvoiceDispute({ tenantId, disputeId, expectedRevision: revision })
        return NextResponse.json({ ok: true, dispute })
      }
      case 'reactivate': {
        if (!disputeId || !revision) break
        const dispute = await reactivateInvoiceDispute({ tenantId, disputeId, expectedRevision: revision })
        return NextResponse.json({ ok: true, dispute })
      }
      case 'confirm': {
        if (!disputeId || !revision) break
        const dispute = await confirmInvoiceDisputeReview({ tenantId, disputeId, expectedRevision: revision })
        return NextResponse.json({ ok: true, dispute })
      }
      case 'bulk_full': {
        const customerSourceId = requiredString(body.customerSourceId)
        const revisions = bulkRevisions(body.expectedRevisions)
        if (!customerSourceId || !revisions ||
          (body.invoiceSourceIds !== undefined &&
            (!Array.isArray(body.invoiceSourceIds) ||
              body.invoiceSourceIds.some((id: unknown) => !requiredString(id))))) break
        const disputes = await setFullCustomerInvoiceDisputes({
          tenantId,
          customerSourceId,
          invoiceSourceIds: body.invoiceSourceIds as string[] | undefined,
          expectedRevisions: revisions,
        })
        return NextResponse.json({ ok: true, disputes })
      }
    }
    return NextResponse.json({ error: 'Invalid dispute operation or missing fields.' }, { status: 400 })
  } catch (error) {
    return errorResponse(error)
  }
}
