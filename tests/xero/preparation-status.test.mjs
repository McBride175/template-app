import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const preparation = loadTypeScriptModule('lib/xero/preparation-status.ts')

const startedAt = '2026-09-17T12:00:00Z'

function attempt(overrides = {}) {
  return {
    state: 'running',
    startedAt,
    errorCode: null,
    ...overrides,
  }
}

function step(stepKey, recordCount, status = 'succeeded') {
  return { stepKey, status, recordCount }
}

const retrievalSteps = [
  step('contacts', 54),
  step('authorised_accrec_invoices', 20),
  step('paid_accrec_invoices', 27),
  step('authorised_accrec_payments', 32),
]

test('a resolved connection without a run is connected but not falsely active', () => {
  assert.deepEqual(
    preparation.resolveXeroPreparationStatus({
      snapshot: { mode: 'legacy', syncRunId: null },
      lastSyncedAt: null,
      attempt: null,
      steps: [],
    }),
    {
      stage: 'connected',
      active: false,
      startedAt: null,
      counts: null,
      failureKind: null,
    }
  )
})

test('run steps reconstruct truthful reading, analysis, and priority-building stages', () => {
  const base = {
    snapshot: { mode: 'legacy', syncRunId: null },
    lastSyncedAt: null,
    attempt: attempt(),
  }

  assert.equal(
    preparation.resolveXeroPreparationStatus({
      ...base,
      steps: [step('organisation', 1), step('contacts', null, 'pending')],
    }).stage,
    'reading_xero'
  )

  const analysing = preparation.resolveXeroPreparationStatus({
    ...base,
    steps: retrievalSteps,
  })
  assert.equal(analysing.stage, 'analysing_receivables')
  assert.deepEqual(analysing.counts, { contacts: 54, invoices: 47, payments: 32 })

  const building = preparation.resolveXeroPreparationStatus({
    ...base,
    steps: [...retrievalSteps, step('canonical_mapping', 134)],
  })
  assert.equal(building.stage, 'building_priorities')
  assert.deepEqual(building.counts, analysing.counts)
})

test('record counts remain hidden until every retrieval stream is complete', () => {
  const result = preparation.resolveXeroPreparationStatus({
    snapshot: { mode: 'legacy', syncRunId: null },
    lastSyncedAt: null,
    attempt: attempt(),
    steps: retrievalSteps.slice(0, -1),
  })

  assert.equal(result.stage, 'reading_xero')
  assert.equal(result.counts, null)
})

test('authoritative readiness wins immediately without replaying skipped browser stages', () => {
  const result = preparation.resolveXeroPreparationStatus({
    snapshot: { mode: 'generation', syncRunId: 'generation-ready' },
    lastSyncedAt: '2026-09-17T12:00:05Z',
    attempt: attempt(),
    steps: [],
  })

  assert.equal(result.stage, 'ready')
  assert.equal(result.active, false)
})

test('failed and expired runs are distinct from active work and expose only safe categories', () => {
  const providerFailure = preparation.resolveXeroPreparationStatus({
    snapshot: { mode: 'legacy', syncRunId: null },
    lastSyncedAt: null,
    attempt: attempt({ state: 'failed', errorCode: 'provider_timeout' }),
    steps: [],
  })
  assert.equal(providerFailure.stage, 'failed')
  assert.equal(providerFailure.failureKind, 'provider_failure')

  const interrupted = preparation.resolveXeroPreparationStatus({
    snapshot: { mode: 'legacy', syncRunId: null },
    lastSyncedAt: null,
    attempt: attempt({ state: 'interrupted' }),
    steps: [],
  })
  assert.equal(interrupted.stage, 'interrupted')
  assert.equal(interrupted.active, false)

  assert.equal(
    preparation.classifyXeroPreparationFailure('xero_reauth_required'),
    'reconnect_required'
  )
  assert.equal(
    preparation.classifyXeroPreparationFailure('xero_permission_required'),
    'permission_upgrade_required'
  )
  assert.equal(
    preparation.classifyXeroPreparationFailure('persistence_failed'),
    'preparation_failure'
  )
})
