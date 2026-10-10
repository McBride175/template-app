import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const Filters = loadTypeScriptModule('app/disputes/DisputesFilters.tsx').default
const { revealPriority } = loadTypeScriptModule('app/collections/actions/QueueNavigation.tsx')
const query = { status: 'needs_review', customer: 'synthetic', q: 'INV-7', sort: 'oldest', page: 3, pageSize: 50 }
const props = { query, tenantId: 'synthetic-tenant', customers: [{ sourceId: 'synthetic', name: 'Synthetic customer' }], blocked: false }

test('disclosure keeps every existing GET field mounted, including hidden selected values and scope', () => {
  const dom = new JSDOM(renderToStaticMarkup(createElement(Filters, props)))
  const form = dom.window.document.querySelector('form')
  assert.equal(form.method, 'get')
  assert.equal(form.getAttribute('action'), '/disputes')
  assert.deepEqual(Object.fromEntries(new dom.window.FormData(form)), {
    tenantId: 'synthetic-tenant', pageSize: '50', q: 'INV-7', status: 'needs_review', customer: 'synthetic', sort: 'oldest',
  })
  const button = form.querySelector('button[aria-expanded]')
  assert.equal(button.getAttribute('aria-expanded'), 'false')
  assert.match(button.textContent, /3 active/)
  assert.ok(dom.window.document.getElementById(button.getAttribute('aria-controls')))
  const reset = new URL(form.querySelector('a').href, 'http://localhost')
  assert.equal(reset.searchParams.get('tenantId'), 'synthetic-tenant')
  assert.equal(reset.searchParams.get('pageSize'), '50')
  assert.equal(reset.searchParams.get('page'), '1')
  assert.equal(reset.searchParams.get('status'), 'active')
  assert.equal(reset.searchParams.has('q'), false)
  assert.equal(reset.searchParams.has('customer'), false)
})

test('blocked disputes retain values and disable filter submission and clear navigation', () => {
  const dom = new JSDOM(renderToStaticMarkup(createElement(Filters, { ...props, blocked: true })))
  assert.equal(dom.window.document.querySelector('fieldset').disabled, true)
  assert.equal(dom.window.document.querySelector('a').getAttribute('aria-disabled'), 'true')
  assert.equal(dom.window.document.querySelector('a').tabIndex, -1)
})

test('public and onboarding logo links keep the public home destination and decorative artwork', () => {
  for (const pathname of ['/', '/start', '/start/result']) {
    const Nav = loadTypeScriptModule('app/components/Nav.tsx', { mocks: {
      'next/navigation': { usePathname: () => pathname },
      './useNavigationSession': () => ({ loading: false, user: null, signingOut: false, signOutError: null, signOut() {} }),
    } }).default
    const dom = new JSDOM(renderToStaticMarkup(createElement(Nav)))
    const link = dom.window.document.querySelector('a[aria-label="Yuohme home"]')
    assert.equal(link.getAttribute('href'), '/')
    assert.ok([...link.querySelectorAll('img')].every(image => image.alt === ''))
  }
})

test('returning to a priority restores focus and respects reduced motion without scrolling visible content', () => {
  const previous = globalThis.window
  globalThis.window = { innerHeight: 844, matchMedia: () => ({ matches: true }) }
  try {
    let top = 900
    const focused = [], scrolled = []
    const element = { focus: options => focused.push(options), getBoundingClientRect: () => ({ top }), scrollIntoView: options => scrolled.push(options) }
    revealPriority(element)
    assert.deepEqual(focused, [{ preventScroll: true }])
    assert.deepEqual(scrolled, [{ block: 'start', behavior: 'auto' }])
    top = 20
    revealPriority(element)
    assert.equal(scrolled.length, 1)
  } finally { globalThis.window = previous }
})
