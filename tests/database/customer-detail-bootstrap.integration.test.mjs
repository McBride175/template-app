import assert from 'node:assert/strict'
import test, { before, after, beforeEach } from 'node:test'
import * as db from './test-helpers/dependency-database-fixture.mjs'
import { databaseClient, params, server as features, cert } from './test-helpers/materialization-client.mjs'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const detailService = loadTypeScriptModule('lib/collections/customer-detail-bootstrap-server.ts')

const enabled = process.env.RUN_SUPABASE_INTEGRATION === '1'
const check = (name, run) => test(name, { skip: !enabled }, run)
before(() => { if (enabled) db.setup() })
after(() => { if (enabled) db.cleanup() })
beforeEach(() => { if (enabled) db.reset() })
const today = () => new Date().toISOString().slice(0, 10)
const read = (customer = 'c1', user = db.user, tenant = 'tenant-a') => JSON.parse(db.rpc(
  `select public.read_collection_customer_detail_bootstrap('${user}',${db.quote(tenant)},${db.quote(customer)},'${today()}');`))

check('warm targeted detail uses one scoped snapshot with a certified feature and current invoice', async () => {
  const run = db.ready({ invoiceChanges: { due_date: '2026-09-01', issue_date: '2026-08-01' } })
  cert(db, run.run)
  const admin = databaseClient(db)
  await features.ensureCustomerFinancialFeatures({ ...params(db, admin, `${today()}T12:00:00Z`), customerSourceId: 'c1' })
  const result = read()
  assert.equal(result.ready, true)
  assert.equal(result.context.generationId, run.run)
  assert.equal(result.feature.result.rows[0].gross_outstanding_base_decimal, '9000')
  assert.equal(result.invoices.length, 1)
  assert.equal(result.invoices[0].source_id, 'i1')
  assert.equal(result.invoices[0].amount_due_native, '9000')
  assert.deepEqual(result.disputes, [])
  assert.deepEqual(result.promises, [])
  assert.deepEqual(result.currencyPopulation, { relevantInvoiceCount: 1, invoicedCurrencies: ['GBP'] })
})

check('dispute changes invalidate only the selected feature while returning current invoice overlay', async () => {
  const run = db.ready(); cert(db, run.run)
  await features.ensureCustomerFinancialFeatures({ ...params(db, databaseClient(db), `${today()}T12:00:00Z`), customerSourceId: 'c1' })
  const before = read()
  db.dispute('i1', 2000)
  const stale = read()
  assert.equal(stale.ready, false)
  assert.equal(stale.invoices.length, 1)
  assert.equal(stale.disputes.length, 1)
  assert.notEqual(stale.customerRevision, before.customerRevision)
  await features.ensureCustomerFinancialFeatures({ ...params(db, databaseClient(db), `${today()}T12:00:00Z`), customerSourceId: 'c1' })
  const current = read()
  assert.equal(current.ready, true)
  assert.equal(current.feature.result.rows[0].effective_disputed_outstanding_base_decimal, '2000')
  assert.equal(current.invoices[0].amount_due_native, '9000')
})

check('priority changes P and current override without invalidating customer financial feature', async () => {
  const run = db.ready(); cert(db, run.run)
  await features.ensureCustomerFinancialFeatures({ ...params(db, databaseClient(db), `${today()}T12:00:00Z`), customerSourceId: 'c1' })
  const before = read()
  db.psql(db.override())
  const after = read()
  assert.equal(after.ready, true)
  assert.equal(after.context.financialEpoch, before.context.financialEpoch)
  assert.equal(after.customerRevision, before.customerRevision)
  assert.equal(after.overrideLevel, 'priority')
  assert.equal(BigInt(after.projectionRevision), BigInt(before.projectionRevision) + 1n)
})

check('new generation cannot serve previous feature or historical invoices', async () => {
  const first = db.ready(); cert(db, first.run)
  await features.ensureCustomerFinancialFeatures({ ...params(db, databaseClient(db), `${today()}T12:00:00Z`), customerSourceId: 'c1' })
  const previous = read()
  const second = db.ready({ invoiceChanges: { amount_due_native: '5000', amount_due_base: '5000' } })
  const switched = read()
  assert.notEqual(second.run, first.run)
  assert.notEqual(switched.context.generationId, previous.context.generationId)
  assert.equal(switched.ready, false)
  assert.equal(switched.invoices[0].amount_due_native, '5000')
})

check('scope and grants prevent cross-tenant/customer projection', async () => {
  db.ready()
  assert.equal(read('c1', db.other).ready, false)
  assert.equal(read('c1', db.user, 'tenant-b').ready, false)
  assert.deepEqual(read('not-a-customer').invoices, [])
  for (const role of ['anon', 'authenticated']) {
    assert.throws(() => db.psql(`set role ${role};select public.read_collection_customer_detail_bootstrap('${db.user}','tenant-a','c1','${today()}');`), /permission denied/)
  }
})

check('detail service retries when P changes between its snapshot and final dependency fence', async () => {
  const run = db.ready(); cert(db, run.run)
  await features.ensureCustomerFinancialFeatures({ ...params(db, databaseClient(db), `${today()}T12:00:00Z`), customerSourceId: 'c1' })
  let changed = false
  const admin = databaseClient(db, async name => {
    if (name === 'read_collection_dependencies' && !changed) {
      changed = true
      db.psql(db.override())
    }
  })
  const result = await detailService.readCustomerDetailBootstrap({ admin, userId: db.user,
    tenantId: 'tenant-a', customerSourceId: 'c1', evaluationInstant: new Date() })
  assert.equal(changed, true)
  assert.equal(result.row.override_level, 'priority')
  assert.equal(result.version.projectionRevision, db.head().projectionRevision)
  assert.equal(admin.calls.filter(call => call.name === 'read_collection_customer_detail_bootstrap').length, 2)
  assert.equal(admin.calls.filter(call => call.name === 'read_collection_dependencies').length, 2)
})

check('cold targeted detail rebuilds only its customer feature and becomes a warm hit', async () => {
  const run = db.ready(); cert(db, run.run)
  const admin = databaseClient(db)
  const request = { admin, userId: db.user, tenantId: 'tenant-a',
    customerSourceId: 'c1', evaluationInstant: new Date() }
  const cold = await detailService.readCustomerDetailBootstrap(request)
  assert.equal(cold.version.generationId, run.run)
  assert.equal(cold.metrics.featureRebuilt, true)
  assert.equal(cold.row.customer_source_id, 'c1')
  const before = admin.calls.length
  const warm = await detailService.readCustomerDetailBootstrap(request)
  assert.equal(warm.metrics.featureRebuilt, false)
  assert.equal(warm.metrics.roundTrips, 2)
  assert.deepEqual(admin.calls.slice(before).map(call => call.name), [
    'read_collection_customer_detail_bootstrap', 'read_collection_dependencies',
  ])
  assert.deepEqual(warm.invoices, cold.invoices)
})

check('financial revision and F race cannot return a stale customer amount', async () => {
  const run = db.ready(); cert(db, run.run)
  await features.ensureCustomerFinancialFeatures({ ...params(db, databaseClient(db), `${today()}T12:00:00Z`), customerSourceId: 'c1' })
  let changed = false
  const admin = databaseClient(db, async name => {
    if (name === 'read_collection_dependencies' && !changed) {
      changed = true
      db.dispute('i1', 2000)
    }
  })
  const result = await detailService.readCustomerDetailBootstrap({ admin, userId: db.user,
    tenantId: 'tenant-a', customerSourceId: 'c1', evaluationInstant: new Date() })
  assert.equal(result.row.effective_disputed_outstanding_base_decimal, '2000')
  assert.equal(result.version.financialEpoch, db.head().financialEpoch)
  assert.equal(result.version.customerRevision, db.head().customerFinancialRevision)
})

check('generation promotion during detail read retries on new G without historical invoices', async () => {
  const run = db.ready(); cert(db, run.run)
  await features.ensureCustomerFinancialFeatures({ ...params(db, databaseClient(db), `${today()}T12:00:00Z`), customerSourceId: 'c1' })
  let promoted = null
  const admin = databaseClient(db, async name => {
    if (name === 'read_collection_dependencies' && promoted === null) {
      promoted = db.ready({ invoiceChanges: { amount_due_native: '5000', amount_due_base: '5000' } })
      cert(db, promoted.run)
    }
  })
  const result = await detailService.readCustomerDetailBootstrap({ admin, userId: db.user,
    tenantId: 'tenant-a', customerSourceId: 'c1', evaluationInstant: new Date() })
  assert.equal(result.version.generationId, promoted.run)
  assert.equal(result.invoices[0].currentAmountDueNative, '5000')
  assert.equal(result.row.gross_outstanding_base_decimal, '5000')
})
