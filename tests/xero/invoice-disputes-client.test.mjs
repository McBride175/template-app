import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

function harness() {
  const states = []
  let cursor = 0
  let refCursor = 0
  const refs = []
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
    useRef(initial) {
      const slot = refCursor++
      if (!(slot in refs)) refs[slot] = { current: initial }
      return refs[slot]
    },
    useCallback(callback) { return callback },
    useMemo(factory) { return factory() },
    useEffect(effect) { effects.push(effect) },
  }
  const jsx = (type, props) => ({ type, props: props ?? {} })
  return {
    states, effects, react,
    jsxRuntime: { jsx, jsxs: jsx, Fragment: react.Fragment },
    render(Component, props) { cursor = 0; refCursor = 0; effects.length = 0; return Component(props) },
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

test('ordinary bulk controls select only open invoices without a resolved dispute', async () => {
  const h = harness()
  const posts = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, options) => {
    posts.push(JSON.parse(options.body))
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }
  try {
    const { InvoiceDisputeList: Component } = loadTypeScriptModule('app/collections/customers/CustomerInvoiceDisputes.tsx', {
      mocks: { react: h.react, 'react/jsx-runtime': h.jsxRuntime },
    })
    const rows = [invoice, {
      ...invoice, invoiceSourceId: 'invoice-b', invoiceNumber: 'INV-B',
      disputeId: 'dispute-b', revision: '5', disputeMode: 'partial', isActive: true,
      recordedDisputedAmountNative: '3000', effectiveDisputedAmountNative: '3000',
      collectibleAmountNative: '7000',
    }, {
      ...invoice, invoiceSourceId: 'invoice-c', invoiceNumber: 'INV-C',
      disputeId: 'dispute-c', revision: '6', disputeMode: 'partial', isResolved: true,
    }, {
      ...invoice, invoiceSourceId: 'invoice-d', invoiceNumber: 'INV-D',
      invoiceState: 'settled', currentAmountDueNative: '0', collectibleAmountNative: '0',
    }, {
      ...invoice, invoiceSourceId: 'invoice-e', invoiceNumber: 'INV-E',
      invoiceState: 'unavailable', currentAmountDueNative: null, collectibleAmountNative: null,
    }]
    const props = {
      tenantId: 'tenant-a', customerSourceId: 'customer-a', customerName: 'Customer A',
      invoices: rows, reload: async () => true, onChanged: async () => true,
      onMutationStarted() {}, onMutationPending() {}, onMutationResult() {},
    }
    let tree = h.render(Component, props)
    const checkboxes = nodes(tree, (node) => node.type === 'input' && node.props.type === 'checkbox')
    assert.deepEqual(checkboxes.map((node) => node.props['aria-label']), [
      'Select invoice INV-A for full dispute', 'Select invoice INV-B for full dispute',
    ])
    checkboxes.forEach((node) => node.props.onChange({ target: { checked: true } }))
    tree = h.render(Component, props)
    assert.match(JSON.stringify(button(tree, 'Dispute selected').props.children), /2/)
    button(tree, 'Dispute selected').props.onClick()
    for (let attempt = 0; attempt < 10 && h.states[0]; attempt++) await new Promise(setImmediate)
    tree = h.render(Component, props)
    button(tree, 'Dispute all').props.onClick()
    for (let attempt = 0; attempt < 10 && h.states[0]; attempt++) await new Promise(setImmediate)
    assert.equal(posts.length, 2)
    for (const request of posts) {
      assert.equal(request.operation, 'bulk_full')
      assert.deepEqual(request.invoiceSourceIds, ['invoice-a', 'invoice-b'])
      assert.deepEqual(request.expectedRevisions, [{ invoiceSourceId: 'invoice-b', revision: '5' }])
    }
  } finally { globalThis.fetch = originalFetch }
})

test('a resolved-only customer has no ordinary bulk action and reactivation restores eligibility', async () => {
  const h = harness()
  const posts = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, options) => {
    posts.push(JSON.parse(options.body))
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }
  try {
    const { InvoiceDisputeList: Component } = loadTypeScriptModule('app/collections/customers/CustomerInvoiceDisputes.tsx', {
      mocks: { react: h.react, 'react/jsx-runtime': h.jsxRuntime },
    })
    const props = {
      tenantId: 'tenant-a', customerSourceId: 'customer-a', customerName: 'Customer A',
      invoices: [{ ...invoice, disputeId: 'dispute-a', revision: '6', isResolved: true, disputeMode: 'partial' }],
      reload: async () => true, onChanged: async () => true,
      onMutationStarted() {}, onMutationPending() {}, onMutationResult() {},
    }
    const tree = h.render(Component, props)
    assert.equal(nodes(tree, (node) => node.type === 'input' && node.props.type === 'checkbox').length, 0)
    assert.equal(nodes(tree, (node) => node.type === 'button' &&
      JSON.stringify(node.props.children).includes('Dispute all')).length, 0)
    assert.match(JSON.stringify(tree), /reactivate before disputing again/i)
    button(tree, 'Reactivate dispute').props.onClick()
    for (let attempt = 0; attempt < 10 && h.states[0]; attempt++) await new Promise(setImmediate)
    assert.deepEqual(posts, [{ operation: 'reactivate', tenantId: 'tenant-a',
      disputeId: 'dispute-a', expected_revision: '6' }])
    const refreshed = h.render(Component, { ...props, invoices: [{ ...props.invoices[0],
      revision: '7', isResolved: false, isActive: true }] })
    assert.equal(nodes(refreshed, (node) => node.type === 'input' && node.props.type === 'checkbox').length, 1)
    assert.equal(button(refreshed, 'Dispute all').props.disabled, false)
  } finally { globalThis.fetch = originalFetch }
})

test('invoice control reports saved mutation even when the canonical parent refresh fails', async () => {
  const h = harness()
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, options) => options?.method === 'POST'
    ? { ok: true, status: 200, json: async () => ({ ok: true }) }
    : { ok: true, status: 200, json: async () => ({ ok: true, invoices: [invoice] }) }
  try {
    const { InvoiceDisputeList: Component } = loadTypeScriptModule('app/collections/customers/CustomerInvoiceDisputes.tsx', {
      mocks: { react: h.react, 'react/jsx-runtime': h.jsxRuntime },
    })
    const props = {
      tenantId: 'tenant-a', customerSourceId: 'customer-a', customerName: 'Customer A',
      invoices: [invoice], reload: async () => true,
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
    const { InvoiceDisputeList: Component } = loadTypeScriptModule('app/collections/customers/CustomerInvoiceDisputes.tsx', {
      mocks: { react: h.react, 'react/jsx-runtime': h.jsxRuntime },
    })
    const props = {
      tenantId: 'tenant-a', customerSourceId: 'customer-a', customerName: 'Customer A',
      invoices: [{ ...invoice, disputeId: 'dispute-a', revision: '2', disputeMode: 'full', isActive: true }],
      reload: async () => true, onChanged: async () => true,
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
    assert.equal(h.states[2], null) // edit form was closed for review
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('stale accounting rejection reloads the current balance without claiming a save or replaying input', async () => {
  const originalFetch = globalThis.fetch
  try {
    for (const [status, code] of [[409, 'invalid_amount'], [409, 'invalid_invoice'], [404, 'not_found']]) {
      const h = harness()
      let posts = 0
      let reloads = 0
      const outcomes = []
      globalThis.fetch = async (_url, options) => {
        posts += 1
        if (code === 'invalid_amount') {
          assert.equal(JSON.parse(options.body).operation, 'partial')
          assert.equal(JSON.parse(options.body).disputedAmountNative, '4000')
        }
        return { ok: false, status, json: async () => ({ code,
          error: 'Accounting data changed. Refresh and check the current invoice balance.' }) }
      }
      const { InvoiceDisputeList: Component } = loadTypeScriptModule('app/collections/customers/CustomerInvoiceDisputes.tsx', {
        mocks: { react: h.react, 'react/jsx-runtime': h.jsxRuntime },
      })
      const props = { tenantId: 'tenant-a', customerSourceId: 'customer-a', customerName: 'Customer A',
        invoices: [invoice], reload: async () => { reloads += 1; return true }, onChanged: async () => true,
        onMutationStarted() {}, onMutationPending() {},
        onMutationResult: (refreshed, message) => outcomes.push([refreshed, message]) }
      button(h.render(Component, props), 'Mark disputed').props.onClick()
      if (code === 'invalid_amount') {
        const form = h.render(Component, props)
        nodes(form, (node) => node.type === 'input' && node.props.type === 'radio')[1].props.onChange()
        nodes(h.render(Component, props), (node) => node.type === 'input' && node.props.inputMode === 'decimal')[0]
          .props.onChange({ target: { value: '4000' } })
      }
      button(h.render(Component, props), 'Save dispute').props.onClick()
      for (let attempt = 0; attempt < 10 && !outcomes.length; attempt++) await new Promise(setImmediate)
      assert.equal(posts, 1)
      assert.equal(reloads, 1, `${code} must refresh stale accounting state`)
      assert.equal(outcomes[0][0], true)
      assert.doesNotMatch(outcomes[0][1], /saved/i)
      assert.match(outcomes[0][1], /current invoice balance/i)
      assert.equal(h.states[2], null)
    }
  } finally { globalThis.fetch = originalFetch }
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

test('worklist preserves successful-save state when refresh fails and restores controls after retry', async () => {
  const h = harness()
  const InvoiceControl = () => null
  const { default: Worklist } = loadTypeScriptModule('app/disputes/DisputesClient.tsx', {
    mocks: { react: h.react, 'react/jsx-runtime': h.jsxRuntime, 'next/link': 'a',
      '@/app/collections/customers/CustomerInvoiceDisputes': { InvoiceDisputeList: InvoiceControl } },
  })
  const query = { status: 'active', customer: '', q: '', sort: 'amount_desc', page: 1, pageSize: 25 }
  const row = { ...invoice, disputeId: 'dispute-a', revision: '4', isActive: true, disputeMode: 'full',
    sourceSystem: 'xero', customerSourceId: 'customer-a', customerName: 'Customer A',
    currentAmountDueNative: '10000', effectiveDisputedAmountNative: '10000', collectibleAmountNative: '0',
    effectiveDisputedBase: null, overdueDays: 20, contextFromPreviousSnapshot: false, resolvedAt: null,
    customerHref: '/customers?tenantId=tenant-a&customerSourceId=customer-a' }
  let failRefresh = false
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => failRefresh
    ? { ok: false, json: async () => ({ error: 'Temporary read failure' }) }
    : { ok: true, json: async () => ({ ok: true, tenantId: 'tenant-a', organisationBaseCurrency: 'GBP',
      rows: [row], customers: [{ sourceId: 'customer-a', name: 'Customer A' }], query, total: 1, pageCount: 1 }) }
  try {
    const props = { tenantId: 'tenant-a', query }
    h.render(Worklist, props)
    h.effects.forEach((effect) => effect())
    await new Promise(setImmediate)
    const loaded = h.render(Worklist, props)
    assert.match(JSON.stringify(loaded), /Base valuation unavailable/)
    const link = nodes(loaded, (node) => node.type === 'a' && node.props.href?.includes('customerSourceId'))[0]
    assert.equal(link.props.href, '/customers?tenantId=tenant-a&customerSourceId=customer-a#invoice-invoice-a')
    const control = nodes(loaded, (node) => node.type === InvoiceControl)[0]
    assert.equal(control.props.showBulkActions, false)
    control.props.onMutationStarted()
    const pending = h.render(Worklist, props)
    assert.equal(nodes(pending, (node) => node.type === InvoiceControl)[0].props.disabled, true)
    control.props.onMutationPending('Dispute saved. Refreshing current balances…')
    failRefresh = true
    assert.equal(await control.props.reload(), false)
    control.props.onMutationResult(false, 'Dispute saved, but current balances could not be refreshed. Refresh before making further changes.')
    const failed = h.render(Worklist, props)
    assert.equal(nodes(failed, (node) => node.type === InvoiceControl).length, 0)
    assert.match(JSON.stringify(nodes(failed, (node) => node.props.role === 'alert')), /Dispute saved/)
    assert.equal(nodes(failed, (node) => node.type === 'fieldset')[0].props.disabled, true)
    failRefresh = false
    await button(failed, 'Reload current disputes').props.onClick()
    await new Promise(setImmediate)
    const refreshed = h.render(Worklist, props)
    assert.equal(nodes(refreshed, (node) => node.type === InvoiceControl).length, 1)
    assert.equal(nodes(refreshed, (node) => node.type === 'fieldset')[0].props.disabled, false)
  } finally { globalThis.fetch = originalFetch }
})

test('shared worklist actions submit the displayed revision and withhold invalid state operations', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body))
    return { ok: true, json: async () => ({ ok: true }) }
  }
  try {
    for (const [state, label, operation] of [
      [{ isActive: true, isResolved: false }, 'Resolve dispute', 'resolve'],
      [{ isActive: false, isResolved: true }, 'Reactivate dispute', 'reactivate'],
      [{ isActive: true, isResolved: false, needsReview: true }, 'Keep as is', 'confirm'],
    ]) {
      const h = harness()
      const { InvoiceDisputeList } = loadTypeScriptModule('app/collections/customers/CustomerInvoiceDisputes.tsx', {
        mocks: { react: h.react, 'react/jsx-runtime': h.jsxRuntime },
      })
      const props = { tenantId: 'tenant-a', customerSourceId: 'customer-a', customerName: 'Customer A',
        invoices: [{ ...invoice, disputeId: 'dispute-a', revision: '7', disputeMode: 'partial', ...state }],
        showBulkActions: false, reload: async () => true, onChanged: async () => true,
        onMutationStarted() {}, onMutationPending() {}, onMutationResult() {} }
      button(h.render(InvoiceDisputeList, props), label).props.onClick()
      await new Promise(setImmediate)
      assert.equal(calls.at(-1).operation, operation)
      assert.equal(calls.at(-1).expected_revision, '7')
      assert.equal(calls.at(-1).tenantId, 'tenant-a')
      for (const invoiceState of ['settled', 'unavailable']) {
        const tree = h.render(InvoiceDisputeList, { ...props,
          invoices: [{ ...props.invoices[0], invoiceState, needsReview: false }] })
        const labels = nodes(tree, (node) => node.type === 'button').map((node) => JSON.stringify(node.props.children)).join(' ')
        assert.doesNotMatch(labels, /Reactivate dispute|Edit dispute|Keep as is|Mark disputed/)
        assert.match(labels, /Edit note/)
      }
    }
  } finally { globalThis.fetch = originalFetch }
})

test('a late mutation reload cannot replace a newly selected worklist URL with an old page', async () => {
  const h = harness()
  const InvoiceControl = () => null
  const { default: Worklist } = loadTypeScriptModule('app/disputes/DisputesClient.tsx', {
    mocks: { react: h.react, 'react/jsx-runtime': h.jsxRuntime, 'next/link': 'a',
      '@/app/collections/customers/CustomerInvoiceDisputes': { InvoiceDisputeList: InvoiceControl } },
  })
  const query = { status: 'active', customer: '', q: '', sort: 'amount_desc', page: 1, pageSize: 25 }
  const requests = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    requests.push(url)
    const filtered = url.includes('customer=baker')
    return { ok: true, json: async () => ({ ok: true, tenantId: 'tenant-a', organisationBaseCurrency: 'GBP',
      rows: [{ ...invoice, disputeId: 'dispute-a', revision: '1', customerSourceId: filtered ? 'baker' : 'acme',
        customerName: filtered ? 'Baker' : 'Acme', effectiveDisputedBase: '1000' }],
      customers: [], query: { ...query, customer: filtered ? 'baker' : '' }, total: 1, pageCount: 1 }) }
  }
  try {
    const props = { tenantId: 'tenant-a', query }
    h.render(Worklist, props)
    h.effects.forEach((effect) => effect())
    await new Promise(setImmediate)
    const original = h.render(Worklist, props)
    const staleReload = nodes(original, (node) => node.type === InvoiceControl)[0].props.reload
    const updatedProps = { ...props, query: { ...query, customer: 'baker' } }
    h.render(Worklist, updatedProps)
    h.effects.forEach((effect) => effect())
    await new Promise(setImmediate)
    const count = requests.length
    assert.equal(await staleReload(), false)
    assert.equal(requests.length, count)
    const latest = h.render(Worklist, updatedProps)
    assert.equal(nodes(latest, (node) => node.type === InvoiceControl)[0].props.customerName, 'Baker')
  } finally { globalThis.fetch = originalFetch }
})
