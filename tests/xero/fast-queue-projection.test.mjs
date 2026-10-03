import assert from 'node:assert/strict'
import test from 'node:test'
import { scenarios, captureFeatureInput, EVALUATION_INSTANT } from './test-helpers/calculation-parity-fixture.mjs'
import { expectedByName } from './test-helpers/calculation-goldens.mjs'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const { calculateCustomerFinancialFeatures } = loadTypeScriptModule('lib/collections/customer-features.ts')
const { calculateReusablePortfolio } = loadTypeScriptModule('lib/collections/portfolio-materialization.ts')
const { projectPersistedCollectionQueue } = loadTypeScriptModule('lib/collections/fast-queue-projection.ts')
const { selectCollectionQueueWindow } = loadTypeScriptModule('lib/collections/fast-queue-window.ts')
const json = value => JSON.parse(JSON.stringify(value))

for (const scenario of scenarios) {
  test(`persisted queue projection matches frozen current behaviour: ${scenario.name}`, async () => {
    const expected = expectedByName.get(scenario.name)
    if (expected.summary.error) return
    const features = calculateCustomerFinancialFeatures(await captureFeatureInput(scenario))
    if (!features.organisationBaseCurrency || features.currencyHealth.status === 'unavailable') return
    const params = new URLSearchParams(scenario.query ?? 'overdueOnly=true')
    const calc = calculateReusablePortfolio(features, params.get('overdueOnly') === 'true')
    const latestV1ByCustomerSourceId = new Map()
    const latestLegacyActionByCustomerSourceId = new Map()
    for (const action of [...(scenario.actions ?? [])].sort((a, b) =>
      a.action_timestamp.localeCompare(b.action_timestamp) || a.id.localeCompare(b.id))) {
      if (action.action_type === 'outcome') latestV1ByCustomerSourceId.set(action.customer_source_id, action)
      else latestLegacyActionByCustomerSourceId.set(action.customer_source_id, {
        type: action.action_type, takenAtIso: action.action_timestamp,
        outcome: action.outcome, nextActionDate: action.next_action_date, actionId: action.id,
      })
    }
    const instant = new Date(scenario.instant ?? EVALUATION_INSTANT)
    const organisationTodayDateIso = new Intl.DateTimeFormat('en-CA', {
      timeZone: features.organisationTimezone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(instant)
    const overlay = {
        organisationBaseCurrency: features.organisationBaseCurrency,
        currencyHealth: features.currencyHealth, sourceCounts: features.sourceCounts,
        reviewRequiredCustomerCount: features.reviewRequiredCustomers.length,
        overrideLevelByCustomerSourceId: new Map(scenario.overrides ?? []),
        latestV1ByCustomerSourceId, latestLegacyActionByCustomerSourceId,
        actionsTakenByCustomerId: expected.queue.body.actionsTakenByCustomerId,
        organisationTodayDateIso, legacyTodayDateIso: instant.toISOString().slice(0, 10),
        limit: Number(params.get('limit') ?? 50),
      }
    const projected = projectPersistedCollectionQueue({
      benchmarks: calc.benchmarks, rows: json(calc.rows), overlay,
    })
    assert.deepEqual(json(projected.rows), expected.queue.body.rows)
    assert.deepEqual(json(projected.queue), expected.queue.body.queue)
    assert.deepEqual(json(projected.portfolio), expected.queue.body.portfolio)
    const selected = selectCollectionQueueWindow({
      rankRows: calc.rows.filter(row => row.score).map(row => ({
        customerId: row.customerId, order: row.order,
        customerName: row.score.input.customer_name,
        amountDecimal: row.projection.customer_to_chase_overdue_base_decimal,
        baseScore: row.score.weighted,
        hasActionableOverdueBalance: row.score.input.has_actionable_overdue_balance,
      })),
      benchmarks: calc.benchmarks, population: calc.population,
      ...overlay,
    })
    assert.deepEqual(selected.selectedCustomerIds, expected.queue.body.rows.map(row => row.customer_source_id))
    assert.deepEqual(json(selected.queue), expected.queue.body.queue)
    assert.deepEqual(json(selected.portfolio), expected.queue.body.portfolio)
    const selectedSet = new Set(selected.selectedCustomerIds)
    const renderedOnly = projectPersistedCollectionQueue({
      benchmarks: calc.benchmarks,
      rows: json(calc.rows.filter(row => selectedSet.has(row.customerId))),
      overlay, populationCounts: calc.population,
    })
    assert.deepEqual(json(renderedOnly.rows), expected.queue.body.rows)
  })
}
