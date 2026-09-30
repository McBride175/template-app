import assert from 'node:assert/strict'
import test from 'node:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const actionId = '00000000-0000-4000-8000-000000000001'
const events = [
  { id: `action:${actionId}`, kind: 'action', timestamp: '2026-09-30T10:34:00Z',
    label: 'No response', detail: null, note: 'Remember the call', followUpDate: '2026-10-01',
    invoiceSourceId: null, invoiceReference: null, deletable: true, actionId },
  { id: 'promise:00000000-0000-4000-8000-000000000002', kind: 'promise',
    timestamp: '2026-09-29T10:00:00Z', label: 'Promise recorded',
    detail: 'Promised £1,500 by 2 Oct 2026', note: null, followUpDate: null,
    invoiceSourceId: 'invoice-a', invoiceReference: 'INV-104', deletable: false, actionId: null },
  { id: 'dispute-created:00000000-0000-4000-8000-000000000003', kind: 'dispute',
    timestamp: '2026-09-28T10:00:00Z', label: 'Dispute raised', detail: null, note: null,
    followUpDate: null, invoiceSourceId: 'invoice-b', invoiceReference: null,
    deletable: false, actionId: null },
]

function setup({ initialCursor = null, deleteError = false } = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/' })
  const previous = Object.fromEntries(['window', 'document', 'HTMLElement', 'MouseEvent',
    'IS_REACT_ACT_ENVIRONMENT', 'fetch'].map(key => [key, globalThis[key]]))
  Object.assign(globalThis, { window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, MouseEvent: dom.window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true })
  const requests = []
  dom.window.confirm = () => true
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null })
    if (String(url) === '/api/collections/action-history') {
      if (deleteError) throw Error('Connection lost')
      return new Response(JSON.stringify({ ok: true, deleted: true, actionId }), { status: 200 })
    }
    assert.match(String(url), /^\/api\/collections\/customer-history\?/)
    return new Response(JSON.stringify({ ok: true, events: events.slice(1), nextCursor: null }), { status: 200 })
  }
  const Link = ({ children, href, ...props }) => React.createElement('a', { href, ...props }, children)
  const { default: Component } = loadTypeScriptModule(
    'app/customers/[customerSourceId]/history/CustomerHistoryClient.tsx',
    { mocks: { react: React, 'react/jsx-runtime': awaitableJsxRuntime, 'next/link': Link } }
  )
  const container = dom.window.document.getElementById('root')
  const root = createRoot(container)
  const render = async () => act(async () => root.render(React.createElement(Component, {
    tenantId: 'tenant-a', customerSourceId: 'customer-a', customerName: 'Customer A',
    initialEvents: initialCursor ? events.slice(0, 1) : events, initialCursor,
  })))
  const click = async label => {
    const button = [...container.querySelectorAll('button')].find(node => node.textContent.trim() === label)
    assert.ok(button, `missing ${label}`)
    await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
  }
  const cleanup = async () => {
    await act(async () => root.unmount())
    Object.assign(globalThis, previous)
    dom.window.close()
  }
  return { render, click, cleanup, requests, container }
}

const awaitableJsxRuntime = await import('react/jsx-runtime')

test('history renders mixed events and only generic action offers exact-ID deletion and refresh', async () => {
  const app = setup()
  try {
    await app.render()
    assert.match(app.container.textContent, /No response.*Remember the call.*Follow up 1 Oct 2026/s)
    assert.match(app.container.textContent, /Promise recorded.*Invoice INV-104.*£1,500/s)
    assert.match(app.container.textContent, /Dispute raised.*Invoice invoice-b/s)
    assert.equal(app.container.querySelectorAll('button').length, 1)
    await app.click('Delete')
    assert.deepEqual(app.requests[0].body, { action_id: actionId,
      tenant_id: 'tenant-a', source_system: 'xero', customer_source_id: 'customer-a' })
    assert.match(app.requests[1].url, /^\/api\/collections\/customer-history\?/)
    assert.doesNotMatch(app.container.textContent, /No response/)
    assert.match(app.container.textContent, /Promise recorded/)
    assert.match(app.container.textContent, /Dispute raised/)
    assert.equal(app.requests.some(request => request.url.includes('/actions?')), false)
  } finally { await app.cleanup() }
})

test('bounded load-more uses cursor; uncertain deletion keeps row and reports error', async () => {
  const app = setup({ initialCursor: 'cursor-1', deleteError: true })
  try {
    await app.render()
    await app.click('Load more history')
    assert.match(app.requests[0].url, /cursor=cursor-1/)
    await app.click('Delete')
    assert.match(app.container.textContent, /No response/)
    assert.match(app.container.querySelector('[role="alert"]').textContent, /Could not confirm deletion/)
  } finally { await app.cleanup() }
})
