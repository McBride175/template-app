import test from 'node:test'
import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const schedule = { today: '2026-09-30', tomorrow: '2026-10-01', inTwoDays: '2026-10-02',
  inThreeDays: '2026-10-03', nextWeek: '2026-10-07', timezone: 'Europe/London' }

function row(id) {
  return {
    customer_source_id: id, customer_name: `${id} Ltd`, customer_email: null,
    customer_to_chase_overdue_base: 100, customer_credit_applied_base: 0,
    overdue_outstanding_base: 100, effective_disputed_overdue_base_decimal: '0',
    active_promised_overdue_base_decimal: '0', weighted_avg_overdue_days: 20,
    last_payment_date: null, collectible_native_currency_breakdown: [],
    has_actionable_overdue_balance: true, override_level: 'normal',
    recommended_action: 'Follow up', queue_eligibility_reason: 'eligible',
    last_action_type: null, last_action_outcome: null, last_action_timestamp: null,
    priority_score: 50, reason: 'Current debt', score_breakdown_lines: [],
  }
}

function setup(options = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' })
  const previous = Object.fromEntries(['window', 'document', 'HTMLElement', 'MouseEvent',
    'Event', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'].map((key) => [key, globalThis[key]]))
  Object.assign(globalThis, { window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    MouseEvent: dom.window.MouseEvent, Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true })
  const stored = [...(options.initialActions ?? [])]
  const requests = []
  let getCount = 0
  let postCount = 0
  let deleteCount = 0
  let revision = 0
  let releasePost = () => {}
  const heldPost = new Promise((resolve) => { releasePost = resolve })
  const baseRows = options.rows ?? [row('alpha'), row('beta')]
  const queue = () => {
    const rows = baseRows.filter((item) => {
      const latest = stored.filter((action) => action.customer_source_id === item.customer_source_id).at(-1)
      return !latest || latest.next_action_date <= schedule.today
    }).sort((a, b) => b.priority_score - a.priority_score)
    return { ok: true, tenantId: 'tenant', rows, actionsTakenByCustomerId: {},
      ...(options.withProjection ? { version: { accountingGenerationId: 'generation-a',
        financialEpoch: '1', financialCalculationId: 'calculation-a',
        projectionRevision: String(revision), evaluationDate: '2026-09-30' } } : {}),
      followUpSchedule: schedule, organisationBaseCurrency: 'GBP',
      currencyHealth: { status: 'healthy', rankingStatus: 'complete', affectedInvoiceCount: 0,
        affectedCustomerCount: 0, failureReasons: {} },
      currencyContext: { mode: 'single_currency', invoicedCurrencies: ['GBP'], relevantInvoiceCount: 2 },
      currencyAccess: { allowed: true, requiresPro: false, reason: 'allowed' },
      reviewRequiredCustomers: [], experience: { hasPriorCollectionActivity: true },
      queue: { status: rows.length ? 'ready' : 'complete_today', remainingCustomerCount: rows.length,
        eligibleCustomerCount: baseRows.length, actionedTodayCount: 0, suppressedCustomerCount: baseRows.length - rows.length,
        returnedCustomerCount: rows.length, reviewRequiredCustomerCount: 0 },
    }
  }
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET'
    requests.push({ url: String(url), method, body: init.body ? JSON.parse(init.body) : null })
    if (String(url).startsWith('/api/collections/actions?')) {
      getCount++
      return new Response(JSON.stringify(queue()), { status: 200 })
    }
    if (String(url) === '/api/collections/override' && method === 'POST') {
      const body = JSON.parse(init.body)
      const target = baseRows.find(item => item.customer_source_id === body.customer_source_id)
      target.override_level = body.override_level
      target.priority_score = body.override_level === 'priority' ? 80 : 50
      revision++
      return new Response(JSON.stringify({ ok: true, committed: true,
        ...(options.withProjection ? { projection: queue() } : { projectionUnavailable: true }) }), { status: 200 })
    }
    assert.equal(String(url), '/api/collections/action-history')
    if (method === 'POST') {
      postCount++
      const body = JSON.parse(init.body)
      if (options.failPost) return new Response(JSON.stringify({ ok: false,
        error: 'Invalid follow-up date' }), { status: 400 })
      if (options.holdPost && postCount === 1) await heldPost
      if (options.uncertainFirstPost && postCount === 1) {
        stored.push({ ...body, next_action_date: body.next_action_date ?? schedule.tomorrow })
        throw new Error('connection lost after save')
      }
      if (!stored.some((action) => action.action_id === body.action_id)) {
        stored.push({ ...body, next_action_date: body.next_action_date ?? schedule.tomorrow })
        revision++
      }
      return new Response(JSON.stringify({ ok: true, action: { id: body.action_id,
        outcome: body.outcome, nextActionDate: body.next_action_date ?? schedule.tomorrow,
        actionTimestamp: '2026-09-30T10:00:00Z' },
        ...(options.withProjection ? { projection: queue() } : {}) }), { status: 201 })
    }
    if (method === 'DELETE') {
      deleteCount++
      const body = JSON.parse(init.body)
      const index = stored.findIndex((action) => action.action_id === body.action_id)
      if (index >= 0) stored.splice(index, 1)
      if (index >= 0) revision++
      if (options.uncertainFirstDelete && deleteCount === 1) throw new Error('connection lost after delete')
      return new Response(JSON.stringify({ ok: true, deleted: index >= 0, actionId: body.action_id,
        ...(options.withProjection ? { projection: queue() } : {}) }), { status: 200 })
    }
    throw new Error(`Unexpected request ${method}`)
  }
  const router = { replace() {}, push() {} }
  const Card = ({ children }) => React.createElement('div', null, children)
  const Button = ({ children, variant, size, ...props }) => {
    void variant
    void size
    return React.createElement('button', { type: 'button', ...props }, children)
  }
  const Link = ({ children, href, ...props }) => React.createElement('a', { href, ...props }, children)
  const { default: Component } = loadTypeScriptModule('app/collections/actions/CollectionActionsClient.tsx', {
    mocks: {
      react: React, 'react/jsx-runtime': awaitableJsxRuntime,
      'next/navigation': { useRouter: () => router }, 'next/link': Link,
      '@/app/components/ui/Card': Card, '@/app/components/ui/Button': Button,
      '@/app/collections/MultiCurrencyPlanGate': () => null,
      '@/app/dashboard/DashboardXeroConnectionCard': () => null,
      '@/app/collections/FounderContextControl': options.withProjection
        ? ({ value, onChange }) => React.createElement('div', null,
          React.createElement('button', { type: 'button', onClick: () => onChange('priority') }, 'Make Priority'),
          value === 'priority' && React.createElement('button', { type: 'button', onClick: () => onChange('normal') }, 'Restore Normal'))
        : () => null,
      '@/lib/collections/promise-refresh': { subscribePromiseActionability: () => () => {} },
    },
  })
  const container = dom.window.document.getElementById('root')
  const root = createRoot(container)
  const render = async () => act(async () => { root.render(React.createElement(Component, {
    tenantId: 'tenant', showQueue: true, showTable: false, showHeader: false, showFilters: false,
  })) })
  const button = (label) => [...container.querySelectorAll('button')]
    .find((item) => item.textContent.trim() === label)
  const click = async (label) => {
    const target = button(label)
    assert.ok(target, `Missing button: ${label}`)
    await act(async () => { target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  }
  const cleanup = async () => {
    await act(async () => root.unmount())
    dom.window.close()
    Object.assign(globalThis, previous)
  }
  return { render, click, button, container, requests, stored, cleanup,
    releasePost, getCount: () => getCount, postCount: () => postCount }
}

const awaitableJsxRuntime = await import('react/jsx-runtime')

test('four one-tap outcomes use the V1 API, advance focus, and free browsing makes no write', async () => {
  for (const outcome of ['No response', 'Message sent', 'Responded — no commitment', 'Reviewed — no chase needed']) {
    const app = setup()
    try {
      await app.render()
      const options = [...app.container.querySelectorAll('[aria-label="Record outcome"] button')]
        .map((item) => item.textContent.trim())
      assert.deepEqual(options, ['No response', 'Message sent', 'Responded — no commitment', 'Reviewed — no chase needed'])
      assert.equal(app.container.querySelector('a[href="/customers/alpha/history?tenantId=tenant"]')?.textContent.trim(), 'View full history')
      assert.doesNotMatch(app.container.textContent, /Call \+ outcome|Postpone \+ date|Postpone 1 day/)
      await app.click('Next')
      assert.match(app.container.textContent, /beta Ltd/)
      await app.click('Previous')
      assert.equal(app.requests.filter((request) => request.method === 'POST').length, 0)
      await app.click(outcome)
      const created = app.requests.filter((request) => request.method === 'POST')
      assert.equal(created.length, 1)
      assert.equal(created[0].url, '/api/collections/action-history')
      assert.equal(created[0].body.next_action_date, undefined)
      assert.equal(created[0].body.note, undefined)
      assert.equal(app.getCount(), 2)
      assert.match(app.container.textContent, /beta Ltd/)
      assert.ok(app.button('Undo'))
    } finally { await app.cleanup() }
  }
})

test('queue-order selection keeps server ranking, resets the customer draft and makes no extra read', async () => {
  const app = setup({ withProjection: true, rows: [
    { ...row('alpha'), priority_score: 80, customer_to_chase_overdue_base: 137.12 },
    { ...row('beta'), priority_score: 60, customer_to_chase_overdue_base: 10.01 },
    { ...row('gamma'), priority_score: 40, customer_to_chase_overdue_base: 999999 },
  ] })
  try {
    await app.render()
    const order = app.container.querySelector('aside[aria-label="Queue order"]')
    assert.match(order.querySelector('li').textContent, /alpha Ltd/)
    await act(async () => app.container.querySelector('button[aria-expanded]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await app.click('In 3 days')
    await app.click('Add note')
    const textarea = app.container.querySelector('textarea')
    await act(async () => {
      const propsKey = Object.keys(textarea).find(key => key.startsWith('__reactProps$'))
      textarea[propsKey].onChange({ target: { value: 'Alpha-only draft' } })
    })
    const beta = [...order.querySelectorAll('button')].find(button => button.textContent.includes('beta Ltd'))
    await act(async () => beta.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    const customer = app.container.querySelector('article')
    assert.equal(customer.querySelector('h2').textContent, 'beta Ltd')
    assert.match(customer.textContent, /Priority 2 of 3/)
    assert.match(customer.textContent, /£10\.01/)
    assert.match(customer.textContent, /Do not follow up until: Tomorrow/)
    assert.equal(customer.querySelector('textarea'), null)
    assert.equal(app.getCount(), 1)
    assert.equal(app.postCount(), 0)
    await app.click('Message sent')
    const created = app.requests.find(request => request.method === 'POST')
    assert.equal(created.body.customer_source_id, 'beta')
    assert.equal(created.body.next_action_date, undefined)
    assert.equal(created.body.note, undefined)
    assert.equal(app.getCount(), 1)
  } finally { await app.cleanup() }
})

test('server-provided custom timing, optional note, and authoritative Undo', async () => {
  const app = setup()
  try {
    await app.render()
    await act(async () => { app.container.querySelector('button[aria-expanded]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await app.click('In 2 days')
    await app.click('Add note')
    const textarea = app.container.querySelector('textarea')
    assert.ok(textarea)
    await act(async () => {
      const propsKey = Object.keys(textarea).find((key) => key.startsWith('__reactProps$'))
      textarea[propsKey].onChange({ target: { value: 'Asked for an update' } })
    })
    await app.click('No response')
    const post = app.requests.find((request) => request.method === 'POST')
    assert.equal(post.body.next_action_date, '2026-10-02')
    assert.equal(post.body.note, 'Asked for an update')
    await app.click('Undo')
    const deletion = app.requests.find((request) => request.method === 'DELETE')
    assert.equal(deletion.body.action_id, post.body.action_id)
    assert.equal(deletion.body.customer_source_id, 'alpha')
    assert.equal(app.getCount(), 3)
    assert.match(app.container.textContent, /alpha Ltd/)
  } finally { await app.cleanup() }
})

test('fast Action History create and Undo use the mutation projection without a queue GET', async () => {
  const app = setup({ withProjection: true })
  try {
    await app.render()
    assert.equal(app.getCount(), 1)
    await app.click('No response')
    assert.equal(app.getCount(), 1)
    assert.match(app.container.textContent, /beta Ltd/)
    await app.click('Undo')
    assert.equal(app.getCount(), 1)
    assert.match(app.container.textContent, /alpha Ltd/)
  } finally { await app.cleanup() }
})

test('fast priority and restore-Normal consume authoritative mutation ordering without a queue GET', async () => {
  const app = setup({ withProjection: true })
  try {
    await app.render()
    await app.click('Next')
    await app.click('Make Priority')
    assert.equal(app.getCount(), 1)
    assert.equal(app.requests.filter(request => request.url === '/api/collections/override').length, 1)
    assert.match(app.container.textContent, /beta Ltd/)
    await app.click('Restore Normal')
    assert.equal(app.getCount(), 1)
    assert.equal(app.requests.filter(request => request.url === '/api/collections/override').length, 2)
  } finally { await app.cleanup() }
})

test('uncertain save retries one stable ID and does not duplicate the action', async () => {
  const app = setup({ uncertainFirstPost: true })
  try {
    await app.render()
    await app.click('No response')
    assert.ok(app.button('Retry save'))
    await app.click('Retry save')
    const posts = app.requests.filter((request) => request.method === 'POST')
    assert.equal(posts.length, 2)
    assert.equal(posts[0].body.action_id, posts[1].body.action_id)
    assert.equal(app.stored.length, 1)
    assert.match(app.container.textContent, /beta Ltd/)
  } finally { await app.cleanup() }
})

test('Undo does not reinsert a customer with a preceding unexpired action', async () => {
  const app = setup()
  try {
    await app.render()
    await app.click('Message sent')
    app.stored.unshift({ action_id: 'older', customer_source_id: 'alpha',
      next_action_date: '2026-10-07' })
    await app.click('Undo')
    assert.match(app.container.textContent, /beta Ltd/)
    assert.equal(app.container.querySelector('article h2')?.textContent, 'beta Ltd')
    assert.match(app.container.textContent, /not in the current priority view/)
  } finally { await app.cleanup() }
})

test('Choose date sends a server-validated date and never uses a browser offset', async () => {
  const app = setup()
  try {
    await app.render()
    await act(async () => { app.container.querySelector('button[aria-expanded]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await app.click('Choose date')
    const input = app.container.querySelector('input[type="date"]')
    assert.equal(input.min, schedule.tomorrow)
    await act(async () => {
      const propsKey = Object.keys(input).find((key) => key.startsWith('__reactProps$'))
      input[propsKey].onChange({ target: { value: '2026-10-12' } })
    })
    await app.click('Reviewed — no chase needed')
    const post = app.requests.find((request) => request.method === 'POST')
    assert.equal(post.body.next_action_date, '2026-10-12')
  } finally { await app.cleanup() }
})

test('rapid double tap submits once; a definitive error leaves the customer actionable', async () => {
  const held = setup({ holdPost: true })
  try {
    await held.render()
    const target = held.button('No response')
    await act(async () => {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      held.releasePost()
    })
    assert.equal(held.postCount(), 1)
    assert.match(held.container.textContent, /beta Ltd/)
  } finally { await held.cleanup() }

  const failed = setup({ failPost: true })
  try {
    await failed.render()
    await failed.click('No response')
    assert.match(failed.container.textContent, /Invalid follow-up date/)
    assert.ok(failed.button('No response'))
    assert.equal(failed.button('Undo'), undefined)
    assert.equal(failed.getCount(), 1)
  } finally { await failed.cleanup() }
})

test('uncertain Undo keeps the exact action available for an idempotent retry', async () => {
  const app = setup({ uncertainFirstDelete: true })
  try {
    await app.render()
    await app.click('No response')
    const actionId = app.requests.find((request) => request.method === 'POST').body.action_id
    await app.click('Undo')
    assert.ok(app.button('Undo'))
    assert.match(app.container.textContent, /Could not confirm Undo/)
    await app.click('Undo')
    const deletes = app.requests.filter((request) => request.method === 'DELETE')
    assert.deepEqual(deletes.map((request) => request.body.action_id), [actionId, actionId])
    assert.match(app.container.textContent, /Customer returned to the queue/)
  } finally { await app.cleanup() }
})

test('recent activity distinguishes a V1 outcome and a truthful legacy contact row', async () => {
  for (const recent of [
    { format: 'v1', outcome: 'no_response', note: 'Check again later', actionType: null,
      actionTimestamp: '2026-09-29T10:00:00Z', nextActionDate: '2026-10-01' },
    { format: 'legacy', outcome: 'spoke_to_customer', note: null, actionType: 'called',
      actionTimestamp: '2026-09-29T10:00:00Z', nextActionDate: null },
  ]) {
    const app = setup({ rows: [row('alpha'), { ...row('beta'), recent_activity: recent }] })
    try {
      await app.render()
      await app.click('Next')
      assert.match(app.container.textContent, /Last activity:/)
      if (recent.format === 'v1') {
        assert.match(app.container.textContent, /No response/)
        assert.match(app.container.textContent, /Note: Check again later/)
        assert.match(app.container.textContent, /Follow up:/)
      } else {
        assert.match(app.container.textContent, /Called/)
        assert.match(app.container.textContent, /Legacy outcome: Spoke to customer/)
      }
    } finally { await app.cleanup() }
  }
})
