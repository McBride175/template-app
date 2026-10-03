import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const { shouldApplyQueueResponse } = loadTypeScriptModule('lib/collections/queue-response-order.ts')
const stamp = (p, sequence, f = '2', g = 'generation-a') => ({
  tenantId: 'tenant-a', projectionRevision: p, financialEpoch: f,
  accountingGenerationId: g, requestSequence: sequence,
})

test('rapid Normal → Priority → Safe responses preserve the newest committed P', () => {
  const normal = stamp('10', 1), priority = stamp('11', 2), safe = stamp('12', 3)
  assert.equal(shouldApplyQueueResponse(null, safe), true)
  assert.equal(shouldApplyQueueResponse(safe, priority), false)
  assert.equal(shouldApplyQueueResponse(safe, normal), false)
})

test('Action History create then undo and concurrent priority follow P, not arrival order', () => {
  const recorded = stamp('21', 1), priority = stamp('22', 3), undone = stamp('23', 2)
  assert.equal(shouldApplyQueueResponse(recorded, undone), true)
  assert.equal(shouldApplyQueueResponse(undone, priority), false)
  assert.equal(shouldApplyQueueResponse(priority, undone), true)
})

test('financial promotion cannot be overwritten by a late old-G/F response', () => {
  const old = stamp('41', 1, '8'), promoted = stamp('42', 2, '9', 'generation-b')
  assert.equal(shouldApplyQueueResponse(promoted, old), false)
  assert.equal(shouldApplyQueueResponse(old, promoted), true)
  assert.equal(shouldApplyQueueResponse(promoted, stamp('43', 3, '8')), false)
})

test('equal P uses request order, protecting evidence-only recalculation', () => {
  assert.equal(shouldApplyQueueResponse(stamp('10', 4), stamp('10', 2)), false)
  assert.equal(shouldApplyQueueResponse(stamp('10', 2), stamp('10', 4)), true)
  assert.equal(shouldApplyQueueResponse(stamp('10', 2), stamp('10', 4, '2', 'generation-b')), false)
})

test('staged legacy responses still obey request order and tenant scope', () => {
  const legacy = stamp(null, 2, null, null)
  assert.equal(shouldApplyQueueResponse(legacy, stamp(null, 1, null, null)), false)
  assert.equal(shouldApplyQueueResponse(legacy, { ...stamp('1', 1), tenantId: 'tenant-b' }), true)
})
