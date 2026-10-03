import assert from 'node:assert/strict'
import test from 'node:test'
import { scenarios, captureFeatureInput } from './test-helpers/calculation-parity-fixture.mjs'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
import { partitionFeatureInput } from './test-helpers/customer-materialization-fixture.mjs'
const live = loadTypeScriptModule('lib/collections/customer-features.ts')
const materialized = loadTypeScriptModule('lib/collections/customer-materialization.ts')
for (const scenario of scenarios) {
  test(`materialized feature-level shadow parity: ${scenario.name}`, async () => {
    const input = await captureFeatureInput(scenario)
    assert.ok(input, 'Reference loader must supply validated calculation inputs')
    let expected
    try { expected = live.calculateCustomerFinancialFeatures(input) }
    catch (error) {
      assert.throws(() => materialized.calculateMaterializedCustomerFeature({ basis: partitionFeatureInput(input).find(b => b.payload.invoices.some(i => input.promises.has(i.source_id))).payload,
        ...input, generationId: input.snapshot.syncRunId, certificate: input.customerCredit.certificate }), { message: error.message })
      return
    }
    const result = materialized.mergeMaterializedCustomerFeatures(partitionFeatureInput(input).map(basis => {
      const invoiceIds = new Set(basis.payload.invoices.map(row => row.source_id))
      return { order: basis.order, feature: materialized.calculateMaterializedCustomerFeature({
        basis: basis.payload, ...input, generationId: input.snapshot.syncRunId, certificate: input.customerCredit.certificate,
        disputes: input.disputes.filter(row => invoiceIds.has(row.invoice_source_id)),
        promises: new Map([...input.promises].filter(([,row]) => row.customer_source_id.trim() === basis.customerId)),
      }) }
    }))
    assert.deepEqual(result, expected)
    assert.deepEqual(JSON.parse(JSON.stringify(result)), JSON.parse(JSON.stringify(expected)), 'storage round-trip')
  })
}
