import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
import { promise, payment, observation } from './test-helpers/promise-evidence-fixture.mjs'
const { qualifyPromisePayments: qualify } = loadTypeScriptModule('lib/collections/promise-payment-qualification.ts')
const { derivePromiseTimeContext } = loadTypeScriptModule('lib/collections/promise-evidence.ts')
const run = (payments, terms = {}, observed = {}) => qualify({ promise: promise(terms), payments, observation: observation(payments, [], observed) })

test('baseline identity never contributes even when its amount/date changes', () => {
  const result = run([payment({ source_id: 'old-payment', amount_native: '5000', payment_date: '2026-09-30' })])
  assert.equal(result.valid, true)
  assert.equal(result.qualifying_paid_amount_native, '0')
  assert.equal(result.excluded[0].reason, 'creation_baseline')
})
test('new supported invoice payments sum once without capping to commitment', () => {
  const rows = [payment({ amount_native: '3000' }), payment({ source_id: 'payment-2', amount_native: '2000' })]
  const result = run(rows)
  assert.equal(result.qualifying_paid_amount_native, '5000')
  assert.equal(result.contributions.length, 2)
  assert.deepEqual(run([...rows].reverse()), result)
})
for (const changed of [false, true]) {
  test(`duplicate durable identity (${changed ? 'conflicting' : 'identical'}) invalidates evidence`, () => {
    const result = run([payment(), payment({ amount_native: changed ? '2000' : '1000' })])
    assert.equal(result.valid, false)
    assert.equal(result.qualifying_paid_amount_native, null)
  })
}
for (const [overrides, reason] of [
  [{ invoice_source_id: 'another-invoice' }, 'another_invoice'],
  [{ payment_type: 'ARCREDITPAYMENT' }, 'unsupported_payment_type'],
  [{ payment_type: 'ACCPAYPAYMENT' }, 'unsupported_payment_type'],
  [{ payment_status: 'DELETED' }, 'deleted_payment'],
  [{ payment_date: '2026-09-26' }, 'before_creation_date'],
  [{ payment_date: '2026-10-01' }, 'after_promised_date'],
]) {
  test(`non-qualifying evidence: ${reason} ${JSON.stringify(overrides)}`, () => {
    const result = run([payment(overrides)])
    assert.equal(result.valid, true)
    assert.equal(result.qualifying_paid_amount_native, '0')
    assert.equal(result.excluded[0].reason, reason)
  })
}
for (const overrides of [{ user_id: 'other' }, { tenant_id: 'other' }, { source_system: 'other' },
  { sync_run_id: 'other' }, { customer_source_id: 'other' }]) {
  test(`cross-scope or same-invoice customer mismatch is rejected: ${JSON.stringify(overrides)}`, () => {
    const result = run([payment(overrides)])
    assert.equal(result.valid, false)
    assert.equal(result.reason, 'identity_invalid')
  })
}
test('same-day non-baseline payment qualifies despite unknown intraday cash timing', () => {
  const result = run([payment({ payment_date: '2026-09-27', source_updated_at: '2026-09-27T07:00:00Z' })])
  assert.equal(result.qualifying_paid_amount_native, '1000')
})
test('creation lower bound uses organisation local date rather than UTC creation date', () => {
  const result = run([payment({ payment_date: '2026-09-27' })], { created_at: '2026-09-27T23:30:00Z' })
  assert.equal(result.creation_local_date, '2026-09-28')
  assert.equal(result.qualifying_paid_amount_native, '0')
})
test('promised day itself qualifies and later modification time is not payment time', () => {
  const result = run([payment({ payment_date: '2026-09-30', source_updated_at: '2026-10-01T02:00:00Z' })])
  assert.equal(result.qualifying_paid_amount_native, '1000')
})
test('exact fractions and very large contributions remain exact', () => {
  const result = run([payment({ amount_native: '12345678901234567890.1' }), payment({ source_id: 'p2', amount_native: '0.2' })])
  assert.equal(result.qualifying_paid_amount_native, '12345678901234567890.3')
})
for (const amount of ['-1', 'NaN', 0.1, null]) {
  test(`invalid/inexact native amount ${String(amount)} cannot become zero evidence`, () => {
    assert.equal(run([payment({ amount_native: amount })]).valid, false)
  })
}
test('currency mismatch and unavailable invoice currency fail closed', () => {
  for (const currency_code of ['USD', null, 'GB']) {
    const result = run([payment({ currency_code })])
    assert.equal(result.valid, false)
    assert.equal(result.reason, 'currency_evidence_unavailable')
  }
})
test('deleted observation recomputes paid amount downward instead of accumulating', () => {
  assert.equal(run([payment({ amount_native: '4000' })]).qualifying_paid_amount_native, '4000')
  assert.equal(run([payment({ amount_native: '4000', payment_status: 'DELETED' })]).qualifying_paid_amount_native, '0')
})
test('incomplete observation and omitted records invalidate qualification', () => {
  const rows = [payment()], observed = observation(rows)
  observed.resources[0].complete = false
  assert.equal(qualify({ promise: promise(), payments: rows, observation: observed }).valid, false)
  assert.equal(qualify({ promise: promise(), payments: [], observation: observation(rows) }).valid, false)
})
test('failed/candidate/wrong-contract observations cannot establish paid totals', () => {
  for (const observed of [{ status: 'failed' }, { status: 'candidate' }, { authoritative: false }, { contract_version: 'old' }]) {
    assert.equal(run([payment()], {}, observed).valid, false)
  }
})
test('invalid baseline provenance, version or duplicate IDs fail closed', () => {
  const original = promise().payment_baseline
  for (const baseline of [{ ...original, version: 2 }, { ...original, payment_ids: ['old', 'old'] },
    { ...original, observation_completed_at: '2026-09-27T10:00:00Z' }, { ...original, observation_started_at: 'bad' }]) {
    assert.equal(run([payment()], { payment_baseline: baseline }).reason, 'baseline_invalid')
  }
})
test('invalid dates and boundary provenance are unavailable', () => {
  assert.equal(run([payment({ payment_date: '2026-02-30' })]).valid, false)
  assert.equal(run([payment()], {}, { timezone_iana: 'Unknown/Zone' }).reason, 'timezone_unavailable')
  const observed = observation([payment()]); observed.resources[0].completed_at = '2026-09-26T00:00:00Z'
  assert.equal(qualify({ promise: promise(), payments: [payment()], observation: observed }).valid, false)
})
for (const [date, zone, expected] of [
  ['2026-09-30', 'Europe/London', '2026-09-30T23:00:00.000Z'],
  ['2026-03-29', 'Europe/London', '2026-03-29T23:00:00.000Z'],
  ['2026-10-25', 'Europe/London', '2026-10-26T00:00:00.000Z'],
  ['2026-09-30', 'America/New_York', '2026-10-01T04:00:00.000Z'],
  ['2026-09-30', 'Asia/Tokyo', '2026-09-30T15:00:00.000Z'],
  ['2026-09-30', 'Australia/Sydney', '2026-09-30T14:00:00.000Z'],
]) {
  test(`whole-day boundary ${date} in ${zone}`, () => {
    assert.equal(derivePromiseTimeContext('2026-01-01T00:00:00Z', date, zone).deadlineBoundary, expected)
  })
}
test('supported payment without invoice identity and unknown status fail closed', () => {
  assert.equal(run([payment({ invoice_source_id: null })]).reason, 'identity_invalid')
  assert.equal(run([payment({ payment_status: 'VOIDED' })]).valid, false)
})
test('duplicate or temporally malformed resource observations cannot certify completeness', () => {
  for (const change of [row => { row.completed_at = 'not-a-time' }, row => { row.started_at = '2026-10-01T02:00:00Z' },
    row => { row.page_requests = row.populated_pages }]) {
    const observed = observation([payment()]); change(observed.resources[0])
    assert.equal(qualify({ promise: promise(), payments: [payment()], observation: observed }).valid, false)
  }
  const observed = observation([payment()]); observed.resources.push({ ...observed.resources[0] })
  assert.equal(qualify({ promise: promise(), payments: [payment()], observation: observed }).valid, false)
})
test('qualification deterministically preserves immutable input baseline and records', () => {
  const record = promise(), rows = [payment()], observed = observation(rows)
  const before = JSON.stringify({ record, rows, observed })
  qualify({ promise: record, payments: rows, observation: observed })
  assert.equal(JSON.stringify({ record, rows, observed }), before)
})
test('missing timezone and impossible calendar day never fall back to UTC', () => {
  assert.equal(derivePromiseTimeContext('2026-09-27T09:00:00Z', '2026-09-30', null), null)
  assert.equal(derivePromiseTimeContext('2026-09-27T09:00:00Z', '2026-02-30', 'Europe/London'), null)
})
