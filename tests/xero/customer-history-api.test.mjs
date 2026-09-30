import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

function route(errorCode = null) {
  const calls = []
  class OperationError extends Error { constructor(code) { super(code); this.code = code } }
  const handler = loadTypeScriptModule('app/api/collections/customer-history/route.ts', { mocks: {
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) } },
    '@/lib/collections/customer-history-server': {
      CustomerHistoryOperationError: OperationError,
      readCustomerHistory: async input => {
        calls.push(input)
        if (errorCode) throw new OperationError(errorCode)
        return { customer: { sourceId: input.customerSourceId }, events: [], nextCursor: null }
      },
    },
  } })
  return { ...handler, calls }
}

test('customer-scoped API forwards provider, customer and cursor to the server contract', async () => {
  const app = route()
  const response = await app.GET({ nextUrl: new URL('https://example.test/?tenantId=tenant-a&sourceSystem=xero&customerSourceId=customer-a&limit=20&cursor=opaque') })
  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
  assert.deepEqual(app.calls[0], { tenantId: 'tenant-a', sourceSystem: 'xero',
    customerSourceId: 'customer-a', limit: '20', cursor: 'opaque' })
})

for (const [code, status] of [['unauthorized', 401], ['forbidden', 403], ['not_found', 404], ['invalid_input', 400]]) {
  test(`${code} history access returns only a scoped error code`, async () => {
    const app = route(code)
    const response = await app.GET({ nextUrl: new URL('https://example.test/?tenantId=t') })
    assert.equal(response.status, status)
    assert.deepEqual(response.body, { ok: false, code })
  })
}
