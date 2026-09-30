import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const contract = loadTypeScriptModule('lib/collections/action-history.ts')
const { ACTION_HISTORY_OUTCOMES, outcome, note, followUpDate, followUpPresets, encodeHistoryCursor,
  decodeHistoryCursor, pageSize } = contract

test('only the four approved new outcomes are accepted', () => {
  assert.deepEqual([...ACTION_HISTORY_OUTCOMES], [
    'no_response', 'message_sent', 'responded_no_commitment', 'reviewed_no_chase',
  ])
  for (const key of ACTION_HISTORY_OUTCOMES) assert.equal(outcome(key), key)
  for (const key of ['called', 'emailed', 'promised_to_pay', 'disputed', 'postpone', 'other', null, '']) {
    assert.throws(() => outcome(key), /Unsupported outcome/)
  }
})

test('note is optional, bounded, and remains plain text', () => {
  assert.equal(note(undefined), null)
  assert.equal(note(''), null)
  assert.equal(note('  '), null)
  assert.equal(note('Followed up about the invoice.'), 'Followed up about the invoice.')
  assert.equal(note('x'.repeat(2000)).length, 2000)
  assert.equal(Array.from(note('🙂'.repeat(2000))).length, 2000)
  assert.throws(() => note('x'.repeat(2001)), /Invalid note/)
  assert.throws(() => note({ title: 'CRM task' }), /Invalid note/)
})

test('tomorrow uses the organisation calendar across UTC midnight', () => {
  const instant = new Date('2026-09-30T23:30:00Z')
  assert.deepEqual(followUpDate(undefined, 'Europe/London', instant), {
    date: '2026-10-02', today: '2026-10-01', timezone: 'Europe/London',
  })
  assert.deepEqual(followUpDate(undefined, 'America/Los_Angeles', instant), {
    date: '2026-10-01', today: '2026-09-30', timezone: 'America/Los_Angeles',
  })
})

test('custom date must be a real future organisation-local calendar date', () => {
  const now = new Date('2026-09-30T23:30:00Z')
  assert.equal(followUpDate('2026-10-15', 'Europe/London', now).date, '2026-10-15')
  for (const value of ['2026-10-01', '2026-09-30', '2026-02-30', '2026-10-32', 'today', '2026-10-01T00:00:00Z', '']) {
    assert.throws(() => followUpDate(value, 'Europe/London', now), /next_action_date/)
  }
})

test('missing or invalid organisation timezone falls back to UTC', () => {
  const now = new Date('2026-09-30T23:30:00Z')
  assert.deepEqual(followUpDate(undefined, null, now), {
    date: '2026-10-01', today: '2026-09-30', timezone: 'UTC',
  })
  assert.deepEqual(followUpDate(undefined, 'invalid/timezone', now), {
    date: '2026-10-01', today: '2026-09-30', timezone: 'UTC',
  })
})

test('DST transitions add one local calendar day, not 24 hours to a timestamp', () => {
  assert.equal(followUpDate(undefined, 'Europe/London', new Date('2026-03-29T00:30:00Z')).date, '2026-03-30')
  assert.equal(followUpDate(undefined, 'Europe/London', new Date('2026-10-25T00:30:00Z')).date, '2026-10-26')
  assert.equal(followUpDate(undefined, 'America/New_York', new Date('2026-03-08T06:30:00Z')).date, '2026-03-09')
})

test('UI presets come from the same server-side organisation calendar', () => {
  assert.deepEqual(followUpPresets('Europe/London', new Date('2026-09-30T23:30:00Z')), {
    today: '2026-10-01', tomorrow: '2026-10-02', inTwoDays: '2026-10-03',
    inThreeDays: '2026-10-04', nextWeek: '2026-10-08', timezone: 'Europe/London',
  })
  assert.deepEqual(followUpPresets(null, new Date('2026-09-30T23:30:00Z')), {
    today: '2026-09-30', tomorrow: '2026-10-01', inTwoDays: '2026-10-02',
    inThreeDays: '2026-10-03', nextWeek: '2026-10-07', timezone: 'UTC',
  })
})

test('history cursor and page size reject malformed input', () => {
  const source = { actionTimestamp: '2026-09-30T10:00:00.000Z', id: 'a650b194-f381-43a7-9849-a4de4412ba8b' }
  assert.deepEqual(decodeHistoryCursor(encodeHistoryCursor(source)), source)
  assert.throws(() => decodeHistoryCursor('!!!'), /Invalid cursor/)
  assert.throws(() => decodeHistoryCursor(encodeHistoryCursor({ ...source, actionTimestamp: 'yesterday' })), /Invalid cursor/)
  assert.equal(pageSize('100000'), 50)
  assert.throws(() => pageSize('0'), /Invalid limit/)
})
