import assert from 'node:assert/strict'
import { createDisputesJourney, journeyInvoice, daysAgo, USER_ID, TENANT_ID } from './disputes-journey-fixture.mjs'
import { loadTypeScriptModule } from './legacy-collection-access-mock.mjs'
import { observation } from './promise-evidence-fixture.mjs'

export const owner = { user_id: USER_ID, tenant_id: TENANT_ID, source_system: 'xero' }
export const invoice = (id, customer, amount, age, extra = {}) => journeyInvoice(id, customer, amount, { due_date: daysAgo(age), ...extra })
export const paidHistory = (customer, late = 10) => [0, 1, 2].map(i => invoice(`${customer}-paid-${i}`, customer, '0', 40 + late,
  { status: 'PAID', total_native: '100', amount_paid_native: '100', fully_paid_date: daysAgo(40) }))
const { isEligibleActiveQueueRow } = loadTypeScriptModule('lib/collections/queue-eligibility.ts')
const { qualifyPromisePayments } = loadTypeScriptModule('lib/collections/promise-payment-qualification.ts')
const { resolvePromiseOutcome } = loadTypeScriptModule('lib/collections/promise-outcome-resolution.ts')
export const scoreFields = ['exposure_score', 'urgency_score', 'relative_lateness_score', 'payment_recency_score', 'base_score', 'final_score']
export const moneyFields = ['gross_outstanding_base_decimal', 'effective_disputed_outstanding_base_decimal',
  'active_promised_outstanding_base_decimal', 'invoice_to_chase_overdue_base_decimal',
  'available_customer_credit_base_decimal', 'customer_to_chase_overdue_base_decimal']

export function interactionJourney(invoices = [invoice('old', 'acme', '900', 60), invoice('young', 'acme', '100', 10),
  invoice('b', 'baker', '600', 30), invoice('c', 'cedar', '300', 15), ...paidHistory('acme')]) {
  const observed = []
  const app = createDisputesJourney({ invoices, observeScoring: (row, context, override, result) => observed.push({ row, context, override, result }) })
  const mocks = {
    '@/lib/supabase-server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) } }) },
    '@/lib/supabase-admin': { createSupabaseAdminClient: () => app.admin },
    '@/lib/billing/entitlements': { claimActionsEntitlementStatus: async () => ({ tenantId: TENANT_ID, hasActionsAccess: true }) },
  }
  const { planPromiseMutation } = loadTypeScriptModule('lib/collections/invoice-promises-server.ts', { mocks })
  const actionHistory = loadTypeScriptModule('lib/collections/action-history-server.ts', { mocks })
  const generation = () => app.tables.xero_sync_tenant_state[0].active_sync_run_id
  const currentInvoice = id => app.tables.canonical_invoices.find(row => row.sync_run_id === generation() && row.source_id === id && row.user_id === USER_ID && row.tenant_id === TENANT_ID && row.source_system === 'xero')
  app.tables.invoice_promise_events = []
  const payments = []
  let sequence = 0
  function evidence() {
    const rows = payments.map(row => ({ ...row, sync_run_id: generation() }))
    return { rows, observation: observation(rows, [], { ...owner, sync_run_id: generation(),
      timezone_iana: 'UTC', started: new Date().toISOString(), completed: new Date().toISOString() }) }
  }
  function credit(amount = '0', customer = 'acme') {
    const run = generation()
    app.tables.xero_customer_credit_validations = [{ ...owner, sync_run_id: run,
      contract_version: 'customer_credit_v1', invoice_money_contract_version: 'invoice_exact_v1', readiness_state: 'ready',
      reason_code: 'stable_observation', consistency_result: 'matched', resource_observations: { initial: {
        overpayments: { count: 0 }, prepayments: { count: 0 }, creditnotes: { count: amount === '0' ? 0 : 1 } } } }]
    app.tables.canonical_customer_credit_evidence_exact = amount === '0' ? [] : [{ ...owner, sync_run_id: run,
      source_kind: 'credit_note', source_id: 'credit', customer_source_id: customer, provider_type: 'ACCRECCREDIT',
      status: 'AUTHORISED', residual_state: 'qualifying', remaining_credit_native: amount, currency_code: 'GBP',
      organisation_base_currency_code: 'GBP', xero_currency_rate: '1' }]
  }
  credit()
  function event(row, type) {
    app.tables.invoice_promise_events.push({ ...owner, id: `event-${++sequence}`, promise_id: row.id,
      event_type: type, occurred_at: new Date().toISOString(), after_terms: structuredClone(row) })
  }
  // Emulate persistence only. Production server planning and pure evidence
  // qualification/resolution determine terms and lifecycle; SQL suites separately
  // prove the actual atomic commands/promotion. This is not an RPC implementation.
  function promiseCommand(intent) {
    const row = intent.promiseId ? app.tables.invoice_promises.find(row => row.id === intent.promiseId) : null
    const inv = currentInvoice(intent.invoiceSourceId ?? row.invoice_source_id)
    const e = evidence()
    const plan = planPromiseMutation({ sync_run_id: generation(), invoice: inv, promise: row, observation: e.observation,
      payment_ids: payments.filter(p => p.invoice_source_id === inv.source_id).map(p => p.source_id),
      evidence: { payments: e.rows, cash: [] } }, intent, new Date().toISOString())
    let saved = row
    for (const step of plan.steps) {
      if (step.operation === 'create') {
        saved = { ...owner, ...step.payload, id: `promise-${++sequence}`, status: 'active', revision: '1',
          qualifying_paid_amount_native: '0', created_at: new Date().toISOString(), resolved_at: null }
        app.tables.invoice_promises.push(saved)
      } else {
        Object.assign(saved, step.payload, { revision: String(Number(saved.revision) + 1) })
        if (step.operation === 'cancel') saved.status = 'cancelled'
      }
      event(saved, step.operation)
    }
    if (plan.evaluation) Object.assign(saved, plan.evaluation)
    return saved
  }
  function reconcile(row) {
    const e = evidence(), inv = currentInvoice(row.invoice_source_id)
    const lifecycle = { ...row, revision: Number(row.revision) }
    const qualified = qualifyPromisePayments({ promise: lifecycle, observation: e.observation, payments: e.rows })
    const result = resolvePromiseOutcome({ promise: lifecycle, observation: e.observation, qualifiedPayments: qualified, cash: [],
      promiseValuation: { ...inv, invoice_source_id: inv.source_id, currency_code: 'GBP', sync_run_id: generation() } })
    assert.equal(result.payment_evaluation_valid, true, result.reason_code)
    row.qualifying_paid_amount_native = result.qualifying_paid_amount_native
    if (result.transition_required) { row.status = result.decision; event(row, result.decision) }
    return result
  }
  function pay(id, due, amount, availableCredit = '0', paymentDate = daysAgo(0)) {
    const inv = currentInvoice(id)
    const paid = { ...owner, source_id: `payment-${++sequence}`, invoice_source_id: id, customer_source_id: inv.customer_source_id,
      amount_native: amount, currency_code: 'GBP', payment_date: paymentDate, payment_type: 'ACCRECPAYMENT', payment_status: 'AUTHORISED' }
    payments.push(paid)
    app.promote({ [id]: { amount_due_native: due, amount_due_base: due,
      amount_paid_native: String(Number(inv.amount_paid_native) + Number(amount)), status: due === '0' ? 'PAID' : 'AUTHORISED',
      fully_paid_date: due === '0' ? daysAgo(0) : null } })
    app.tables.canonical_payments.push({ ...paid, sync_run_id: generation() })
    credit(availableCredit)
    for (const row of app.tables.invoice_promises.filter(p => p.status === 'active')) reconcile(row)
  }
  async function read(customer = 'acme') {
    const customers = await app.customers()
    assert.equal(customers.status, 200, JSON.stringify(customers.body))
    const invoices = await app.invoices(customer)
    assert.equal(invoices.status, 200, JSON.stringify(invoices.body))
    observed.length = 0
    const queue = await app.actions('overdueOnly=true')
    assert.equal(queue.status, 200, JSON.stringify(queue.body))
    return { customer: customers.body.rows.find(row => row.customer_source_id === customer), customers: customers.body.rows,
      invoices: invoices.body.invoices, queue: queue.body, observed: structuredClone(observed),
      active: queue.body.rows.filter(row => isEligibleActiveQueueRow(row, queue.body.actionsTakenByCustomerId)).map(row => row.customer_source_id) }
  }
  async function dispute(operation, amount, id = 'old') {
    const row = app.tables.invoice_disputes.find(d => d.invoice_source_id === id && d.user_id === USER_ID && d.tenant_id === TENANT_ID && d.source_system === 'xero')
    const result = await app.mutate({ operation, ...(operation === 'partial' || operation === 'full' ? { invoiceSourceId: id } : { disputeId: row.id }),
      ...(row ? { expected_revision: String(row.revision) } : {}), ...(amount ? { disputedAmountNative: amount } : {}) })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    return result.body.dispute
  }
  return { ...app, credit, read, dispute, promiseCommand, reconcile, pay, actionHistory, currentInvoice, generation }
}

export function close(actual, expected, label = '') {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= 8 * Number.EPSILON * Math.max(1, Math.abs(expected)), `${label}: ${actual} != ${expected}`)
}
