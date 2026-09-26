import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const calls = []
class InvoiceDisputeOperationError extends Error {
  constructor(code) { super(code); this.code = code }
}
class InvoiceDisputeDomainError extends Error {
  constructor(code) { super(code); this.code = code }
}
const server = {
  InvoiceDisputeOperationError,
  loadCustomerInvoiceDisputes: async (params) => {
    calls.push(['read', params])
    return [{ invoiceSourceId: 'invoice-a', currentAmountDueNative: '8000' }]
  },
  setFullInvoiceDispute: async (params) => {
    calls.push(['full', params])
    if (params.invoiceSourceId === 'conflict') throw new InvoiceDisputeOperationError('conflict')
    return { id: 'dispute-a', recorded_disputed_amount_native: '8000' }
  },
  setPartialInvoiceDispute: async (params) => {
    calls.push(['partial', params])
    if (params.disputedAmountNative === '9000') throw new InvoiceDisputeDomainError('invalid_amount')
    return { id: 'dispute-a', recorded_disputed_amount_native: params.disputedAmountNative }
  },
  setFullCustomerInvoiceDisputes: async (params) => {
    calls.push(['bulk_full', params])
    return [{ id: 'dispute-a' }]
  },
  editInvoiceDisputeNote: async (params) => { calls.push(['note', params]); return {} },
  resolveInvoiceDispute: async (params) => { calls.push(['resolve', params]); return {} },
  reactivateInvoiceDispute: async (params) => { calls.push(['reactivate', params]); return {} },
  confirmInvoiceDisputeReview: async (params) => { calls.push(['confirm', params]); return {} },
}
const { GET, POST } = loadTypeScriptModule('app/api/collections/invoice-disputes/route.ts', {
  mocks: {
    'next/server': {
      NextResponse: {
        json(body, init = {}) {
          return new Response(JSON.stringify(body), {
            status: init.status ?? 200,
            headers: { 'content-type': 'application/json' },
          })
        },
      },
    },
    '@/lib/collections/invoice-disputes-server': server,
    '@/lib/collections/invoice-disputes': { InvoiceDisputeDomainError },
  },
})

function request(body) {
  return new Request('http://localhost/api/collections/invoice-disputes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

test('invoice dispute route passes only intent to the scoped server operations', async () => {
  calls.length = 0
  const read = await GET({ nextUrl: new URL('http://localhost/api/collections/invoice-disputes?tenantId=tenant-a&customerSourceId=customer-a') })
  assert.equal(read.status, 200)
  assert.deepEqual(calls[0], ['read', { tenantId: 'tenant-a', customerSourceId: 'customer-a' }])

  const full = await POST(request({ operation: 'full', tenantId: 'tenant-a', invoiceSourceId: 'invoice-a', amountDue: '10000', note: 'Check goods' }))
  assert.equal(full.status, 200)
  assert.deepEqual(calls[1], ['full', { tenantId: 'tenant-a', invoiceSourceId: 'invoice-a',
    note: 'Check goods', expectedRevision: undefined }])

  const bulk = await POST(request({ operation: 'bulk_full', tenantId: 'tenant-a', customerSourceId: 'customer-a',
    invoiceSourceIds: ['invoice-a'], expectedRevisions: [] }))
  assert.equal(bulk.status, 200)
  assert.deepEqual(calls[2], ['bulk_full', { tenantId: 'tenant-a', customerSourceId: 'customer-a',
    invoiceSourceIds: ['invoice-a'], expectedRevisions: [] }])
})

test('invoice dispute route rejects malformed partial input and returns a useful stale-balance error', async () => {
  calls.length = 0
  for (const disputedAmountNative of ['-1', '1e3', '0.123456789']) {
    const invalid = await POST(request({ operation: 'partial', tenantId: 'tenant-a', invoiceSourceId: 'invoice-a', disputedAmountNative }))
    assert.equal(invalid.status, 400)
  }
  assert.equal(calls.length, 0)

  const stale = await POST(request({ operation: 'partial', tenantId: 'tenant-a', invoiceSourceId: 'invoice-a', disputedAmountNative: '9000' }))
  assert.equal(stale.status, 409)
  assert.match((await stale.json()).error, /current invoice balance/i)
  assert.deepEqual(calls[0], ['partial', { tenantId: 'tenant-a', invoiceSourceId: 'invoice-a',
    disputedAmountNative: '9000', note: undefined, expectedRevision: undefined }])
})

test('existing-row routes require a valid revision and forward only intent', async () => {
  calls.length = 0
  for (const operation of ['note', 'resolve', 'reactivate', 'confirm']) {
    const missing = await POST(request({ operation, tenantId: 'tenant-a',
      disputeId: 'dispute-a', note: 'Updated' }))
    assert.equal(missing.status, 400)
    const valid = await POST(request({ operation, tenantId: 'tenant-a',
      disputeId: 'dispute-a', expected_revision: '7', note: 'Updated' }))
    assert.equal(valid.status, 200)
    const forwarded = calls.at(-1)
    assert.equal(forwarded[0], operation)
    assert.equal(forwarded[1].expectedRevision, '7')
  }
  const edited = await POST(request({ operation: 'full', tenantId: 'tenant-a',
    invoiceSourceId: 'invoice-a', expected_revision: '8', is_active: true,
    amountDue: '9999' }))
  assert.equal(edited.status, 200)
  assert.deepEqual(calls.at(-1), ['full', { tenantId: 'tenant-a', invoiceSourceId: 'invoice-a',
    note: undefined, expectedRevision: '8' }])
  const invalid = await POST(request({ operation: 'full', tenantId: 'tenant-a',
    invoiceSourceId: 'invoice-a', expected_revision: '0' }))
  assert.equal(invalid.status, 400)
})

test('bulk route forwards selected revisions and rejects malformed revision entries', async () => {
  calls.length = 0
  const invalid = await POST(request({ operation: 'bulk_full', tenantId: 'tenant-a',
    customerSourceId: 'customer-a', expectedRevisions: [{ invoiceSourceId: 'invoice-a', revision: '0' }] }))
  assert.equal(invalid.status, 400)
  assert.equal(calls.length, 0)
  const valid = await POST(request({ operation: 'bulk_full', tenantId: 'tenant-a',
    customerSourceId: 'customer-a', expectedRevisions: [{ invoiceSourceId: 'invoice-a', revision: '5' }] }))
  assert.equal(valid.status, 200)
  assert.deepEqual(calls[0][1].expectedRevisions,
    [{ invoiceSourceId: 'invoice-a', revision: '5' }])
})

test('stale revision receives a safe conflict response with refresh guidance', async () => {
  const stale = await POST(request({ operation: 'full', tenantId: 'tenant-a',
    invoiceSourceId: 'conflict', expected_revision: '2' }))
  assert.equal(stale.status, 409)
  const body = await stale.json()
  assert.equal(body.code, 'conflict')
  assert.match(body.error, /Refresh and review the latest version/i)
})
