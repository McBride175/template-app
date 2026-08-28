import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyObjectionFlags,
  applyRestrictionFlags,
  canAccessPrivacyResource,
  computeDueAtIso,
  getErasureAuditActions,
  isOverdue,
  stripSecretsFromObject,
} from '../../lib/privacy-utils.mjs'

test('unauthorized access is blocked by ownership helper', () => {
  assert.equal(
    canAccessPrivacyResource({
      actorUserId: 'user-a',
      ownerUserId: 'user-b',
      isAdmin: false,
    }),
    false
  )

  assert.equal(
    canAccessPrivacyResource({
      actorUserId: 'user-a',
      ownerUserId: 'user-a',
      isAdmin: false,
    }),
    true
  )
})

test('export sanitization removes secret-like keys', () => {
  const raw = {
    id: '123',
    email: 'user@example.com',
    password_hash: 'hash',
    nested: {
      apiKey: 'secret-key',
      safe: 'value',
    },
  }

  const sanitized = stripSecretsFromObject(raw)
  assert.equal('password_hash' in sanitized, false)
  assert.equal('apiKey' in sanitized.nested, false)
  assert.equal(sanitized.nested.safe, 'value')
})

test('restriction/object helpers set privacy flags', () => {
  const current = {
    processing_restricted: false,
    marketing_opt_out: false,
    analytics_opt_out: false,
    ai_processing_opt_out: false,
  }

  const restricted = applyRestrictionFlags(current, {
    processingRestricted: true,
    analyticsOptOut: true,
  })

  assert.equal(restricted.processing_restricted, true)
  assert.equal(restricted.analytics_opt_out, true)

  const objection = applyObjectionFlags(current, {
    marketing: true,
    analytics: true,
    ai: true,
    restrictProcessing: true,
  })

  assert.equal(objection.marketing_opt_out, true)
  assert.equal(objection.analytics_opt_out, true)
  assert.equal(objection.ai_processing_opt_out, true)
  assert.equal(objection.processing_restricted, true)
})

test('due date helper sets 30-day SLA and overdue logic', () => {
  const createdAt = '2026-02-01T00:00:00.000Z'
  const dueAt = computeDueAtIso(createdAt)
  assert.equal(dueAt, '2026-03-03T00:00:00.000Z')

  assert.equal(isOverdue(dueAt, 'IN_PROGRESS', Date.parse('2026-03-04T00:00:00.000Z')), true)
  assert.equal(isOverdue(dueAt, 'FULFILLED', Date.parse('2026-03-04T00:00:00.000Z')), false)
})

test('erasure audit actions include lifecycle markers', () => {
  const actions = getErasureAuditActions()
  assert.deepEqual(actions, [
    'ERASURE_REQUEST_RECEIVED',
    'ERASURE_REQUEST_IN_PROGRESS',
    'ERASURE_REQUEST_FULFILLED',
  ])
})
