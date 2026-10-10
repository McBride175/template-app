import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const Customer = loadTypeScriptModule('app/collections/actions/QueueCustomer.tsx').default
const { default: Actions, OUTCOME_OPTIONS } = loadTypeScriptModule('app/collections/actions/QueueActionPanel.tsx')
const Order = loadTypeScriptModule('app/collections/actions/QueueOrder.tsx').default
const State = loadTypeScriptModule('app/collections/actions/QueueState.tsx').default
const render = (component, props) => new JSDOM(renderToStaticMarkup(createElement(component, props))).window.document
const customer = {
  position: 1, count: 6, name: 'Synthetic company', amount: '£137.12', email: null,
  weightedDays: '19.2', lastPayment: '—', recommendation: 'Follow up', adjustment: 'normal',
  invoicesHref: '/customers?customerSourceId=synthetic', children: 'Existing actions',
}
const actions = {
  disabled: false, saving: false, uncertain: false, followUp: 'tomorrow', followUpLabel: 'Tomorrow',
  showFollowUp: false, datesAvailable: true, minimumDate: '2026-10-11', customDate: '',
  showNote: false, note: '', onRecord() {}, onRetry() {}, onToggleFollowUp() {}, onFollowUp() {},
  onCustomDate() {}, onShowNote() {}, onNote() {},
}

test('priority position and supplied amount lead the customer view without urgency colours or arithmetic', () => {
  const d = render(Customer, { ...customer, grossOverdue: '£1000.00', disputed: '£300.00', promised: '£200.00', credit: '£500.00' })
  assert.match(d.querySelector('article').textContent, /Priority 1 of 6/)
  assert.equal(d.querySelector('h2').textContent, 'Synthetic company')
  assert.match(d.body.textContent, /£137.12/)
  for (const label of ['Gross overdue', 'Disputed overdue', 'Currently promised (overdue)', 'Xero credit deducted']) assert.match(d.body.textContent, new RegExp(label.replace(/[()]/g, '\\$&')))
  assert.equal(d.querySelector('details').hasAttribute('open'), false)
  assert.equal(d.querySelector('[class*="text-red"], [class*="bg-red"], [class*="text-amber"], [class*="bg-green"]'), null)
  assert.equal(d.querySelector('a').getAttribute('href'), customer.invoicesHref)
})

test('compact data never invents outstanding balances, score drivers or payment-pattern comparisons', () => {
  const d = render(Customer, customer)
  assert.doesNotMatch(d.body.textContent, /Total outstanding/)
  assert.match(d.body.textContent, /Detailed score drivers and payment-pattern comparisons are not available in this view/)
  assert.doesNotMatch(d.body.textContent, /Priority adjustment/)
  const full = render(Customer, { ...customer, reason: 'Exact supplied reason', breakdown: ['Exact supplied driver'], adjustment: 'priority' })
  assert.match(full.body.textContent, /Exact supplied reason/)
  assert.match(full.body.textContent, /Exact supplied driver/)
  assert.match(full.body.textContent, /Priority adjustment/)
})

test('bounded queue order retains supplied order, position and selected customer rather than sorting amounts', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ id: `${i}`, name: `Customer ${i}`, amount: i === 7 ? '£99,999.00' : '£1.00' }))
  const d = render(Order, { rows, index: 6, disabled: false, onSelect() {} })
  assert.equal(d.querySelector('ol').getAttribute('start'), '4')
  assert.equal(d.querySelectorAll('li').length, 5)
  assert.match(d.querySelector('li').textContent, /Customer 3/)
  assert.match(d.querySelector('[aria-current="true"]').textContent, /Customer 6/)
  assert.match(d.body.textContent, /Showing 4–8/)
})

test('all existing outcomes and default tomorrow timing remain exposed; custom date requires a value', () => {
  assert.deepEqual(OUTCOME_OPTIONS.map(x => x.value), ['no_response', 'message_sent', 'responded_no_commitment', 'reviewed_no_chase'])
  const d = render(Actions, actions)
  const group = d.querySelector('[aria-label="Record outcome"]')
  assert.equal(group.querySelectorAll('button').length, 4)
  assert.ok([...group.querySelectorAll('button')].every(b => !b.disabled))
  assert.match(d.body.textContent, /Do not follow up until: Tomorrow/)
  const custom = render(Actions, { ...actions, followUp: 'custom', showFollowUp: true })
  assert.ok([...custom.querySelectorAll('[aria-label="Record outcome"] button')].every(b => b.disabled))
  assert.equal(custom.querySelector('input').min, '2026-10-11')
  assert.equal(custom.querySelector('label').htmlFor, custom.querySelector('input').id)
})

test('uncertain save disables outcomes and offers the existing retry callback; loading is announced without an empty claim', () => {
  const d = render(Actions, { ...actions, uncertain: true })
  assert.ok([...d.querySelectorAll('[aria-label="Record outcome"] button')].every(b => b.disabled))
  assert.match(d.body.textContent, /Retry save/)
  const pending = render(State, { title: 'Loading next customer…', loading: true })
  assert.match(pending.querySelector('[role="status"]').textContent, /Loading next customer/)
  assert.doesNotMatch(pending.body.textContent, /Queue complete|No eligible/)
})
