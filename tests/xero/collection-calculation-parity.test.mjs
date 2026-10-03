import assert from 'node:assert/strict'
import test from 'node:test'
import { scenarios, captureCurrent, REFERENCE_SHA } from './test-helpers/calculation-parity-fixture.mjs'
import { expectedByName, provenance } from './test-helpers/calculation-goldens.mjs'

test('calculation goldens retain the independent pre-extraction reference', () => {
  assert.equal(provenance.referenceSha, REFERENCE_SHA)
  assert.equal(expectedByName.size, scenarios.length)
  assert.deepEqual(Object.keys(provenance.sources), [
    'lib/collections/customer-summary.ts', 'lib/collections/prioritization.ts', 'app/api/collections/actions/route.ts',
  ])
})

for (const scenario of scenarios) {
  test(`full original-path parity: ${scenario.name}`, async () => {
    assert.deepEqual(await captureCurrent(scenario), expectedByName.get(scenario.name))
  })
}
