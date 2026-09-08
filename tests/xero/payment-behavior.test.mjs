import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const PAYMENT_BEHAVIOR_PATH = new URL(
  '../../lib/collections/payment-behavior.ts',
  import.meta.url
)
const PAYMENT_BEHAVIOR_COPY_PATH = new URL(
  '../../lib/collections/payment-behavior-copy.ts',
  import.meta.url
)
const CUSTOMER_SUMMARY_CLIENT_PATH = new URL(
  '../../app/collections/customers/CustomerCollectionsClient.tsx',
  import.meta.url
)
const CUSTOMER_SUMMARY_PATH = new URL(
  '../../lib/collections/customer-summary.ts',
  import.meta.url
)

const EVALUATION_DATE = '2026-09-07'

const {
  calculateHistoricalDaysLate,
  calculateHistoricalPaymentBaseline,
  calculateHistoricalPaymentWindowCutoff,
  calculateRelativeLatenessDays,
  HISTORICAL_PAYMENT_WINDOW_MONTHS,
  isEligibleHistoricalPaymentInvoice,
  MINIMUM_HISTORICAL_PAYMENT_INVOICES,
} = loadTypeScriptModule(PAYMENT_BEHAVIOR_PATH)
const {
  formatHistoricalPaymentTiming,
  formatRelativeLateness,
} = loadTypeScriptModule(PAYMENT_BEHAVIOR_COPY_PATH)

function shiftIsoDate(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function invoiceSettledOn(fullyPaidDate, daysLate, overrides = {}) {
  const dueDate = shiftIsoDate(fullyPaidDate, -daysLate)

  return {
    type: 'ACCREC',
    status: 'PAID',
    due_date: dueDate,
    fully_paid_date: fullyPaidDate,
    total: 100,
    amount_paid: 100,
    amount_due: 0,
    amount_credited: 0,
    ...overrides,
  }
}

function invoiceWithDaysLate(daysLate, overrides = {}) {
  return invoiceSettledOn('2026-08-15', daysLate, overrides)
}

function calculateBaseline(invoices, evaluationDate = EVALUATION_DATE) {
  return calculateHistoricalPaymentBaseline(invoices, { evaluationDate })
}

test('uses the middle observation as the median for odd history', () => {
  const result = calculateBaseline([
    invoiceWithDaysLate(15),
    invoiceWithDaysLate(2),
    invoiceWithDaysLate(7),
  ])

  assert.deepEqual(result.daysLateObservations, [2, 7, 15])
  assert.equal(result.normalDaysLate, 7)
  assert.equal(result.meanDaysLate, 8)
})

test('averages the middle observations as the median for even history', () => {
  const result = calculateBaseline([
    invoiceWithDaysLate(10),
    invoiceWithDaysLate(1),
    invoiceWithDaysLate(8),
    invoiceWithDaysLate(3),
  ])

  assert.equal(result.normalDaysLate, 5.5)
  assert.equal(result.meanDaysLate, 5.5)
})

test('preserves a historically early-paying baseline', () => {
  const result = calculateBaseline([
    invoiceWithDaysLate(-4),
    invoiceWithDaysLate(-2),
    invoiceWithDaysLate(-1),
  ])

  assert.equal(result.normalDaysLate, -2)
  assert.equal(formatHistoricalPaymentTiming(result.normalDaysLate), '2 days before due date')
})

test('calculates a historically late-paying baseline', () => {
  const result = calculateBaseline([
    invoiceWithDaysLate(12),
    invoiceWithDaysLate(5),
    invoiceWithDaysLate(7),
  ])

  assert.equal(result.normalDaysLate, 7)
  assert.equal(formatHistoricalPaymentTiming(result.normalDaysLate), '7 days late')
})

test('does not infer normal timing from fewer than three usable observations', () => {
  const result = calculateBaseline([
    invoiceWithDaysLate(1),
    invoiceWithDaysLate(5),
  ])

  assert.equal(MINIMUM_HISTORICAL_PAYMENT_INVOICES, 3)
  assert.equal(result.usableInvoiceCount, 2)
  assert.equal(result.meanDaysLate, 3)
  assert.equal(result.normalDaysLate, null)
  assert.equal(calculateRelativeLatenessDays(12, result.normalDaysLate), null)
})

test('excludes VOIDED, invalid, open, and unsettled invoices', () => {
  const validInvoices = [
    invoiceWithDaysLate(1),
    invoiceWithDaysLate(2),
    invoiceWithDaysLate(3),
  ]
  const excludedInvoices = [
    invoiceWithDaysLate(20, { status: 'VOIDED' }),
    invoiceWithDaysLate(20, { status: 'AUTHORISED' }),
    invoiceWithDaysLate(20, { status: 'DELETED' }),
    invoiceWithDaysLate(20, { type: 'ACCPAY' }),
    invoiceWithDaysLate(20, { due_date: '2026-02-30' }),
    invoiceWithDaysLate(20, { fully_paid_date: null }),
    invoiceWithDaysLate(20, { amount_due: 10 }),
    invoiceWithDaysLate(20, { total: 0 }),
    invoiceWithDaysLate(20, { amount_paid: 0 }),
  ]

  const result = calculateBaseline([...validInvoices, ...excludedInvoices])
  assert.equal(excludedInvoices.every((invoice) => !isEligibleHistoricalPaymentInvoice(invoice)), true)
  assert.equal(result.usableInvoiceCount, 3)
  assert.deepEqual(result.daysLateObservations, [1, 2, 3])
  assert.equal(calculateHistoricalDaysLate(excludedInvoices[4]), null)
})

test('excludes materially credited settlement observations', () => {
  const partiallyCredited = invoiceWithDaysLate(20, {
    total: 100,
    amount_paid: 90,
    amount_credited: 10,
  })
  const fullyCredited = invoiceWithDaysLate(20, {
    amount_paid: 0,
    amount_credited: 100,
  })
  const roundingCredit = invoiceWithDaysLate(4, {
    amount_paid: 99.99,
    amount_credited: 0.01,
  })

  assert.equal(isEligibleHistoricalPaymentInvoice(partiallyCredited), false)
  assert.equal(isEligibleHistoricalPaymentInvoice(fullyCredited), false)
  assert.equal(isEligibleHistoricalPaymentInvoice(roundingCredit), true)
})

test('includes every eligible invoice settled inside the six-month window', () => {
  const result = calculateBaseline([
    invoiceSettledOn('2026-03-08', 1),
    invoiceSettledOn('2026-05-10', 2),
    invoiceSettledOn('2026-07-20', 3),
    invoiceSettledOn('2026-09-07', 4),
  ])

  assert.equal(HISTORICAL_PAYMENT_WINDOW_MONTHS, 6)
  assert.equal(result.usableInvoiceCount, 4)
  assert.deepEqual(result.daysLateObservations, [1, 2, 3, 4])
  assert.equal(result.meanDaysLate, 2.5)
  assert.equal(result.normalDaysLate, 2.5)
})

test('excludes invoices outside the six-month window from every diagnostic', () => {
  const result = calculateBaseline([
    invoiceSettledOn('2025-10-01', 90),
    invoiceSettledOn('2026-03-06', 60),
    invoiceSettledOn('2026-04-01', 1),
    invoiceSettledOn('2026-06-01', 3),
    invoiceSettledOn('2026-08-01', 5),
    invoiceSettledOn('2026-09-08', 120),
  ])

  assert.equal(result.usableInvoiceCount, 3)
  assert.deepEqual(result.daysLateObservations, [1, 3, 5])
  assert.equal(result.meanDaysLate, 3)
  assert.equal(result.normalDaysLate, 3)
  assert.equal(calculateRelativeLatenessDays(10, result.normalDaysLate), 7)
})

test('uses an inclusive six-calendar-month cutoff', () => {
  assert.equal(calculateHistoricalPaymentWindowCutoff(EVALUATION_DATE), '2026-03-07')
  assert.equal(calculateHistoricalPaymentWindowCutoff('2026-08-31'), '2026-02-28')

  const result = calculateBaseline([
    invoiceSettledOn('2026-03-06', 100),
    invoiceSettledOn('2026-03-07', 9),
    invoiceSettledOn('2026-05-01', 1),
    invoiceSettledOn('2026-07-01', 2),
  ])

  assert.equal(result.usableInvoiceCount, 3)
  assert.deepEqual(result.daysLateObservations, [1, 2, 9])
  assert.equal(result.normalDaysLate, 2)
})

test('uses all qualifying observations without an invoice-count cap', () => {
  const invoices = Array.from({ length: 50 }, (_, daysLate) =>
    invoiceSettledOn('2026-08-15', daysLate)
  )
  const result = calculateBaseline(invoices)

  assert.equal(result.usableInvoiceCount, 50)
  assert.equal(result.daysLateObservations.length, 50)
  assert.equal(result.meanDaysLate, 24.5)
  assert.equal(result.normalDaysLate, 24.5)
})

test('keeps a high-frequency recent baseline stable', () => {
  const invoices = [
    ...Array.from({ length: 30 }, () => invoiceSettledOn('2026-08-15', 0)),
    invoiceSettledOn('2026-08-16', 4),
    invoiceSettledOn('2026-08-17', 5),
    invoiceSettledOn('2026-08-18', 6),
  ]
  const result = calculateBaseline(invoices)

  assert.equal(result.usableInvoiceCount, 33)
  assert.equal(result.normalDaysLate, 0)
  assert.equal(result.meanDaysLate, 15 / 33)
})

test('exactly three recent observations produce a historical normal', () => {
  const result = calculateBaseline([
    invoiceSettledOn('2026-04-01', -2),
    invoiceSettledOn('2026-06-01', 0),
    invoiceSettledOn('2026-08-01', 4),
  ])

  assert.equal(result.usableInvoiceCount, 3)
  assert.equal(result.normalDaysLate, 0)
})

test('older history cannot compensate for only two recent observations', () => {
  const olderInvoices = Array.from({ length: 12 }, (_, index) =>
    invoiceSettledOn('2025-12-01', index + 20)
  )
  const result = calculateBaseline([
    ...olderInvoices,
    invoiceSettledOn('2026-07-01', 1),
    invoiceSettledOn('2026-08-01', 5),
  ])

  assert.equal(result.usableInvoiceCount, 2)
  assert.deepEqual(result.daysLateObservations, [1, 5])
  assert.equal(result.meanDaysLate, 3)
  assert.equal(result.normalDaysLate, null)
  assert.equal(calculateRelativeLatenessDays(12, result.normalDaysLate), null)
})

test('mean and median use exactly the same six-month population', () => {
  const result = calculateBaseline([
    invoiceSettledOn('2026-03-06', -100),
    invoiceSettledOn('2026-04-01', 0),
    invoiceSettledOn('2026-06-01', 2),
    invoiceSettledOn('2026-08-01', 10),
  ])

  assert.deepEqual(result.daysLateObservations, [0, 2, 10])
  assert.equal(result.usableInvoiceCount, 3)
  assert.equal(result.meanDaysLate, 4)
  assert.equal(result.normalDaysLate, 2)
})

test('processes several thousand recent observations without truncation', (context) => {
  const invoices = Array.from({ length: 5_000 }, (_, index) =>
    invoiceSettledOn('2026-08-15', (index % 7) - 3)
  )
  const startedAt = performance.now()
  const result = calculateBaseline(invoices)
  const elapsedMilliseconds = performance.now() - startedAt

  assert.equal(result.usableInvoiceCount, 5_000)
  assert.equal(result.daysLateObservations.length, 5_000)
  assert.equal(result.normalDaysLate, 0)
  context.diagnostic(`Calculated 5,000 observations in ${elapsedMilliseconds.toFixed(2)} ms`)
})

test('calculates positive relative lateness without clamping', () => {
  assert.equal(calculateRelativeLatenessDays(25, 5), 20)
  assert.equal(calculateRelativeLatenessDays(12, -2), 14)
  assert.equal(formatRelativeLateness(20), '20 days later than usual')
})

test('calculates negative relative lateness without clamping', () => {
  assert.equal(calculateRelativeLatenessDays(10, 20), -10)
  assert.equal(formatRelativeLateness(-10), '10 days earlier than usual')
})

test('keeps a position matching normal at approximately zero', () => {
  const relativeLateness = calculateRelativeLatenessDays(6.00001, 6)
  assert.ok(Math.abs(relativeLateness) < 0.001)
  assert.equal(formatRelativeLateness(relativeLateness), 'About the same as usual')
})

test('customer summary UI exposes the payment behaviour diagnostics', async () => {
  const [clientSource, summarySource] = await Promise.all([
    readFile(CUSTOMER_SUMMARY_CLIENT_PATH, 'utf8'),
    readFile(CUSTOMER_SUMMARY_PATH, 'utf8'),
  ])

  assert.match(clientSource, /Payment behaviour/)
  assert.match(clientSource, /Typical payment timing:/)
  assert.match(clientSource, /Historical invoices:/)
  assert.match(clientSource, /Current overdue age:/)
  assert.match(clientSource, /Versus normal:/)
  assert.match(
    summarySource,
    /calculateHistoricalPaymentBaseline\([\s\S]*?\{ evaluationDate: todayIso \}/
  )
})
