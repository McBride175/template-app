import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createDisputesJourney, createNoDisputeParityJourney, noDisputeParityProjection, daysAgo, journeyInvoice, TENANT_ID, USER_ID } from './test-helpers/disputes-journey-fixture.mjs'

async function views(app, customerId = 'acme') {
  const [customers, invoices, worklist, actions] = await Promise.all([
    app.customers(), app.invoices(customerId), app.worklist('status=all'), app.actions(),
  ])
  for (const response of [customers, invoices, worklist, actions]) assert.equal(response.status, 200)
  return { customer: customers.body.rows.find((row) => row.customer_source_id === customerId),
    invoices: invoices.body.invoices, worklist: worklist.body, queue: actions.body,
    priority: actions.body.rows.find((row) => row.customer_source_id === customerId) }
}

function amounts(state, gross, disputed, collectible) {
  assert.equal(state.customer.total_outstanding_base, gross)
  assert.equal(state.customer.effective_disputed_outstanding_base_decimal, String(disputed))
  assert.equal(state.customer.collectible_outstanding_base, collectible)
  if (state.priority) {
    assert.equal(state.priority.total_outstanding_base, gross)
    assert.equal(state.priority.collectible_outstanding_base, collectible)
  }
}

test('partial → full → resolve → reactivate reconciles persistence, customer, queue, first value and worklist', async () => {
  const app = createDisputesJourney()
  app.override('acme', 'priority')
  const initial = await views(app)
  assert.equal(initial.priority.override_multiplier, 1.6)
  assert.equal(app.firstValue(initial.queue)[0].customer_source_id, 'acme')
  const created = await app.mutate({ operation: 'partial', invoiceSourceId: 'a', disputedAmountNative: '3000', note: 'Check goods' })
  assert.equal(created.status, 200)
  assert.equal(created.body.dispute.revision, 1)
  const partial = await views(app)
  amounts(partial, 10000, 3000, 7000)
  assert.equal(partial.priority.actionable_overdue_invoices_count, 1)
  assert.equal(partial.queue.portfolio.totalOverdueBase, 17000)
  assert.equal(partial.queue.portfolio.largestCustomerOverdueBase, 8000)
  assert.match(JSON.stringify(partial.priority.first_value_reasons), /£7,000/)
  const row = partial.worklist.rows.find((row) => row.invoiceSourceId === 'a')
  assert.equal(row.needsReview, false)
  assert.equal(row.customerHref, `/customers?tenantId=${TENANT_ID}&customerSourceId=acme`)
  assert.equal(partial.invoices[0].revision, row.revision)
  assert.equal(row.currentAmountDueNative, '10000')
  assert.equal(row.effectiveDisputedAmountNative, '3000')
  assert.equal(row.collectibleAmountNative, '7000')
  assert.equal(row.note, 'Check goods')
  const full = await app.mutate({ operation: 'full', invoiceSourceId: 'a', expected_revision: row.revision })
  assert.equal(full.body.dispute.revision, 2)
  assert.equal(full.body.dispute.note, 'Check goods')
  const suppressed = await views(app)
  amounts(suppressed, 10000, 10000, 0)
  assert.equal(suppressed.priority, undefined)
  assert.equal(suppressed.customer.actionable_overdue_invoices_count, 0)
  assert.equal(suppressed.worklist.rows.find((item) => item.disputeId === row.disputeId).collectibleAmountNative, '0')
  assert.ok(app.firstValue(suppressed.queue).every((item) => item.customer_source_id !== 'acme'))
  const resolved = await app.mutate({ operation: 'resolve', disputeId: row.disputeId, expected_revision: '2' })
  assert.equal(resolved.body.dispute.revision, 3)
  const restored = await views(app)
  amounts(restored, 10000, 0, 10000)
  assert.equal(restored.priority.weighted_avg_overdue_days, initial.priority.weighted_avg_overdue_days)
  assert.equal(restored.priority.final_score, initial.priority.final_score)
  assert.equal((await app.worklist()).body.total, 0)
  assert.equal((await app.worklist('status=resolved')).body.total, 1)
  const reactivated = await app.mutate({ operation: 'reactivate', disputeId: row.disputeId, expected_revision: '3' })
  assert.equal(reactivated.body.dispute.id, row.disputeId)
  assert.equal(reactivated.body.dispute.revision, 4)
  assert.equal(app.tables.invoice_disputes.length, 1)
  assert.equal((await views(app)).priority, undefined)
})

test('promoted balance changes retain recorded debt; note, review, settlement and unavailable states stay distinct', async () => {
  const app = createDisputesJourney()
  const created = (await app.mutate({ operation: 'partial', invoiceSourceId: 'a', disputedAmountNative: '4000' })).body.dispute
  app.promote({ a: { amount_due_native: '2000', amount_due_base: '2000' } })
  const reduced = await views(app)
  amounts(reduced, 2000, 2000, 0)
  assert.equal(reduced.priority, undefined)
  const review = (await app.worklist('status=needs_review&customer=acme&q=INV-a')).body.rows[0]
  assert.equal(review.disputeId, created.id)
  assert.equal(review.recordedDisputedAmountNative, '4000')
  const note = await app.mutate({ operation: 'note', disputeId: created.id, expected_revision: '1', note: 'Reviewed note only' })
  assert.equal(note.body.dispute.amount_due_at_last_review_native, '10000')
  assert.equal((await app.worklist('status=needs_review')).body.total, 1)
  const confirmed = await app.mutate({ operation: 'confirm', disputeId: created.id, expected_revision: '2' })
  assert.equal(confirmed.body.dispute.revision, 3)
  assert.equal(confirmed.body.dispute.recorded_disputed_amount_native, '4000')
  assert.equal(confirmed.body.dispute.note, 'Reviewed note only')
  assert.equal((await app.worklist('status=needs_review')).body.total, 0)
  app.promote({ a: { status: 'PAID', amount_due_native: '0', amount_due_base: '0', amount_paid_native: '10000', fully_paid_date: daysAgo(0) } })
  const settled = (await app.worklist('status=settled')).body.rows[0]
  assert.equal(settled.isActive, true)
  assert.equal(settled.isResolved, false)
  assert.equal(settled.effectiveDisputedAmountNative, '0')
  assert.equal(settled.collectibleAmountNative, '0')
  assert.equal(app.tables.invoice_disputes[0].revision, 3)
  assert.equal((await app.worklist('status=resolved')).body.total, 0)
  const accountingQueue = (await app.actions()).body
  const settledCustomer = accountingQueue.rows.find((row) => row.customer_source_id === 'acme')
  assert.equal(settledCustomer.recommended_action, 'No action')
  assert.equal(settledCustomer.collectible_outstanding_base, 0)
  assert.ok(app.firstValue(accountingQueue).every((row) => row.customer_source_id !== 'acme'))
  assert.ok((await app.actions('overdueOnly=true')).body.rows.every((row) => row.customer_source_id !== 'acme'))
  app.promote({ a: { status: 'AUTHORISED', amount_due_native: '8000', amount_due_base: '8000' } })
  const reopened = await views(app)
  amounts(reopened, 8000, 4000, 4000)
  assert.equal((await app.worklist('status=needs_review')).body.total, 1)
  app.promote({}, ['a'])
  const missing = (await app.worklist('status=unavailable&customer=acme&q=REF-a')).body.rows[0]
  assert.equal(missing.disputeId, created.id)
  assert.equal(missing.contextFromPreviousSnapshot, true)
  assert.equal(missing.isOperationallySettled, false)
  assert.equal(missing.needsReview, false)
  assert.equal(missing.currentAmountDueNative, null)
  assert.equal(missing.effectiveDisputedAmountNative, null)
  assert.equal(missing.collectibleAmountNative, null)
  assert.equal(missing.recordedDisputedAmountNative, '4000')
  assert.equal((await app.mutate({ operation: 'full', invoiceSourceId: 'a', expected_revision: '3' })).status, 404)
  assert.equal((await app.mutate({ operation: 'resolve', disputeId: created.id, expected_revision: '3' })).status, 200)
  const resolvedMissing = (await app.worklist('status=resolved')).body.rows[0]
  assert.equal(resolvedMissing.invoiceState, 'unavailable')
  assert.equal(resolvedMissing.isResolved, true)
  assert.equal((await app.mutate({ operation: 'reactivate', disputeId: created.id, expected_revision: '4' })).status, 404)
})

test('dynamic full suppression follows successive authoritative generations without changing historical payment evidence', async () => {
  const history = journeyInvoice('paid', 'acme', 0, { status: 'PAID', due_date: daysAgo(60), fully_paid_date: daysAgo(45), total_native: '1000', amount_paid_native: '1000' })
  const app = createDisputesJourney({ invoices: [journeyInvoice('a', 'acme', 10000), journeyInvoice('b', 'baker', 8000), history] })
  app.tables.canonical_payments.push({ user_id: USER_ID, tenant_id: TENANT_ID, source_system: 'xero',
    sync_run_id: 'generation-1', invoice_source_id: 'paid', customer_source_id: 'acme', payment_date: daysAgo(45) })
  const before = await views(app)
  await app.mutate({ operation: 'full', invoiceSourceId: 'a' })
  for (const amount of ['12000', '8000']) {
    app.promote({ a: { amount_due_native: amount, amount_due_base: amount } })
    const state = await views(app)
    amounts(state, Number(amount), Number(amount), 0)
    assert.equal(state.customer.historical_paid_invoice_count, before.customer.historical_paid_invoice_count)
    assert.equal(state.customer.historical_normal_days_late, before.customer.historical_normal_days_late)
    assert.equal(state.customer.last_payment_days_ago, before.customer.last_payment_days_ago)
    const row = (await app.worklist('status=needs_review')).body.rows[0]
    assert.equal(row.recordedDisputedAmountNative, '10000')
    assert.equal(row.effectiveDisputedAmountNative, amount)
    assert.equal(row.collectibleAmountNative, '0')
    assert.equal(row.revision, '1')
  }
})

test('selected bulk preserves mixed-customer debt and notes; future invoices remain collectible; Do Not Chase stays separate', async () => {
  const app = createDisputesJourney({ invoices: [journeyInvoice('a', 'acme', 5000),
    journeyInvoice('a2', 'acme', 3000), journeyInvoice('a3', 'acme', 8000), journeyInvoice('b', 'baker', 2000)] })
  const partial = (await app.mutate({ operation: 'partial', invoiceSourceId: 'a', disputedAmountNative: '1000', note: 'Keep me' })).body.dispute
  const bulk = await app.mutate({ operation: 'bulk_full', customerSourceId: 'acme',
    invoiceSourceIds: ['a', 'a2'], expectedRevisions: [{ invoiceSourceId: 'a', revision: String(partial.revision) }] })
  assert.equal(bulk.status, 200)
  assert.equal(app.tables.invoice_disputes.length, 2)
  assert.equal(app.tables.invoice_disputes.find((row) => row.invoice_source_id === 'a').note, 'Keep me')
  const mixed = await views(app)
  amounts(mixed, 16000, 8000, 8000)
  assert.equal(mixed.priority.actionable_overdue_invoices_count, 1)
  assert.equal(mixed.worklist.total, 2)
  app.promote({}, [], [journeyInvoice('future', 'acme', 6000)])
  const future = await views(app)
  amounts(future, 22000, 8000, 14000)
  assert.equal(future.invoices.find((row) => row.invoiceSourceId === 'future').disputeId, null)
  assert.equal(future.priority.actionable_overdue_invoices_count, 2)
  app.override('acme', 'do_not_chase')
  const held = await views(app)
  amounts(held, 22000, 8000, 14000)
  assert.equal(held.priority.override_multiplier, 0)
  assert.equal(held.priority.final_score, 0)
  assert.ok(app.firstValue(held.queue).every((row) => row.customer_source_id !== 'acme'))
  const before = structuredClone(app.tables.invoice_disputes)
  const injected = await app.mutate({ operation: 'bulk_full', customerSourceId: 'acme',
    invoiceSourceIds: ['a3', 'b'], expectedRevisions: [] })
  assert.equal(injected.status, 404)
  assert.deepEqual(app.tables.invoice_disputes, before)
  const allCurrent = await app.mutate({ operation: 'bulk_full', customerSourceId: 'acme',
    expectedRevisions: before.map((row) => ({ invoiceSourceId: row.invoice_source_id, revision: String(row.revision) })) })
  assert.equal(allCurrent.status, 200)
  amounts(await views(app), 22000, 22000, 0)
  assert.equal(app.tables.invoice_disputes.length, 4)
  assert.ok(app.tables.invoice_disputes.every((row) => row.invoice_source_id !== 'b'))
})

test('stale accounting and dispute revisions make no writes and cannot reactivate a remote resolution', async () => {
  const app = createDisputesJourney()
  const dispute = (await app.mutate({ operation: 'partial', invoiceSourceId: 'a', disputedAmountNative: '3000' })).body.dispute
  const winner = structuredClone(app.tables.invoice_disputes)
  assert.equal((await app.mutate({ operation: 'full', invoiceSourceId: 'a' })).status, 409)
  assert.deepEqual(app.tables.invoice_disputes, winner, 'a second creation must not update the winning row')
  await app.mutate({ operation: 'note', disputeId: dispute.id, expected_revision: '1', note: 'New' })
  const before = structuredClone(app.tables.invoice_disputes)
  for (const operation of ['full', 'partial', 'note', 'resolve', 'confirm']) {
    const response = await app.mutate({ operation, invoiceSourceId: 'a', disputeId: dispute.id,
      expected_revision: '1', disputedAmountNative: '4000', note: 'Stale' })
    assert.equal(response.status, 409, operation)
    assert.deepEqual(app.tables.invoice_disputes, before)
  }
  await app.mutate({ operation: 'resolve', disputeId: dispute.id, expected_revision: '2' })
  assert.equal((await app.mutate({ operation: 'partial', invoiceSourceId: 'a', expected_revision: '2', disputedAmountNative: '4000' })).status, 409)
  assert.equal(app.tables.invoice_disputes[0].is_active, false)
  assert.equal((await app.mutate({ operation: 'reactivate', disputeId: dispute.id, expected_revision: '2' })).status, 409)
  assert.equal((await app.mutate({ operation: 'reactivate', disputeId: dispute.id, expected_revision: '3' })).status, 200)
  app.promote({ a: { amount_due_native: '3000', amount_due_base: '3000' } })
  const unchanged = structuredClone(app.tables.invoice_disputes)
  const staleAmount = await app.mutate({ operation: 'partial', invoiceSourceId: 'a', expected_revision: '4', disputedAmountNative: '4000' })
  assert.equal(staleAmount.status, 409)
  assert.equal(staleAmount.body.code, 'invalid_amount')
  assert.deepEqual(app.tables.invoice_disputes, unchanged)
  const full = await app.mutate({ operation: 'full', invoiceSourceId: 'a', expected_revision: '4', amountDue: '10000' })
  assert.equal(full.body.dispute.recorded_disputed_amount_native, '3000')
})

test('foreign FX suppression reconciles worklist and queue without bypassing gross currency entitlement or ownership', async () => {
  const app = createDisputesJourney({ invoices: [journeyInvoice('a', 'acme', 10000),
    journeyInvoice('usd', 'baker', 20000, { transaction_currency_code: 'USD', amount_due_base: '4000', xero_currency_rate: '5', currency_conversion_status: 'converted' }),
    journeyInvoice('bad', 'cedar', 50000, { transaction_currency_code: 'EUR', amount_due_base: null,
      currency_conversion_status: 'incomplete', currency_conversion_failure_reason: 'missing_rate' })] })
  const bad = (await app.mutate({ operation: 'full', invoiceSourceId: 'bad' })).body.dispute
  await app.mutate({ operation: 'partial', invoiceSourceId: 'a', disputedAmountNative: '3000' })
  await app.mutate({ operation: 'partial', invoiceSourceId: 'usd', disputedAmountNative: '10000' })
  const healthy = await app.actions()
  assert.equal(healthy.body.currencyHealth.status, 'healthy')
  const gross = (await app.customers()).body.rows.find((row) => row.customer_source_id === 'cedar')
  assert.equal(gross.total_outstanding_base, null)
  assert.equal(gross.native_currency_breakdown[0].total_outstanding_native, '50000')
  for (const [sort, expected] of [['amount_desc', ['a', 'usd', 'bad']], ['amount_asc', ['usd', 'a', 'bad']]]) {
    const list = (await app.worklist(`sort=${sort}`)).body.rows
    assert.deepEqual(list.map((row) => row.invoiceSourceId), expected)
    assert.equal(list.at(-1).effectiveDisputedBase, null)
    assert.equal(list.at(-1).currentAmountDueNative, '50000')
  }
  await app.mutate({ operation: 'partial', invoiceSourceId: 'bad', expected_revision: String(bad.revision), disputedAmountNative: '10000' })
  const degraded = (await app.actions()).body
  assert.equal(degraded.currencyHealth.status, 'degraded')
  assert.equal(degraded.reviewRequiredCustomers[0].native_currency_breakdown[0].total_outstanding_native, '50000')
  assert.ok(degraded.rows.every((row) => row.customer_source_id !== 'cedar'))
  app.setPlan('basic')
  assert.equal((await app.actions()).status, 402)
  assert.equal((await app.worklist()).status, 403)
  app.setPlan('pro')
  const foreign = { ...structuredClone(app.tables.invoice_disputes[0]), id: 'foreign-dispute',
    user_id: 'foreign-user', tenant_id: 'foreign-tenant', invoice_source_id: 'foreign-invoice', note: 'Foreign private note' }
  app.tables.invoice_disputes.push(foreign)
  app.tables.canonical_invoices.push(journeyInvoice('foreign-invoice', 'foreign-customer', 9000,
    { user_id: 'foreign-user', tenant_id: 'foreign-tenant' }))
  assert.equal((await app.worklist('status=all&q=Foreign')).body.total, 0)
  const foreignInvoices = await app.invoices('foreign-customer')
  assert.equal(foreignInvoices.status, 200)
  assert.deepEqual(foreignInvoices.body.invoices, [])
  for (const operation of ['full', 'partial', 'note', 'resolve', 'reactivate', 'confirm']) {
    const guessed = await app.mutate({ operation, invoiceSourceId: 'foreign-invoice',
      disputeId: foreign.id, expected_revision: '1', disputedAmountNative: '1000', note: 'Injected' })
    assert.equal(guessed.status, 404, operation)
  }
  const before = structuredClone(app.tables.invoice_disputes)
  for (const operation of ['note', 'resolve', 'reactivate', 'confirm', 'full', 'partial', 'bulk_full']) {
    const denied = await app.mutate({ operation, tenantId: 'other-tenant', disputeId: bad.id,
      invoiceSourceId: 'bad', customerSourceId: 'cedar', invoiceSourceIds: ['bad'],
      expected_revision: '2', expectedRevisions: [], disputedAmountNative: '1', note: 'Injected' })
    assert.equal(denied.status, 403, operation)
  }
  assert.deepEqual(app.tables.invoice_disputes, before)
  app.setUser('other-user')
  assert.equal((await app.worklist()).status, 403)
  assert.equal((await app.mutate({ operation: 'resolve', disputeId: bad.id, expected_revision: '2' })).status, 403)
})

test('no-dispute production output matches the frozen pre-dispute-scoring portfolio', async () => {
  const baseline = JSON.parse(await readFile(new URL('./fixtures/disputes-no-dispute-baseline.json', import.meta.url), 'utf8'))
  assert.equal(baseline.baselineCommit, 'b63de215141318f07ca30912500920b0c38d2318')
  const current = await noDisputeParityProjection(createNoDisputeParityJourney())
  assert.deepEqual(JSON.parse(JSON.stringify(current)), baseline.expected)
})
