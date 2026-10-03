import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Event', 'CustomEvent', 'StorageEvent']) globalThis[key] = dom.window[key]
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const { default: InvoicePromise } = loadTypeScriptModule('app/collections/customers/InvoicePromise.tsx')
const { default: InvoiceAmounts } = loadTypeScriptModule('app/collections/customers/InvoiceAmounts.tsx')
const { promiseEventText, promiseMoney } = loadTypeScriptModule('lib/collections/promise-presentation.ts')
const { subscribePromiseActionability, notifyPromiseActionabilityChanged } = loadTypeScriptModule('lib/collections/promise-refresh.ts')
const promise = (fields = {}) => ({ id: '00000000-0000-4000-8000-000000000001', revision: '3', status: 'active',
  promisedAmountNative: '4000', promisedDate: '2026-09-30', qualifyingPaidAmountNative: '1000', note: 'Agreed on call', ...fields })
const invoice = (fields = {}) => ({ invoiceSourceId: 'invoice-a', invoiceNumber: 'A', currencyCode: 'GBP', invoiceState: 'open',
  currentAmountDueNative: '9000', effectiveDisputedAmountNative: '0', activePromisedCoverageAmountNative: '3000',
  collectibleAmountNative: '6000', toChaseAmountNative: '6000', activePromise: promise(), ...fields })
const response = (body, status = 200) => new Response(JSON.stringify(body), { status })
async function render(Component, props, handler = async () => { throw new Error('Unexpected request') }) {
  const requests = [], refreshes = []
  globalThis.fetch = async (url, options = {}) => { requests.push({ url, options, body: options.body ? JSON.parse(options.body) : null }); return handler(url, options) }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const onRefresh = props.onRefresh ?? (async id => { refreshes.push(id); return true })
  await act(async () => root.render(React.createElement(Component, { ...props, onRefresh })))
  const click = async label => {
    const element = [...container.querySelectorAll('button')].find(button => button.textContent === label)
    assert.ok(element, `Button ${label} exists: ${container.textContent}`)
    await act(async () => { element.click() })
  }
  const field = label => {
    const found = [...container.querySelectorAll('label')].find(element => element.textContent === label)
    assert.ok(found, `Label ${label} exists`)
    return document.getElementById(found.htmlFor)
  }
  const set = async (label, value) => {
    const element = field(label)
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value)
      element.dispatchEvent(new Event(element.type === 'date' ? 'change' : 'input', { bubbles: true }))
    })
  }
  const submit = async () => { await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))) }
  const close = async () => { await act(async () => root.unmount()); container.remove() }
  return { container, requests, refreshes, click, field, set, submit, close,
    rerender: async next => { await act(async () => root.render(React.createElement(Component, { ...next, onRefresh }))) } }
}

for (const recordedAmount of ['2000', '10000']) test(`create fixed ${recordedAmount} commitment with explicit date and optional note`, async () => {
  const ui = await render(InvoicePromise, { invoice: invoice({ currentAmountDueNative: '10000', activePromise: null }), tenantId: 'tenant-a' }, async (url, options) => {
    assert.equal(url, '/api/collections/invoice-promises')
    const command = JSON.parse(options.body)
    assert.equal(command.amount, recordedAmount); assert.equal(command.promisedDate, '2026-09-30'); assert.equal(command.note, 'Agreed')
    assert.equal(command.operation, 'create'); assert.equal(command.invoiceSourceId, 'invoice-a')
    assert.match(command.commandId, /^[a-f0-9-]{36}$/)
    assert.equal('currency' in command, false); assert.equal('baseline' in command, false)
    return response({ ok: true, promise: promise({ promisedAmountNative: recordedAmount, qualifyingPaidAmountNative: '0' }), events: [] })
  })
  await ui.click('Record promise')
  assert.equal(ui.requests.length, 0, 'Opening never requests the portfolio or scorer')
  assert.equal(ui.field('Promise amount (GBP)').value, '')
  assert.equal(ui.field('Promised date').value, '')
  await ui.set('Promise amount (GBP)', recordedAmount); await ui.set('Promised date', '2026-09-30'); await ui.set('Optional promise note', 'Agreed')
  await ui.submit()
  assert.equal(ui.requests.length, 1); assert.deepEqual(ui.refreshes, ['invoice-a'])
  assert.match(ui.container.textContent, /Promise saved/)
  await ui.close()
})

test('client validation is labeled and zero/blank create never submits', async () => {
  const ui = await render(InvoicePromise, { invoice: invoice({ activePromise: null }), tenantId: 'tenant-a' })
  await ui.click('Record promise'); await ui.submit()
  assert.equal(ui.requests.length, 0)
  assert.equal(ui.field('Promise amount (GBP)').getAttribute('aria-invalid'), 'true')
  assert.ok(document.getElementById(ui.field('Promise amount (GBP)').getAttribute('aria-describedby')))
  await ui.set('Promise amount (GBP)', '0'); await ui.submit(); assert.equal(ui.requests.length, 0)
  await ui.set('Promise amount (GBP)', '10000'); await ui.submit()
  assert.match(ui.container.textContent, /cannot exceed/)
  await ui.close()
})

for (const [code, expected] of [['invalid_input', /current balance/], ['temporarily_unavailable', /Accounting details are not ready/], ['unauthorized', /session has expired/]]) test(`backend ${code} is translated without technical internals`, async () => {
  const ui = await render(InvoicePromise, { invoice: invoice(), tenantId: 'tenant-a' }, async () => response({ ok: false, code, error: 'raw_database_constraint' }, 400))
  await ui.click('Edit promise'); await ui.set('Promise amount (GBP)', '3000'); await ui.submit()
  assert.match(ui.container.textContent, expected); assert.doesNotMatch(ui.container.textContent, /raw_database_constraint/)
  await ui.close()
})

for (const [amount, date] of [['3000', '2026-09-30'], ['4000', '2026-10-02'], ['3000', '2026-10-02']]) test(`edit total amount/date ${amount} / ${date} uses displayed revision`, async () => {
  const ui = await render(InvoicePromise, { invoice: invoice(), tenantId: 'tenant-a' }, async (url, options) => {
    const body = JSON.parse(options.body)
    assert.equal(body.expectedRevision, '3'); assert.equal(body.amount, amount); assert.equal(body.promisedDate, date)
    return response({ ok: true, promise: promise({ promisedAmountNative: amount, promisedDate: date }), events: [] })
  })
  assert.match(ui.container.textContent, /£1,000.00 received against this promise/)
  await ui.click('Edit promise'); await ui.set('Promise amount (GBP)', amount); await ui.set('Promised date', date); await ui.submit()
  assert.deepEqual(ui.refreshes, ['invoice-a']); await ui.close()
})

test('note-only edit omits amount/date, never cancels and never invalidates ranking', async () => {
  let invalidations = 0
  const unsubscribe = subscribePromiseActionability('tenant-a', () => invalidations++)
  const ui = await render(InvoicePromise, { invoice: invoice(), tenantId: 'tenant-a' }, async (url, options) => {
    const body = JSON.parse(options.body)
    assert.equal('amount' in body, false); assert.equal('promisedDate' in body, false); assert.equal(body.note, 'Updated note')
    return response({ ok: true, promise: promise({ revision: '4', note: body.note }), events: [] })
  })
  await ui.click('Edit promise'); await ui.set('Optional promise note', 'Updated note'); await ui.submit()
  assert.equal(ui.refreshes.length, 0); assert.equal(invalidations, 0); assert.match(ui.container.textContent, /Updated note/)
  unsubscribe(); await ui.close()
})

for (const amount of ['', ' ', '0', '0.00']) test(`editing amount ${JSON.stringify(amount)} cancels without date/note`, async () => {
  const ui = await render(InvoicePromise, { invoice: invoice(), tenantId: 'tenant-a' }, async (url, options) => {
    const body = JSON.parse(options.body)
    assert.equal(body.amount, amount.trim()); assert.equal('promisedDate' in body, false); assert.equal('note' in body, false)
    return response({ ok: true, promise: promise({ status: 'cancelled', revision: '4' }), events: [] })
  })
  await ui.click('Edit promise'); await ui.set('Promise amount (GBP)', amount)
  assert.match(ui.container.textContent, /Cancel promise/); assert.equal(ui.container.querySelector('[type=date]'), null)
  await ui.submit()
  assert.match(ui.container.textContent, /Promise cancelled.*£4,000.00/)
  assert.equal([...ui.container.querySelectorAll('button')].some(button => /Edit promise|Reactivate/.test(button.textContent)), false)
  await ui.click('Record new promise'); assert.equal(ui.field('Promise amount (GBP)').value, '')
  await ui.close()
})

test('immediate Kept from edit removes editing controls and preserves backend outcome', async () => {
  const ui = await render(InvoicePromise, { invoice: invoice(), tenantId: 'tenant-a' }, async () => response({ ok: true, promise: promise({ status: 'kept', promisedAmountNative: '1000', revision: '5' }), events: [] }))
  await ui.click('Edit promise'); await ui.set('Promise amount (GBP)', '1000'); await ui.submit()
  assert.match(ui.container.textContent, /Promise kept/)
  assert.equal([...ui.container.querySelectorAll('button')].some(button => button.textContent === 'Edit promise'), false)
  await ui.close()
})

test('uncertain network retry reuses command identity rather than creating duplicate commitment', async () => {
  let attempt = 0
  const ui = await render(InvoicePromise, { invoice: invoice(), tenantId: 'tenant-a' }, async () => {
    if (!attempt++) throw new Error('network timeout after commit')
    return response({ ok: true, replayed: true, promise: promise({ promisedAmountNative: '3000' }), events: [] })
  })
  await ui.click('Edit promise'); await ui.set('Promise amount (GBP)', '3000'); await ui.submit()
  assert.match(ui.container.textContent, /response was not received/)
  await ui.submit(); assert.equal(ui.requests[0].body.commandId, ui.requests[1].body.commandId)
  assert.equal(ui.refreshes.length, 1); await ui.close()
})

test('save succeeds but refresh fails: committed state remains, no duplicate save retry', async () => {
  const ui = await render(InvoicePromise, { invoice: invoice(), tenantId: 'tenant-a', onRefresh: async () => false }, async () => response({ ok: true, promise: promise({ promisedAmountNative: '3000' }), events: [] }))
  await ui.click('Edit promise'); await ui.set('Promise amount (GBP)', '3000'); await ui.submit()
  assert.match(ui.container.textContent, /Promise saved, but current invoice amounts could not be refreshed/)
  assert.equal(ui.container.querySelector('form'), null)
  assert.equal([...ui.container.querySelectorAll('button')].find(button => button.textContent === 'Edit promise').disabled, true)
  await ui.click('Refresh invoice details'); assert.equal(ui.requests.length, 1)
  await ui.close()
})

test('conflict reloads authoritative promise and invoice without automatically replaying stale input', async () => {
  const ui = await render(InvoicePromise, { invoice: invoice(), tenantId: 'tenant-a' }, async (url, options) => options.method === 'POST'
    ? response({ ok: false, code: 'conflict' }, 409)
    : response({ ok: true, activePromise: promise({ revision: '4', promisedAmountNative: '2500' }), promises: [promise({ revision: '4', promisedAmountNative: '2500' })] }))
  await ui.click('Edit promise'); await ui.set('Promise amount (GBP)', '3000'); await ui.submit()
  assert.equal(ui.requests.filter(request => request.options.method === 'POST').length, 1)
  assert.match(ui.container.textContent, /latest details have been loaded/); assert.match(ui.container.textContent, /£2,500.00 promised/)
  await ui.click('Edit promise'); assert.equal(ui.field('Promise amount (GBP)').value, '2500'); await ui.close()
})

test('an externally changed revision does not inherit stale form input', async () => {
  const base = invoice()
  const ui = await render(InvoicePromise, { invoice: base, tenantId: 'tenant-a' })
  await ui.click('Edit promise'); await ui.set('Promise amount (GBP)', '3000')
  await ui.rerender({ invoice: invoice({ activePromise: promise({ revision: '4', promisedAmountNative: '2000' }) }), tenantId: 'tenant-a' })
  await ui.submit(); assert.equal(ui.requests.length, 0); assert.match(ui.container.textContent, /Close the form/)
  await ui.close()
})

for (const status of ['kept', 'missed', 'unclear', 'cancelled']) test(`terminal ${status} is passive, with new commitment and no terminal editing`, async () => {
  const ui = await render(InvoicePromise, { invoice: invoice({ activePromise: null, latestPromise: promise({ status }), activePromisedCoverageAmountNative: '0' }), tenantId: 'tenant-a' })
  assert.doesNotMatch(ui.container.textContent, /Needs review|Resolve|Reactivate|Action required/)
  assert.equal(ui.container.querySelector('form'), null)
  assert.ok([...ui.container.querySelectorAll('button')].find(button => button.textContent === 'Record new promise'))
  await ui.close()
})

for (const [fields, expected, omitted] of [
  [{ currentAmountDueNative: '10000', activePromisedCoverageAmountNative: '4000', toChaseAmountNative: '6000' }, /Outstanding£10,000.00Promised£4,000.00/, /Disputed|To chase/],
  [{}, /Outstanding£9,000.00Promised£3,000.00/, /Disputed|To chase/],
  [{ currentAmountDueNative: '10000', effectiveDisputedAmountNative: '8000', activePromisedCoverageAmountNative: '2000', toChaseAmountNative: '0' }, /Outstanding£10,000.00Disputed£8,000.00Promised£2,000.00/, /Paid|To chase/],
  [{ activePromise: null, latestPromise: null, activePromisedCoverageAmountNative: '0', toChaseAmountNative: '9000' }, /Outstanding£9,000.00/, /Promised|To chase|Disputed/],
]) test(`monetary disclosure consumes canonical server values ${expected}`, async () => {
  const ui = await render(InvoiceAmounts, { invoice: invoice(fields) })
  assert.match(ui.container.textContent, expected); assert.doesNotMatch(ui.container.textContent, omitted)
  assert.equal(ui.requests.length, 0); await ui.close()
})

test('history loads only on demand and each expanded commitment fetches its bounded events', async () => {
  const terms = { version: 1, promised_amount_native: '4000', promised_date: '2026-09-30', note: null, status: 'active' }
  const ui = await render(InvoicePromise, { invoice: invoice(), tenantId: 'tenant-a' }, async url => url.includes('promiseId=')
    ? response({ ok: true, events: [{ id: 'e2', sequence: '2', type: 'cancelled', occurredAt: '2026-09-28T10:00:00Z', beforeTerms: terms, afterTerms: { ...terms, status: 'cancelled' } },
      { id: 'e1', sequence: '1', type: 'created', occurredAt: '2026-09-28T10:00:00Z', beforeTerms: null, afterTerms: terms }] })
    : response({ ok: true, activePromise: null, promises: [promise({ status: 'cancelled' }), promise({ id: '00000000-0000-4000-8000-000000000002', status: 'missed' })] }))
  assert.equal(ui.requests.length, 0); await ui.click('Promise history'); assert.equal(ui.requests.length, 1)
  await ui.click('Show changes'); assert.equal(ui.requests.length, 2)
  const entries = [...ui.container.querySelectorAll('li')].map(item => item.textContent)
  assert.match(entries[0], /^Promised £4,000.00/); assert.match(entries[1], /^Promise cancelled/)
  assert.doesNotMatch(ui.container.textContent, /event_sequence|version|evidence|generation|baseline|resolver/)
  await ui.close()
})

for (const type of ['created', 'changed', 'note_changed', 'cancelled', 'kept', 'missed', 'unclear']) test(`history wording for ${type} hides internal event fields`, () => {
  const before = { version: 1, promised_amount_native: '4000', promised_date: '2026-09-30', note: null }
  const after = { version: 1, promised_amount_native: '3000', promised_date: '2026-10-02', note: 'Agreed new date' }
  const text = promiseEventText({ type, beforeTerms: before, afterTerms: after }, 'GBP')
  assert.ok(text.length); assert.doesNotMatch(text, /resolver|baseline|sequence|Needs review/)
  if (type === 'changed') assert.match(text, /from £4,000.00.*to £3,000.00/)
  if (type === 'note_changed') assert.match(text, /Agreed new date/)
})

test('financial invalidation refreshes the relevant queue once and never patches scores', () => {
  let count = 0
  const unsubscribe = subscribePromiseActionability('tenant-a', () => count++)
  notifyPromiseActionabilityChanged('tenant-b'); assert.equal(count, 0)
  notifyPromiseActionabilityChanged('tenant-a'); assert.equal(count, 1)
  window.dispatchEvent(new StorageEvent('storage', { key: 'yuohme:promise-actionability', newValue: JSON.stringify({ tenantId: 'tenant-a' }) }))
  assert.equal(count, 2); unsubscribe(); notifyPromiseActionabilityChanged('tenant-a'); assert.equal(count, 2)
})

test('single Promise mutation retains all other invoices and only refreshes the affected context', async () => {
  const { default: CustomerInvoiceDisputes } = loadTypeScriptModule('app/collections/customers/CustomerInvoiceDisputes.tsx')
  const initial = [invoice({ activePromise: null, activePromisedCoverageAmountNative: '0', toChaseAmountNative: '9000' }),
    invoice({ invoiceSourceId: 'invoice-b', invoiceNumber: 'B', activePromise: null })]
  let finishSave, customerRefreshes = 0
  const ui = await render(CustomerInvoiceDisputes, { tenantId: 'tenant-a', customerSourceId: 'customer-a', customerName: 'Example',
    onChanged: async () => { throw new Error('Broad Disputes refresh must not run for Promise saves') },
    onMutationStarted() {}, onMutationPending() {}, onMutationResult() {},
    onPromiseChanged: async () => { customerRefreshes++; return true },
  }, async (url, options) => {
    if (options.method === 'POST') return new Promise(resolve => { finishSave = () => resolve(response({ ok: true, promise: promise(), events: [] })) })
    return response({ ok: true, invoices: url.includes('invoiceSourceId=') ? [invoice()] : initial })
  })
  await ui.click('Record promise'); await ui.set('Promise amount (GBP)', '4000'); await ui.set('Promised date', '2026-09-30'); await ui.submit()
  assert.match(ui.container.textContent, /Saving/)
  assert.ok(document.getElementById('invoice-invoice-b'), 'Other invoice stays visible during save')
  assert.equal(document.getElementById('invoice-invoice-b').querySelector('button').disabled, false)
  await act(async () => finishSave())
  assert.equal(customerRefreshes, 1)
  const reads = ui.requests.filter(request => request.options.method !== 'POST')
  assert.equal(reads.length, 2); assert.ok(reads[1].url.includes('invoiceSourceId=invoice-a'))
  assert.equal(document.getElementById('invoice-invoice-b').textContent.includes('Record promise'), true)
  assert.match(document.getElementById('invoice-invoice-a').textContent, /Outstanding£9,000.00Promised£3,000.00/)
  assert.doesNotMatch(document.getElementById('invoice-invoice-a').textContent, /To chase/)
  assert.equal(ui.container.textContent.includes('Loading invoices…'), false)
  await ui.close()
})

test('pending submit cannot send a second concurrent command', async () => {
  let complete
  const ui = await render(InvoicePromise, { invoice: invoice(), tenantId: 'tenant-a' }, async () => new Promise(resolve => { complete = () => resolve(response({ ok: true, promise: promise(), events: [] })) }))
  await ui.click('Edit promise'); await ui.set('Promise amount (GBP)', '3000'); await ui.submit(); await ui.submit()
  assert.equal(ui.requests.length, 1)
  await act(async () => complete()); await ui.close()
})


test('Promise display preserves large exact decimal amounts without number rounding', () => {
  assert.equal(promiseMoney('9007199254740993.12345678', 'GBP'), '£9,007,199,254,740,993.12345678')
  assert.equal(promiseMoney('0.00000001', 'GBP'), '£0.00000001')
  assert.equal(promiseMoney('10.01', 'JPY'), 'JP¥10.01')
})


for (const status of ['missed', 'unclear', 'cancelled', 'kept']) test(`terminal ${status} keeps invoice outstanding without a competing To chase amount`, async () => {
  const ui = await render(InvoiceAmounts, { invoice: invoice({ activePromise: null, latestPromise: promise({ status }), activePromisedCoverageAmountNative: '0', toChaseAmountNative: '9000' }) })
  assert.match(ui.container.textContent, /Outstanding£9,000.00/)
  assert.doesNotMatch(ui.container.textContent, /Promised|To chase/)
  await ui.close()
})

test('unchanged edit is a cheap no-op with no new event, refresh or queue invalidation', async () => {
  const ui = await render(InvoicePromise, { invoice: invoice(), tenantId: 'tenant-a' })
  await ui.click('Edit promise'); await ui.submit()
  assert.equal(ui.requests.length, 0); assert.equal(ui.refreshes.length, 0)
  assert.match(ui.container.textContent, /No changes to save/)
  await ui.close()
})

for (const changes of [{amount:'3000'},{note:'New note'},{date:'2026-10-02'},{amount:'0'}]) test(`reconciled Promise ${JSON.stringify(changes)} consumes response with zero refresh GET`, async () => {
 const applied=[]
 const reconciliation={reconciliationReady:true,tenantId:'tenant-a',customerSourceId:'c1',version:{financialEpoch:'2'},detail:{invoices:[]}}
 const ui=await render(InvoicePromise,{invoice:invoice(),tenantId:'tenant-a',onReconciled:async r=>{applied.push(r);return true}},async(url,options)=>{
  assert.equal(url,'/api/collections/invoice-promises');assert.equal(JSON.parse(options.body).reconcile,true)
  return response({ok:true,committed:true,promise:promise({revision:'4'}),reconciliation})
 })
 await ui.click('Edit promise')
 if('amount'in changes)await ui.set('Promise amount (GBP)',changes.amount)
 if('date'in changes)await ui.set('Promised date',changes.date)
 if('note'in changes)await ui.set('Optional promise note',changes.note)
 await ui.submit();assert.equal(ui.requests.length,1);assert.equal(ui.refreshes.length,0);assert.deepEqual(applied,[reconciliation]);await ui.close()
})
test('committed Promise not-ready prevents repeated save and offers read recovery',async()=>{
 const ui=await render(InvoicePromise,{invoice:invoice(),tenantId:'tenant-a',onReconciled:async()=>false},async()=>response({ok:true,committed:true,promise:promise({revision:'4'}),reconciliation:{reconciliationReady:false}}))
 await ui.click('Edit promise');await ui.set('Promise amount (GBP)','3000');await ui.submit()
 assert.equal(ui.requests.length,1);assert.equal(ui.refreshes.length,0);assert.match(ui.container.textContent,/Promise saved, but/)
 const edit=[...ui.container.querySelectorAll('button')].find(b=>b.textContent==='Edit promise');assert.equal(edit.disabled,true)
 await ui.click('Refresh invoice details');assert.equal(ui.refreshes.length,1);assert.equal(ui.requests.length,1);await ui.close()
})
