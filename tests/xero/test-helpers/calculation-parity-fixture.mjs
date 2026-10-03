import { mock } from 'node:test'
import { createDisputesJourney, journeyInvoice, USER_ID, TENANT_ID } from './disputes-journey-fixture.mjs'
import { loadTypeScriptModule } from './ts-module-loader.mjs'

export const REFERENCE_SHA = '806b5420a87749665d9de28957970275c54924f8'
export const EVALUATION_INSTANT = '2026-10-01T12:00:00Z'
const owner = { user_id: USER_ID, tenant_id: TENANT_ID, source_system: 'xero' }
export function dateBefore(days, date = '2026-10-01') {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10)
}
export function invoice(id, customer, amount, age, extra = {}) {
  return journeyInvoice(id, customer, amount, {
    issue_date: '2026-01-01', due_date: dateBefore(age), ...extra,
  })
}
export function history(customer, observations = [0, 5, 10]) {
  return observations.map((late, i) => invoice(`${customer}-paid-${i}`, customer, '0', 40 + late, {
    status: 'PAID', fully_paid_date: dateBefore(40), total_native: '100', amount_paid_native: '100',
  }))
}
export function basicInvoices() {
  return [invoice('a-old', 'acme', '900', 60), invoice('a-young', 'acme', '100', 10),
    invoice('b', 'baker', '500', 30), invoice('c', 'cedar', '200', 5),
    ...history('acme'), ...history('baker', [10, 15, 20])]
}
export function dispute(amount = '200', extra = {}) {
  return { ...owner, id: 'dispute-a', invoice_source_id: 'a-old', dispute_mode: 'partial',
    recorded_disputed_amount_native: amount, amount_due_at_last_review_native: '900',
    is_active: true, resolved_at: null, revision: 1, note: null, ...extra }
}
export function promise(amount = '200', extra = {}) {
  return { ...owner, id: 'promise-a', invoice_source_id: 'a-old', customer_source_id: 'acme',
    currency_code: 'GBP', promised_amount_native: amount, qualifying_paid_amount_native: '0',
    status: 'active', promised_date: '2026-10-08', revision: '1', note: null, ...extra }
}
export function credit(kind, amount, extra = {}) {
  return { ...owner, sync_run_id: 'generation-1', source_kind: kind, source_id: `${kind}-1`,
    customer_source_id: 'acme', provider_type: {
      overpayment: 'RECEIVE-OVERPAYMENT', prepayment: 'RECEIVE-PREPAYMENT', credit_note: 'ACCRECCREDIT',
    }[kind], status: 'AUTHORISED', residual_state: amount === '0' ? 'zero' : 'qualifying',
    remaining_credit_native: amount, currency_code: 'GBP', organisation_base_currency_code: 'GBP',
    xero_currency_rate: '1', ...extra }
}
export function certify(app, rows = [], extra = {}) {
  const count = kind => rows.filter(row => row.source_kind === kind).length
  app.tables.xero_customer_credit_validations = [{ ...owner, sync_run_id: 'generation-1',
    contract_version: 'customer_credit_v1', invoice_money_contract_version: 'invoice_exact_v1',
    readiness_state: 'ready', reason_code: 'stable_observation', consistency_result: 'matched',
    resource_observations: { initial: { overpayments: { count: count('overpayment') },
      prepayments: { count: count('prepayment') }, creditnotes: { count: count('credit_note') } } }, ...extra }]
  app.tables.canonical_customer_credit_evidence_exact = rows
}
export function action(customer = 'acme', extra = {}) {
  return { ...owner, id: 'action-a', customer_source_id: customer, action_type: 'outcome',
    outcome: 'message_sent', note: null, action_timestamp: '2026-10-01T10:00:00Z',
    next_action_date: '2026-10-02', ...extra }
}

// Inputs describe domain state, not commands or a replacement lifecycle resolver.
export const scenarios = [
  { name: 'basic' },
  ...['safe', 'normal', 'priority', 'do_not_chase'].map(level => ({ name: `override-${level}`, overrides: [['acme', level]] })),
  { name: 'dispute-partial', disputes: [dispute()] },
  { name: 'dispute-full', disputes: [dispute('900', { dispute_mode: 'full' })] },
  { name: 'dispute-resolved', disputes: [dispute('200', { is_active: false, resolved_at: EVALUATION_INSTANT })] },
  { name: 'dispute-reactivated', disputes: [dispute('200', { revision: 3 })] },
  { name: 'dispute-note', disputes: [dispute('200', { note: 'Different note', revision: 2 })] },
  { name: 'dispute-needs-review', disputes: [dispute('200', { amount_due_at_last_review_native: '1000' })] },
  { name: 'dispute-confirmed', disputes: [dispute('200', { revision: 2 })] },
  { name: 'zero-after-dispute', disputes: [dispute('900', { dispute_mode: 'full' }), dispute('100', {
    id: 'dispute-young', invoice_source_id: 'a-young', dispute_mode: 'full', amount_due_at_last_review_native: '100',
  })] },
  { name: 'promise-partial', promises: [promise()] },
  { name: 'promise-full', promises: [promise('900')] },
  { name: 'promise-amount', promises: [promise('400')] },
  { name: 'promise-date-only', promises: [promise('200', { promised_date: '2026-09-01' })] },
  { name: 'promise-note-only', promises: [promise('200', { note: 'Different note', revision: '2' })] },
  { name: 'promise-qualified-payment', promises: [promise('500', { qualifying_paid_amount_native: '300' })] },
  ...['cancelled', 'kept', 'missed', 'unclear'].map(status => ({ name: `promise-${status}`, promises: [promise('200', { status })] })),
  ...['overpayment', 'prepayment', 'credit_note'].map(kind => ({ name: `credit-${kind}`, credits: [credit(kind, '300')] })),
  { name: 'credit-combined', credits: [credit('overpayment', '100'), credit('prepayment', '200'), credit('credit_note', '300')] },
  { name: 'credit-zero-debt', credits: [credit('credit_note', '1000')] },
  { name: 'credit-excess', credits: [credit('credit_note', '1500')] },
  { name: 'credit-ready-zero', credits: [credit('credit_note', '0')] },
  { name: 'credit-uncertified', credits: [credit('credit_note', '300')], certificate: { readiness_state: 'unavailable', reason_code: 'verification_incomplete' } },
  { name: 'credit-incomplete', credits: [credit('credit_note', '300')], certificate: {
    resource_observations: { initial: { overpayments: { count: 0 }, prepayments: { count: 0 }, creditnotes: { count: 2 } } },
  } },
  { name: 'credit-no-certificate', noCertificate: true },
  { name: 'dispute-promise-credit', disputes: [dispute()], promises: [promise('300')], credits: [credit('credit_note', '150')] },
  { name: 'exact-fractional', invoices: [invoice('a-old', 'acme', '1000000000000000.123456789012345678901', 30)],
    disputes: [dispute('0.1')], promises: [promise('0.02')], credits: [credit('credit_note', '1000000000000000.0034567890123456789')] },
  { name: 'recent-partial-payment', paymentDays: 7 },
  { name: 'recent-payment-no-partial', paymentDays: 7, paymentInvoice: 'acme-paid-0' },
  { name: 'no-recent-payment', paymentDays: 61 },
  ...[0, 1, 7, 8, 14, 15, 30, 31, 45, 46, 60, 61].map(days => ({ name: `recency-${days}`, paymentDays: days })),
  { name: 'insufficient-history', invoices: [invoice('a-old', 'acme', '100', 30), ...history('acme', [0, 5])] },
  { name: 'immaterial-deterioration', invoices: [invoice('a-old', 'acme', '100', 13), ...history('acme', [10, 10, 10])] },
  { name: 'material-deterioration', invoices: [invoice('a-old', 'acme', '100', 14), ...history('acme', [10, 10, 10])] },
  { name: 'percentile-portfolio', invoices: [10, 20, 30, 40, 60, 90].flatMap((age, i) =>
    [invoice(`i${i}`, `c${i}`, String((i + 1) * 100), age), ...history(`c${i}`, [0, 0, 0])]) },
  { name: 'percentile-anchor-changed', invoices: [10, 20, 30, 40, 60, 150].flatMap((age, i) =>
    [invoice(`i${i}`, `c${i}`, String((i + 1) * 100), age), ...history(`c${i}`, [0, 0, 0])]) },
  { name: 'exposure-maximum-changed', invoices: basicInvoices().map(row => row.source_id === 'b'
    ? { ...row, amount_due_native: '2000', amount_due_base: '2000', total_native: '2000' } : row) },
  { name: 'urgency-maximum-changed', invoices: basicInvoices().map(row => row.source_id === 'b'
    ? { ...row, due_date: dateBefore(120) } : row) },
  { name: 'urgency-mean-changed', invoices: basicInvoices().map(row => row.source_id === 'c'
    ? { ...row, due_date: dateBefore(20) } : row) },
  { name: 'action-record', actions: [action()] },
  { name: 'action-undo', actions: [] },
  { name: 'legacy-action-today', actions: [action('acme', { action_type: 'called', outcome: 'no_response', next_action_date: null })] },
  { name: 'legacy-postponed', actions: [action('acme', { action_type: 'postponed', outcome: null })] },
  { name: 'legacy-promise-not-suppressed', actions: [action('acme', { action_type: 'called', outcome: 'promised_to_pay', action_timestamp: '2026-09-30T10:00:00Z' })] },
  { name: 'recent-action-timestamp-tie', actions: [action('acme', { id: 'z-v1', next_action_date: '2026-10-01' }),
    action('acme', { id: 'a-legacy', action_type: 'called', outcome: 'no_response', next_action_date: null })] },
  { name: 'equal-score-name-tie', invoices: [invoice('z', 'zeta', '100', 30), invoice('a', 'alpha', '100', 30)] },
  { name: 'equal-score-exact-tie', invoices: [invoice('z', 'zeta', '100', 30), invoice('a', 'alpha', '100', 30)], sameNames: true },
  { name: 'adjusted-score-tie', invoices: [invoice('a-old', 'acme', '100', 30), invoice('b', 'baker', '100', 30)], overrides: [['acme', 'safe'], ['baker', 'safe']] },
  { name: 'limit-one', query: 'overdueOnly=true&limit=1' },
  { name: 'scope-all', query: 'overdueOnly=false', invoices: [...basicInvoices(), invoice('future', 'future', '5000', -5)] },
  { name: 'utc-rollover', instant: '2026-10-02T00:00:00Z' },
  ...['2026-10-01T23:59:59Z', '2026-10-02T00:00:00Z'].map((instant, i) => ({
    name: `utc-due-boundary-${i}`, instant, invoices: [invoice('a-old', 'acme', '100', 0)],
  })),
  ...['2026-10-01T12:00:00Z', '2026-10-02T00:00:00Z'].map((instant, i) => ({
    name: `historical-window-boundary-${i}`, instant, invoices: [invoice('a-old', 'acme', '100', 30),
      invoice('paid-cutoff', 'acme', '0', 190, { status: 'PAID', total_native: '100', amount_paid_native: '100', fully_paid_date: '2026-04-01', due_date: '2026-03-12' }),
      ...history('acme', [0, 10])],
  })),
  ...['2026-10-01T10:59:59Z', '2026-10-01T11:00:00Z'].map((instant, i) => ({
    name: `organisation-day-boundary-${i}`, instant, timezone: 'Pacific/Auckland', actions: [action()],
  })),
  ...['2026-10-01T10:59:59Z', '2026-10-01T11:00:00Z'].map((instant, i) => ({
    name: `mapped-organisation-day-boundary-${i}`, instant, timezone: 'NewZealandStandardTime',
    organisation: { country_code: 'NZ' }, actions: [action()],
  })),
  { name: 'valid-multi-currency', invoices: [...basicInvoices(), invoice('usd', 'foreign', '1000', 20, {
    transaction_currency_code: 'USD', xero_currency_rate: '2', amount_due_base: '500', currency_conversion_status: 'converted',
  })] },
  { name: 'credit-unsupported-currency', invoices: [invoice('a-old', 'acme', '1000', 20, {
    transaction_currency_code: 'USD', xero_currency_rate: '2', amount_due_base: '500', currency_conversion_status: 'converted',
  })], credits: [credit('credit_note', '100')] },
  { name: 'currency-rate-failure', invoices: [...basicInvoices(), invoice('bad', 'foreign', '100', 20, {
    transaction_currency_code: 'USD', xero_currency_rate: null, amount_due_base: null,
    currency_conversion_status: 'incomplete', currency_conversion_failure_reason: 'invalid_currency_rate',
  })] },
  { name: 'currency-covered-gross-null', invoices: [invoice('a-old', 'acme', '100', 20, {
    transaction_currency_code: 'USD', xero_currency_rate: null, amount_due_base: null,
    currency_conversion_status: 'incomplete', currency_conversion_failure_reason: 'invalid_currency_rate',
  })], disputes: [dispute('100', { dispute_mode: 'full' })], query: 'overdueOnly=false' },
  { name: 'currency-unavailable', organisation: { base_currency_code: null } },
  { name: 'no-invoices', invoices: [] },
  { name: 'no-qualifying-invoices', invoices: [invoice('a-old', 'acme', '100', 30, { type: 'ACCPAY' })] },
  { name: 'zero-overdue', invoices: [invoice('a-old', 'acme', '100', -5)] },
  { name: 'zero-to-chase', invoices: [invoice('a-old', 'acme', '0', 30)] },
  { name: 'null-amount', invoices: [invoice('a-old', 'acme', null, 30, { amount_due_native: null, amount_due_base: null })] },
  { name: 'invalid-promise-identity', promises: [promise('200', { currency_code: 'USD' })] },
]

export function buildJourney(scenario, observeScoring, paths = {}) {
  const app = createDisputesJourney({ invoices: scenario.invoices ?? basicInvoices(), observeScoring, paths })
  Object.assign(app.tables.canonical_organisations[0], { source_timezone: scenario.timezone ?? 'Europe/London', country_code: 'GB', ...scenario.organisation })
  if (scenario.sameNames) app.tables.canonical_customers.forEach(row => { row.name = 'Same name' })
  app.tables.invoice_disputes.push(...structuredClone(scenario.disputes ?? []))
  app.tables.invoice_promises.push(...structuredClone(scenario.promises ?? []))
  app.tables.collection_actions.push(...structuredClone(scenario.actions ?? []))
  for (const [id, level] of scenario.overrides ?? []) app.override(id, level)
  if (scenario.paymentDays !== undefined) app.tables.canonical_payments.push({ ...owner, source_id: 'payment-a',
    sync_run_id: 'generation-1', customer_source_id: 'acme', invoice_source_id: scenario.paymentInvoice ?? 'a-old',
    payment_date: dateBefore(scenario.paymentDays) })
  if (!scenario.noCertificate) certify(app, structuredClone(scenario.credits ?? []), scenario.certificate)
  return app
}

const { loadCustomerCollectionsSummaryWithMetadata } = loadTypeScriptModule('lib/collections/customer-summary.ts', {
  mocks: { '@/lib/supabase-server': {} },
})
export async function captureCurrent(scenario, paths = {}) {
  mock.timers.enable({ apis: ['Date'], now: new Date(scenario.instant ?? EVALUATION_INSTANT) })
  try {
    const observed = []
    const app = buildJourney(scenario, (row, context, override, result) => observed.push({ row, context, override, result }), paths)
    const loadSummary = paths.summary
      ? loadTypeScriptModule(paths.summary, { mocks: { '@/lib/supabase-server': {} } }).loadCustomerCollectionsSummaryWithMetadata
      : loadCustomerCollectionsSummaryWithMetadata
    let summary
    try { summary = await loadSummary(app.admin, USER_ID, TENANT_ID) }
    catch (error) { summary = { error: error.message } }
    const queue = await app.actions(scenario.query ?? 'overdueOnly=true')
    return JSON.parse(JSON.stringify({ summary, queue, observed, databaseCalls: app.calls }))
  } finally { mock.timers.reset() }
}

// Hold the real loader's validated inputs, then exercise the pure function separately.
// This keeps snapshot/certificate validation outside the calculation contract.
const features = loadTypeScriptModule('lib/collections/customer-features.ts')
export async function captureFeatureInput(scenario) {
  let input
  const loader = loadTypeScriptModule('lib/collections/customer-summary.ts', {
    mocks: {
      '@/lib/supabase-server': {},
      '@/lib/collections/customer-features': {
        ...features,
        calculateCustomerFinancialFeatures(value) {
          input = value
          return features.calculateCustomerFinancialFeatures(value)
        },
      },
    },
  })
  mock.timers.enable({ apis: ['Date'], now: new Date(scenario.instant ?? EVALUATION_INSTANT) })
  try {
    const app = buildJourney(scenario)
    try { await loader.loadCustomerCollectionsSummaryWithMetadata(app.admin, USER_ID, TENANT_ID) }
    catch (error) { if (!input) throw error }
    return input
  } finally { mock.timers.reset() }
}
