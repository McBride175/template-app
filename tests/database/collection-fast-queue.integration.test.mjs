import assert from 'node:assert/strict'
import test, { before, after, beforeEach } from 'node:test'
import * as db from './test-helpers/dependency-database-fixture.mjs'
import { randomUUID } from 'node:crypto'
import { cert } from './test-helpers/materialization-client.mjs'
import { client, parameters, portfolio } from './test-helpers/portfolio-client.mjs'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const fastQueue = loadTypeScriptModule('lib/collections/fast-queue-projection-server.ts')

const enabled = process.env.RUN_SUPABASE_INTEGRATION === '1'
const check = (name, run) => test(name, { skip: !enabled }, run)
before(() => { if (enabled) db.setup() })
after(() => { if (enabled) db.cleanup() })
beforeEach(() => { if (enabled) db.reset() })

function ready() {
  const run = db.ready({ extraInvoices: [{ source_id: 'i2', customer_source_id: 'c2', amount_due_native: '500', amount_due_base: '500' }],
    invoiceChanges: { due_date: '2026-09-01' } })
  cert(db, run.run)
  return run
}
function read() {
  return JSON.parse(db.rpc(`select public.read_collection_queue_projection_inputs('${db.user}','tenant-a','2026-10-01',true);`))
}

check('one ready snapshot contains complete scores, overlays and held P without canonical reads', async () => {
  ready()
  const admin = client(db)
  const calculation = await portfolio.ensurePortfolioBaseCalculation(parameters(db, admin))
  const first = read()
  assert.equal(first.head.calculationId, calculation.calculationId)
  assert.equal(first.rankRows.length, 2)
  assert.deepEqual(first.overrides, [])
  assert.deepEqual(first.actions, [])
  assert.equal(first.context.financialEpoch, db.head().financialEpoch)
  assert.equal(first.projectionRevision, db.head().projectionRevision)
  const originalP = BigInt(first.projectionRevision)
  db.psql(db.override())
  const priority = read()
  assert.equal(priority.head.calculationId, calculation.calculationId)
  assert.equal(priority.context.financialEpoch, first.context.financialEpoch)
  assert.equal(BigInt(priority.projectionRevision), originalP + 1n)
  assert.deepEqual(priority.overrides, [{ customer_source_id: 'c1', override_level: 'priority' }])
  db.psql("delete from public.customer_overrides where customer_source_id='c1';")
  const normal = read()
  assert.equal(normal.head.calculationId, calculation.calculationId)
  assert.equal(BigInt(normal.projectionRevision), originalP + 2n)
  assert.deepEqual(normal.overrides, [])
  assert.equal(admin.calls.filter(call => call.name === 'read_collection_queue_projection_inputs').length, 0)
})

check('Action History create/undo changes only P and latest eligibility overlay', async () => {
  ready()
  const calculation = await portfolio.ensurePortfolioBaseCalculation(parameters(db, client(db)))
  const before = read()
  const id = randomUUID()
  db.psql(db.action(id))
  const after = read()
  assert.equal(after.head.calculationId, calculation.calculationId)
  assert.equal(after.context.financialEpoch, before.context.financialEpoch)
  assert.equal(BigInt(after.projectionRevision), BigInt(before.projectionRevision) + 1n)
  assert.equal(after.actions.length, 1)
  assert.equal(after.actions[0].id, id)
  assert.equal(after.hasPriorActionActivity, true)
  db.psql(`delete from public.collection_actions where id='${id}';`)
  const undone = read()
  assert.equal(undone.head.calculationId, calculation.calculationId)
  assert.deepEqual(undone.actions, [])
  assert.equal(BigInt(undone.projectionRevision), BigInt(after.projectionRevision) + 1n)
})

check('live fast service returns authoritative refill without feature or score rebuild', async () => {
  ready()
  const admin = client(db)
  const calc = await portfolio.ensurePortfolioBaseCalculation(parameters(db, admin))
  const callsBefore = admin.calls.length
  const params = { admin, userId: db.user, tenantId: 'tenant-a',
    evaluationInstant: new Date('2026-10-01T12:00:00Z'), overdueOnly: true,
    limit: 1, legacyTodayDateIso: '2026-10-01' }
  const baseline = await fastQueue.readCollectionQueueProjection(params)
  assert.equal(baseline.version.financialCalculationId, calc.calculationId)
  assert.equal(baseline.metrics.roundTrips, 2)
  assert.equal(baseline.rows.length, 1)
  assert.equal(baseline.queue.returnedCustomerCount, 1)
  assert.equal(baseline.metrics.calculationRebuilt, false)
  const firstCustomer = baseline.rows[0].customer_source_id
  const secondCustomer = firstCustomer === 'c1' ? 'c2' : 'c1'
  const actionId = randomUUID()
  db.psql(db.action(actionId, firstCustomer))
  const actioned = await fastQueue.readCollectionQueueProjection(params)
  assert.equal(actioned.version.financialCalculationId, calc.calculationId)
  assert.equal(actioned.rows[0].customer_source_id, secondCustomer)
  assert.equal(actioned.queue.returnedCustomerCount, 1)
  assert.equal(actioned.metrics.roundTrips, 2)
  assert.equal(actioned.metrics.calculationRebuilt, false)
  db.psql(`delete from public.collection_actions where id='${actionId}';`)
  const restored = await fastQueue.readCollectionQueueProjection(params)
  assert.equal(restored.rows[0].customer_source_id, firstCustomer)
  assert.equal(restored.version.financialCalculationId, calc.calculationId)
  assert.equal(admin.calls.slice(callsBefore).filter(call => call.name === 'read_collection_queue_projection_inputs').length, 3)
  assert.equal(admin.calls.slice(callsBefore).filter(call => call.name === 'read_collection_queue_projection_details').length, 3)
  assert.equal(admin.calls.slice(callsBefore).filter(call => call.name === 'read_collection_customer_materialization').length, 0)
})

check('F/G changes invalidate the projection atomically; recovery uses a new calculation', async () => {
  ready()
  const before = await portfolio.ensurePortfolioBaseCalculation(parameters(db, client(db)))
  db.dispute('i1', 100)
  const stale = read()
  assert.equal(stale.head, null)
  assert.equal(stale.rankRows.length, 0)
  assert.notEqual(stale.context.financialEpoch, before.identity.financialEpoch)
  const next = await portfolio.ensurePortfolioBaseCalculation(parameters(db, client(db)))
  assert.equal(read().head.calculationId, next.calculationId)
  ready()
  const promoted = read()
  assert.equal(promoted.head, null)
  assert.notEqual(promoted.context.generationId, next.identity.generationId)
})

check('service-only projection RPC enforces scope and denies browser roles', async () => {
  ready()
  await portfolio.ensurePortfolioBaseCalculation(parameters(db, client(db)))
  assert.equal(JSON.parse(db.rpc(`select public.read_collection_queue_projection_inputs('${db.other}','tenant-a','2026-10-01',true);`)).head, null)
  assert.equal(JSON.parse(db.rpc(`select public.read_collection_queue_projection_inputs('${db.user}','tenant-b','2026-10-01',true);`)).head, null)
  for (const role of ['anon', 'authenticated']) {
    assert.throws(() => db.psql(`set role ${role};select public.read_collection_queue_projection_inputs('${db.user}','tenant-a','2026-10-01',true);`), /permission denied/)
  }
  assert.equal(db.psql("select count(*) from pg_proc where proname='read_collection_queue_projection_inputs' and prosecdef and pg_get_userbyid(proowner)='postgres' and proconfig @> array['search_path=pg_catalog'];"), '1')
})

check('P change between rank and detail snapshots retries and returns the new overlay', async () => {
  ready()
  await portfolio.ensurePortfolioBaseCalculation(parameters(db, client(db)))
  let changed = false
  const admin = client(db, name => {
    if (name === 'read_collection_queue_projection_details' && !changed) {
      changed = true
      db.psql(db.override('safe', 'c1'))
    }
  })
  const result = await fastQueue.readCollectionQueueProjection({ admin, userId: db.user,
    tenantId: 'tenant-a', evaluationInstant: new Date('2026-10-01T12:00:00Z'),
    overdueOnly: true, limit: 2, legacyTodayDateIso: '2026-10-01' })
  assert.equal(changed, true)
  assert.equal(result.version.projectionRevision, db.head().projectionRevision)
  assert.equal(result.rows.find(row => row.customer_source_id === 'c1').override_level, 'safe')
  assert.equal(admin.calls.filter(call => call.name === 'read_collection_queue_projection_inputs').length, 2)
})

check('financial mutation between rank and details rejects old F and rebuilds current scores', async () => {
  ready()
  const original = await portfolio.ensurePortfolioBaseCalculation(parameters(db, client(db)))
  let changed = false
  const admin = client(db, name => {
    if (name === 'read_collection_queue_projection_details' && !changed) {
      changed = true
      db.dispute('i1', 100)
    }
  })
  const result = await fastQueue.readCollectionQueueProjection({ admin, userId: db.user,
    tenantId: 'tenant-a', evaluationInstant: new Date('2026-10-01T12:00:00Z'),
    overdueOnly: true, limit: 2, legacyTodayDateIso: '2026-10-01' })
  assert.equal(changed, true)
  assert.notEqual(result.version.financialCalculationId, original.calculationId)
  assert.equal(result.version.financialEpoch, db.head().financialEpoch)
  assert.equal(admin.calls.filter(call => call.name === 'read_collection_queue_projection_inputs').length >= 2, true)
})

check('generation promotion between rank and details rejects old G', async () => {
  ready()
  const original = await portfolio.ensurePortfolioBaseCalculation(parameters(db, client(db)))
  let promoted = false
  const admin = client(db, name => {
    if (name === 'read_collection_queue_projection_details' && !promoted) {
      promoted = true
      ready()
    }
  })
  const result = await fastQueue.readCollectionQueueProjection({ admin, userId: db.user,
    tenantId: 'tenant-a', evaluationInstant: new Date('2026-10-01T12:00:00Z'),
    overdueOnly: true, limit: 2, legacyTodayDateIso: '2026-10-01' })
  assert.equal(promoted, true)
  assert.notEqual(result.version.accountingGenerationId, original.identity.generationId)
  assert.equal(result.version.accountingGenerationId, db.head().generationId)
})

check('a corrupted derivative is a miss and bounded ensure recovers from current authority', async () => {
  ready()
  const original = await portfolio.ensurePortfolioBaseCalculation(parameters(db, client(db)))
  db.psql("delete from public.collection_portfolio_base_scores where customer_source_id='c2';")
  const admin = client(db)
  const result = await fastQueue.readCollectionQueueProjection({ admin, userId: db.user,
    tenantId: 'tenant-a', evaluationInstant: new Date('2026-10-01T12:00:00Z'),
    overdueOnly: true, limit: 2, legacyTodayDateIso: '2026-10-01' })
  assert.notEqual(result.version.financialCalculationId, original.calculationId)
  assert.equal(result.metrics.calculationRebuilt, true)
  assert.equal(result.rows.length, 2)
})
