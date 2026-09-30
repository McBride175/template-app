import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const history = loadTypeScriptModule('lib/collections/customer-history.ts')
const id = '00000000-0000-4000-8000-000000000001'
const at = '2026-09-30T10:34:00.000Z'
const row = (kind, payload, prefix = kind) => ({ event_id: `${prefix}:${id}`,
  event_kind: kind, occurred_at: at, payload })
const terms = (amount = '1500', note = null) => ({ version: 1, promised_amount_native: amount,
  currency_code: 'GBP', promised_date: '2026-10-02', note, status: 'active' })

test('four V1 outcomes project with notes and follow-up dates; only they are deletable', () => {
  const outcomes = [
    ['no_response', 'No response'], ['message_sent', 'Message sent'],
    ['responded_no_commitment', 'Responded — no commitment'],
    ['reviewed_no_chase', 'Reviewed — no chase needed'],
  ]
  for (const [key, label] of outcomes) {
    const event = history.projectCustomerHistoryEvent(row('action', {
      outcome: key, note: 'Remember context', nextActionDate: '2026-10-01',
    }))
    assert.equal(event.label, label)
    assert.equal(event.note, 'Remember context')
    assert.equal(event.followUpDate, '2026-10-01')
    assert.equal(event.actionId, id)
    assert.equal(event.deletable, true)
  }
  assert.throws(() => history.projectCustomerHistoryEvent(row('action', { outcome: 'promised_to_pay' })))
})

test('Promise lifecycle uses authoritative before/after terms and remains read-only', () => {
  const types = ['created', 'changed', 'note_changed', 'cancelled', 'kept', 'missed', 'unclear']
  const labels = ['Promise recorded', 'Promise changed', 'Promise note changed',
    'Promise cancelled', 'Promise kept', 'Promise missed', 'Promise outcome unclear']
  types.forEach((eventType, index) => {
    const event = history.projectCustomerHistoryEvent(row('promise', {
      eventType, beforeTerms: eventType === 'created' ? null : terms('1000'),
      afterTerms: terms('1500', 'Confirm next week'), invoiceSourceId: 'invoice-a', currencyCode: 'GBP',
    }))
    assert.equal(event.label, labels[index])
    assert.equal(event.deletable, false)
    assert.equal(event.invoiceSourceId, 'invoice-a')
    if (eventType === 'changed') assert.match(event.detail, /£1,000.*£1,500/)
    if (eventType === 'note_changed') assert.match(event.detail, /Confirm next week/)
  })
})

test('Dispute milestones contain no invented prior amount, note, edit or reactivation data', () => {
  const raised = history.projectCustomerHistoryEvent(row('dispute_created',
    { invoiceSourceId: 'invoice-a' }, 'dispute-created'))
  const resolved = history.projectCustomerHistoryEvent(row('dispute_resolved',
    { invoiceSourceId: 'invoice-a' }, 'dispute-resolved'))
  assert.equal(raised.label, 'Dispute raised')
  assert.equal(resolved.label, 'Dispute resolved')
  for (const event of [raised, resolved]) {
    assert.equal(event.deletable, false)
    assert.equal(event.detail, null)
    assert.equal(event.note, null)
    assert.equal(event.followUpDate, null)
  }
})

test('legacy contacts remain honestly labelled and never masquerade as a Promise or Dispute', () => {
  const legacy = history.projectCustomerHistoryEvent(row('legacy', {
    actionType: 'called', outcome: 'promised_to_pay', nextActionDate: '2026-10-02',
  }))
  assert.equal(legacy.kind, 'legacy')
  assert.equal(legacy.label, 'Called · legacy activity')
  assert.equal(legacy.detail, 'Legacy outcome: Promised to pay')
  assert.equal(legacy.followUpDate, null)
  assert.equal(legacy.deletable, false)
  const postponed = history.projectCustomerHistoryEvent(row('legacy', {
    actionType: 'postponed', outcome: null, nextActionDate: '2026-10-02',
  }))
  assert.equal(postponed.followUpDate, '2026-10-02')
})

test('cursor retains timestamp and namespaced tie-breaker and rejects malformed input', () => {
  const cursor = { timestamp: at, id: `promise:${id}` }
  assert.deepEqual(history.decodeCustomerHistoryCursor(history.encodeCustomerHistoryCursor(cursor)), cursor)
  const postgresTimestamp = { timestamp: '2026-09-30T10:34:00.123456+00:00', id: `action:${id}` }
  assert.deepEqual(history.decodeCustomerHistoryCursor(history.encodeCustomerHistoryCursor(postgresTimestamp)), postgresTimestamp)
  assert.throws(() => history.decodeCustomerHistoryCursor('bad'))
  assert.throws(() => history.decodeCustomerHistoryCursor(history.encodeCustomerHistoryCursor({ ...cursor, id: 'payment:x' })))
  assert.equal(history.customerHistoryUrl, undefined)
})
