import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const firstValue = loadTypeScriptModule('lib/collections/first-value.ts')
const projectFile = (path) => new URL(`../../${path}`, import.meta.url)

function row(overrides = {}) {
  return {
    customer_source_id: 'customer-one',
    customer_name: 'Customer One',
    customer_overdue_to_chase_base: 18_400,
    customer_to_chase_overdue_base: 18_400,
    has_actionable_overdue_balance: true,
    overdue_invoices_count: 3,
    weighted_avg_overdue_days: 47,
    relative_lateness_days: 12,
    last_payment_days_ago: 75,
    exposure_score: 100,
    exposure_share_percent: 42,
    exposure_relative_to_largest_percent: 100,
    urgency_score: 70,
    relative_lateness_score: 60,
    payment_recency_score: 100,
    override_level: 'normal',
    recommended_action: 'Review now',
    organisation_base_currency_code: 'GBP',
    ...overrides,
  }
}

test('first-value reasons use the strongest implemented scoring facts', () => {
  const reasons = firstValue.buildFirstValueReasons(row(), { eligibleCustomerCount: 4 })

  assert.deepEqual(reasons.map((reason) => reason.kind), ['exposure', 'urgency'])
  assert.match(reasons[0].text, /£18,400 overdue/)
  assert.match(reasons[0].text, /largest overdue To chase in the portfolio/i)
  assert.match(reasons[1].text, /47 days overdue on average/i)
  assert.match(reasons[1].text, /3 invoices/i)
})

test('deterioration and payment-recency reasons are traceable to their actual inputs', () => {
  const deterioration = firstValue.buildFirstValueReasons(
    row({
      exposure_score: 4,
      urgency_score: 4,
      relative_lateness_score: 100,
      relative_lateness_days: 22,
      payment_recency_score: 0,
    }),
    { eligibleCustomerCount: 2 }
  )
  assert.equal(deterioration[0].kind, 'deterioration')
  assert.match(deterioration[0].text, /22 days later than.*recent normal payment timing/i)

  const recency = firstValue.buildFirstValueReasons(
    row({
      exposure_score: 0,
      urgency_score: 0,
      relative_lateness_score: 0,
      relative_lateness_days: null,
      payment_recency_score: 100,
      last_payment_days_ago: 75,
    }),
    { eligibleCustomerCount: 1 }
  )
  assert.equal(recency[0].kind, 'payment_recency')
  assert.match(recency[0].text, /last recorded payment was 75 days ago/i)
})

test('default Normal adds no invented founder claim while existing overrides remain explicit', () => {
  const normal = firstValue.buildFirstValueReasons(row(), { eligibleCustomerCount: 3 })
  assert.equal(normal.some((reason) => reason.kind === 'operator_adjustment'), false)

  const priority = firstValue.buildFirstValueReasons(
    row({ override_level: 'priority' }),
    { eligibleCustomerCount: 3 }
  )
  assert.match(priority.at(-1).text, /Your Priority adjustment increases/i)

  const safe = firstValue.buildFirstValueReasons(
    row({ override_level: 'safe' }),
    { eligibleCustomerCount: 3 }
  )
  assert.match(safe.at(-1).text, /Your Safe adjustment reduces/i)
})

test('reason language makes no predictive or risk claim', () => {
  const variants = [
    row(),
    row({ last_payment_days_ago: null }),
    row({ override_level: 'priority' }),
    row({ override_level: 'safe' }),
  ]
  const language = variants
    .flatMap((candidate) =>
      firstValue.buildFirstValueReasons(candidate, { eligibleCustomerCount: 5 })
    )
    .map((reason) => reason.text)
    .join('\n')

  assert.doesNotMatch(
    language,
    /chance of payment|likely to pay|most likely|highest risk|best cash|collectability|probability/i
  )
})

test('comparison shortlist renders exactly the eligible customers available up to three', () => {
  const rows = [
    row({ customer_source_id: 'first' }),
    row({ customer_source_id: 'second' }),
    row({ customer_source_id: 'third' }),
    row({ customer_source_id: 'fourth' }),
  ]
  assert.deepEqual(
    firstValue.selectFirstValuePriorities(rows, {}).map((item) => item.customer_source_id),
    ['first', 'second', 'third']
  )
  assert.equal(firstValue.selectFirstValuePriorities(rows.slice(0, 2), {}).length, 2)
  assert.equal(firstValue.selectFirstValuePriorities(rows.slice(0, 1), {}).length, 1)
})

test('actioned, postponed-equivalent, and do-not-chase rows cannot become the first recommendation', () => {
  const rows = [
    row({ customer_source_id: 'actioned' }),
    row({ customer_source_id: 'do-not', override_level: 'do_not_chase' }),
    row({ customer_source_id: 'no-action', recommended_action: 'No action' }),
    row({ customer_source_id: 'first-live' }),
  ]
  const selected = firstValue.selectFirstValuePriorities(rows, { actioned: {} })
  assert.deepEqual(selected.map((item) => item.customer_source_id), ['first-live'])
})

test('first-value selection requires the canonical post-credit customer amount', () => {
  const rows = [
    row({ customer_source_id: 'covered', customer_to_chase_overdue_base: 0,
      has_actionable_overdue_balance: false,
      override_level: 'priority', recommended_action: 'Review now' }),
    row({ customer_source_id: 'partial', customer_to_chase_overdue_base: 300 }),
  ]
  assert.deepEqual(firstValue.selectFirstValuePriorities(rows, {}).map(item => item.customer_source_id),
    ['partial'])
})

test('first-value action headline renders the canonical customer amount', () => {
  const { default: FirstValueResultView } = loadTypeScriptModule(
    'app/start/result/FirstValueResultView.tsx',
    { mocks: { 'next/link': 'a' } }
  )
  const candidate = row({
    collectible_overdue_base: 1000,
    overdue_outstanding_base: 1000,
    customer_overdue_to_chase_base: 700,
    customer_to_chase_overdue_base: 700,
    actionable_overdue_invoices_count: 1,
    first_value_reasons: [{ kind: 'exposure', text: 'Current customer exposure' }],
  })
  const html = renderToStaticMarkup(React.createElement(FirstValueResultView, {
    data: {
      rows: [candidate], actionsTakenByCustomerId: {}, organisationBaseCurrency: 'GBP',
      portfolio: { analysedOverdueBase: 700, analysedOverdueCustomerCount: 1, rankingStatus: 'complete' },
      queue: { status: 'ready', mappedCustomerCount: 1, mappedInvoiceCount: 1,
        eligibleCustomerCount: 1, suppressedCustomerCount: 0, actionedTodayCount: 0,
        remainingCustomerCount: 1, reviewRequiredCustomerCount: 0 },
      currencyHealth: { status: 'healthy', affectedInvoiceCount: 0, affectedCustomerCount: 0 },
    }, tenantId: 'tenant-a', organisationName: 'Example', lastSyncedAt: null,
  }))
  assert.match(html, /£700 overdue to chase/)
  assert.doesNotMatch(html, /£1,000 overdue to chase/)
})

test('successful empty outcomes distinguish no overdue debt from no current action', () => {
  assert.equal(
    firstValue.resolveFirstValueOutcome({
      queueStatus: 'no_overdue_customers',
      priorityCount: 0,
      overdueCustomerCount: 0,
      reviewRequiredCustomerCount: 0,
      currencyHealthStatus: 'healthy',
    }),
    'no_overdue'
  )
  assert.equal(
    firstValue.resolveFirstValueOutcome({
      queueStatus: 'complete_today',
      priorityCount: 0,
      overdueCustomerCount: 3,
      reviewRequiredCustomerCount: 0,
      currencyHealthStatus: 'healthy',
    }),
    'no_actionable'
  )
  assert.equal(
    firstValue.resolveFirstValueOutcome({
      queueStatus: 'currency_data_unavailable',
      priorityCount: 0,
      overdueCustomerCount: 0,
      reviewRequiredCustomerCount: 0,
      currencyHealthStatus: 'unavailable',
    }),
    'currency_unavailable'
  )
  assert.equal(
    firstValue.resolveFirstValueOutcome({
      queueStatus: 'currency_data_degraded',
      priorityCount: 0,
      overdueCustomerCount: 0,
      reviewRequiredCustomerCount: 2,
      currencyHealthStatus: 'degraded',
    }),
    'currency_review_required'
  )
  assert.equal(
    firstValue.resolveFirstValueOutcome({
      queueStatus: 'no_mapped_data',
      priorityCount: 0,
      overdueCustomerCount: 0,
      reviewRequiredCustomerCount: 0,
      currencyHealthStatus: 'healthy',
    }),
    'no_receivables'
  )
})

test('first-result surface has a focused hierarchy and transitions into the mature workspace', async () => {
  const [view, client, preparation, journey, nav, footer] = await Promise.all([
    readFile(projectFile('app/start/result/FirstValueResultView.tsx'), 'utf8'),
    readFile(projectFile('app/start/result/FirstValueResultClient.tsx'), 'utf8'),
    readFile(projectFile('app/start/FirstValuePreparation.tsx'), 'utf8'),
    readFile(projectFile('app/start/StartJourneyClient.tsx'), 'utf8'),
    readFile(projectFile('app/components/Nav.tsx'), 'utf8'),
    readFile(projectFile('app/components/Footer.tsx'), 'utf8'),
  ])

  assert.match(view, /Your first priorities are ready/)
  assert.match(view, /Start here/)
  assert.match(view, /Why Yuohme put this first/)
  assert.match(view, /Next in the ranking/)
  assert.match(view, /Open today’s queue/)
  assert.match(view, /Nothing needs chasing right now/)
  assert.match(view, /No customer needs action right now/)
  assert.match(view, /safe provisional ranking/)
  assert.match(view, /needs reliable currency values before ranking this ledger/)
  assert.match(view, /cannot safely rank this ledger yet/)
  assert.doesNotMatch(view, /priority_score|Score breakdown|Called|Emailed|Postpone 1 day/)
  assert.match(view, /sm:text-5xl/)
  assert.match(view, /sm:grid-cols-2/)

  assert.match(client, /hasPriorCollectionActivity/)
  assert.match(client, /router\.replace\(dashboardPath/)
  assert.match(client, /MULTI_CURRENCY_REQUIRES_PRO/)
  assert.doesNotMatch(client, /authoritative (?:Xero snapshot|result)/i)
  assert.match(preparation, /\/start\/result\?tenantId=/)
  assert.doesNotMatch(preparation, /fenced attempt/i)
  assert.match(journey, /\/start\/result\?tenantId=/)
  assert.match(nav, /pathname\.startsWith\('\/start\/'\)/)
  assert.match(footer, /pathname\.startsWith\('\/start\/'\)/)
})
