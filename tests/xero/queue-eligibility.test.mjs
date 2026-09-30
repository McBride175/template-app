import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const { followUpDate } = loadTypeScriptModule('lib/collections/action-history.ts')
const { resolveQueueEligibility } = loadTypeScriptModule('lib/collections/queue-eligibility.ts')
const { selectFirstValuePriorities } = loadTypeScriptModule('lib/collections/first-value.ts')
const { selectActionableFounderContextRows } = loadTypeScriptModule('lib/collections/founder-context.ts')

function decision(overrides = {}) {
  return resolveQueueEligibility({ organisationToday: '2026-10-01', legacyToday: '2026-10-01',
    legacyActionedToday: false, overrideLevel: 'normal', hasActionableOverdueBalance: true,
    recommendedAction: 'Follow up', ...overrides })
}

test('deferral expires on the organisation-local calendar date, including UTC fallback and DST', () => {
  for (const [instant, zone, expected] of [
    ['2026-10-01T22:30:00Z', 'Pacific/Auckland', '2026-10-02'],
    ['2026-10-01T22:30:00Z', null, '2026-10-01'],
    ['2026-03-29T00:30:00Z', 'Europe/London', '2026-03-29'],
    ['2026-03-29T01:30:00Z', 'Europe/London', '2026-03-29'],
    ['2026-10-25T00:30:00Z', 'Europe/London', '2026-10-25'],
    ['2026-10-25T01:30:00Z', 'Europe/London', '2026-10-25'],
  ]) {
    const today = followUpDate(undefined, zone, new Date(instant)).today
    assert.equal(today, expected)
    assert.equal(decision({ organisationToday: today, v1NextActionDate: today }).eligible, true)
    assert.equal(decision({ organisationToday: today, v1NextActionDate: '2026-01-01' }).eligible, true)
    const tomorrow = followUpDate(undefined, zone, new Date(instant)).date
    assert.equal(decision({ organisationToday: today, v1NextActionDate: tomorrow }).reason, 'v1_deferred')
  }
})

test('one decision gives first-value and founder context the same actionability', () => {
  const rows = [
    { customer_source_id: 'deferred', customer_name: 'Deferred', override_level: 'normal',
      recommended_action: 'Follow up', has_actionable_overdue_balance: true,
      queue_eligibility_reason: decision({ v1NextActionDate: '2026-10-05' }).reason },
    { customer_source_id: 'active', customer_name: 'Active', override_level: 'normal',
      recommended_action: 'Follow up', has_actionable_overdue_balance: true,
      queue_eligibility_reason: 'eligible' },
    { customer_source_id: 'founder', customer_name: 'Founder', override_level: 'do_not_chase',
      recommended_action: 'Follow up', has_actionable_overdue_balance: true,
      queue_eligibility_reason: decision({ overrideLevel: 'do_not_chase' }).reason },
  ]
  assert.deepEqual(selectFirstValuePriorities(rows, {}).map((row) => row.customer_source_id), ['active'])
  assert.deepEqual(selectActionableFounderContextRows(rows, {}).map((row) => row.customer_source_id), ['active'])
  assert.equal(decision({ overrideLevel: 'do_not_chase' }).reason, 'do_not_chase')
  assert.equal(decision({ legacyActionType: 'postponed', legacyNextActionDate: '2026-10-05' }).reason,
    'legacy_postponed')
  assert.equal(decision({ legacyActionType: 'called', legacyNextActionDate: '2026-10-05' }).eligible, true)
  assert.equal(decision({ hasActionableOverdueBalance: false }).reason, 'no_actionable_amount')
})
