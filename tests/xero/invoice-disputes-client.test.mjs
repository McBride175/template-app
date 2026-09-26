import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

function harness() {
  const states = []
  let cursor = 0
  const effects = []
  const react = {
    Fragment: Symbol('Fragment'),
    useState(initial) {
      const slot = cursor++
      if (!(slot in states)) states[slot] = initial
      return [states[slot], (next) => {
        states[slot] = typeof next === 'function' ? next(states[slot]) : next
      }]
    },
    useRef(initial) { return { current: initial } },
    useCallback(callback) { return callback },
    useMemo(factory) { return factory() },
    useEffect(effect) { effects.push(effect) },
  }
  const jsx = (type, props) => ({ type, props: props ?? {} })
  return {
    states, effects, react,
    jsxRuntime: { jsx, jsxs: jsx, Fragment: react.Fragment },
    render(Component, props) { cursor = 0; effects.length = 0; return Component(props) },
  }
}

function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, predicate))
  return [
    ...(predicate(tree) ? [tree] : []),
    ...nodes(tree.props?.children, predicate),
  ]
}

function button(tree, label) {
  const found = nodes(tree, (node) => node.type === 'button' &&
    nodes(node.props?.children, () => false).length === 0 &&
    JSON.stringify(node.props?.children).includes(label))
  assert.ok(found.length, `missing button: ${label}`)
  return found[0]
}

const invoice = {
  invoiceSourceId: 'invoice-a', invoiceNumber: 'INV-A', reference: null,
  issueDate: '2026-09-01', dueDate: '2026-09-10', currencyCode: 'GBP',
  disputeId: null, revision: null, note: null, invoiceState: 'open',
  disputeMode: null, isActive: false, isResolved: false, needsReview: false,
  currentAmountDueNative: '10000', recordedDisputedAmountNative: null,
  effectiveDisputedAmountNative: '0', collectibleAmountNative: '10000',
}

test('invoice control reports saved mutation even when the canonical parent refresh fails', async () => {
  const h = harness()
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, options) => options?.method === 'POST'
    ? { ok: true, status: 200, json: async () => ({ ok: true }) }
    : { ok: true, status: 200, json: async () => ({ ok: true, invoices: [invoice] }) }
  try {
    const { default: Component } = loadTypeScriptModule('app/collections/customers/CustomerInvoiceDisputes.tsx', {
      mocks: { react: h.react, 'react/jsx-runtime': h.jsxRuntime },
    })
    const props = {
      tenantId: 'tenant-a', customerSourceId: 'customer-a', customerName: 'Customer A',
      onChanged: async () => false,
      onMutationStarted: () => calls.push(['started']),
      onMutationPending: (message) => calls.push(['pending', message]),
      onMutationResult: (refreshed, message) => calls.push(['result', refreshed, message]),
    }
    h.render(Component, props)
    await h.effects[0]()
    await new Promise(setImmediate)
    button(h.render(Component, props), 'Mark disputed').props.onClick()
    button(h.render(Component, props), 'Save dispute').props.onClick()
    for (let attempt = 0; attempt < 10 && calls.length < 3; attempt++) {
      await new Promise(setImmediate)
    }
    assert.deepEqual(calls.map((call) => call[0]), ['started', 'pending', 'result'])
    assert.deepEqual(calls[2].slice(0, 2), ['result', false])
    assert.match(calls[2][2], /saved.*could not be refreshed/i)
    assert.match(calls[2][2], /Refresh the page/i)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a revision conflict reloads current state without replaying the stale edit', async () => {
  const h = harness()
  const calls = []
  let posts = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, options) => {
    if (options?.method === 'POST') {
      posts += 1
      return { ok: false, status: 409, json: async () => ({
        code: 'conflict', error: 'This dispute changed. Refresh and review the latest version.',
      }) }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, invoices: [{
      ...invoice, disputeId: 'dispute-a', revision: '2', disputeMode: 'full', isActive: true,
    }] }) }
  }
  try {
    const { default: Component } = loadTypeScriptModule('app/collections/customers/CustomerInvoiceDisputes.tsx', {
      mocks: { react: h.react, 'react/jsx-runtime': h.jsxRuntime },
    })
    const props = {
      tenantId: 'tenant-a', customerSourceId: 'customer-a', customerName: 'Customer A',
      onChanged: async () => true,
      onMutationStarted: () => calls.push(['started']),
      onMutationPending: (message) => calls.push(['pending', message]),
      onMutationResult: (refreshed, message) => calls.push(['result', refreshed, message]),
    }
    h.render(Component, props)
    await h.effects[0]()
    await new Promise(setImmediate)
    button(h.render(Component, props), 'Edit dispute').props.onClick()
    button(h.render(Component, props), 'Save dispute').props.onClick()
    for (let attempt = 0; attempt < 10 && calls.length < 3; attempt++) {
      await new Promise(setImmediate)
    }
    assert.equal(posts, 1)
    assert.deepEqual(calls.map((call) => call[0]), ['started', 'pending', 'result'])
    assert.deepEqual(calls[2].slice(0, 2), ['result', true])
    assert.match(calls[2][2], /review the latest version/i)
    assert.equal(h.states[4], null) // edit form was closed for review
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('customer parent keeps save outcome visible while stale balances and actions are hidden', () => {
  const h = harness()
  const InvoiceControl = () => null
  const { default: Parent } = loadTypeScriptModule('app/collections/customers/CustomerCollectionsClient.tsx', {
    mocks: {
      react: h.react,
      'react/jsx-runtime': h.jsxRuntime,
      'next/navigation': { useRouter: () => ({ replace() {}, push() {} }) },
      '@/app/components/Card': () => null,
      '@/app/components/Button': () => null,
      '@/app/collections/customers/CustomerInvoiceDisputes': InvoiceControl,
      '@/app/collections/MultiCurrencyPlanGate': () => null,
      '@/lib/collections/payment-behavior-copy': {
        formatCurrentOverdueAge: () => '0 days',
        formatHistoricalPaymentTiming: () => 'Unknown',
        formatRelativeLateness: () => 'Unknown',
      },
      '@/lib/auth-flow': { buildLoginPath: () => '/login' },
      '@/lib/collections/founder-context': { FOUNDER_CONTEXT_OPTIONS: [] },
    },
  })
  h.render(Parent, { tenantId: 'tenant-a', initialCustomerSourceId: 'customer-a' })
  h.states[0] = [{ customer_source_id: 'customer-a', customer_name: 'Customer A',
    customer_email: null, total_outstanding_base: 10000, overdue_outstanding_base: 10000,
    overdue_invoices_count: 1, oldest_overdue_days: 15, native_currency_breakdown: [],
    has_active_dispute: false, collectible_overdue_base: 10000, override_level: 'normal' }]
  h.states[6] = false // initial summary load completed
  const current = h.render(Parent, { tenantId: 'tenant-a', initialCustomerSourceId: 'customer-a' })
  const control = nodes(current, (node) => node.type === InvoiceControl)[0]
  assert.ok(control)
  control.props.onMutationPending('Dispute saved. Refreshing current balances…')
  control.props.onMutationResult(false, 'Dispute saved, but current balances could not be refreshed.')
  h.states[8] = 'Failed to load customer collections summary'
  const failed = h.render(Parent, { tenantId: 'tenant-a', initialCustomerSourceId: 'customer-a' })
  assert.equal(nodes(failed, (node) => node.type === InvoiceControl).length, 0)
  const alerts = nodes(failed, (node) => node.props?.role === 'alert')
  assert.ok(alerts.some((node) => JSON.stringify(node.props.children).includes('Dispute saved')))
  assert.ok(nodes(failed, (node) => node.type === 'button' &&
    JSON.stringify(node.props.children).includes('Refresh page')).length > 0)
  h.states[8] = null
  control.props.onMutationResult(true, 'Dispute saved. Collection amounts have been refreshed.')
  const recovered = h.render(Parent, { tenantId: 'tenant-a', initialCustomerSourceId: 'customer-a' })
  assert.equal(nodes(recovered, (node) => node.type === InvoiceControl).length, 1)
})
