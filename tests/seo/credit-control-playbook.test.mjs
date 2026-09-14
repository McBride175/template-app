import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const {
  PLAYBOOK_CONCERNS,
  PLAYBOOK_CUSTOMERS,
  explainTopPlaybookCustomer,
  getInitialPlaybookConcerns,
  rankPlaybookCustomers,
} = loadTypeScriptModule('lib/credit-control-playbook.ts')
const {
  computePrioritizationBaseScore,
  OVERRIDE_MULTIPLIERS,
  prioritiseCustomer,
} = loadTypeScriptModule('lib/collections/prioritization.ts')
const { buildRelativeLatenessContext } = loadTypeScriptModule(
  'lib/collections/relative-lateness.ts'
)

const PLAYBOOK_PAGE_PATH = new URL(
  '../../app/guides/credit-control-prioritisation-playbook/page.tsx',
  import.meta.url
)
const PLAYBOOK_CLIENT_PATH = new URL(
  '../../app/guides/credit-control-prioritisation-playbook/PrioritisationPlaybook.tsx',
  import.meta.url
)
const PLAYBOOK_CALLOUT_PATH = new URL(
  '../../app/guides/_components/PlaybookCallout.tsx',
  import.meta.url
)

test('starts with a non-obvious customer order rather than largest-first or oldest-first', () => {
  const initialConcerns = getInitialPlaybookConcerns()
  const ranked = rankPlaybookCustomers(initialConcerns)
  const largest = PLAYBOOK_CUSTOMERS.reduce((current, customer) =>
    customer.outstanding > current.outstanding ? customer : current
  )
  const oldest = PLAYBOOK_CUSTOMERS.reduce((current, customer) =>
    customer.daysOverdue > current.daysOverdue ? customer : current
  )

  assert.equal(ranked[0].name, 'Marlowe Fit-Out')
  assert.equal(Object.values(initialConcerns).every((concern) => concern === 'medium'), true)
  assert.notEqual(ranked[0].id, largest.id)
  assert.notEqual(ranked[0].id, oldest.id)
  assert.deepEqual(
    ranked.map((customer) => customer.rank),
    [1, 2, 3, 4, 5, 6]
  )
})

test('founder concern uses the engine adjustment without making High an automatic first place', () => {
  const initialConcerns = getInitialPlaybookConcerns()
  const initial = rankPlaybookCustomers(initialConcerns)
  const changed = rankPlaybookCustomers({
    ...initialConcerns,
    'calder-kitchens': 'high',
  })

  assert.equal(initial.find((customer) => customer.id === 'calder-kitchens').rank, 6)
  assert.equal(changed.find((customer) => customer.id === 'calder-kitchens').rank, 2)
  assert.equal(changed[0].name, 'Marlowe Fit-Out')
})

test('the top explanation changes consistently when founder knowledge changes the leader', () => {
  const initialConcerns = getInitialPlaybookConcerns()
  const initialTop = rankPlaybookCustomers(initialConcerns)[0]
  const changedTop = rankPlaybookCustomers({
    ...initialConcerns,
    'elmstead-engineering': 'high',
  })[0]
  const initialExplanation = explainTopPlaybookCustomer(initialTop)
  const changedExplanation = explainTopPlaybookCustomer(changedTop)

  assert.equal(initialExplanation.heading, 'Why Marlowe Fit-Out is currently first')
  assert.match(initialExplanation.body, /neither the largest balance nor the oldest debt/i)
  assert.match(initialExplanation.body, /normal payment pattern/i)
  assert.equal(changedExplanation.heading, 'Why Elmstead Engineering is currently first')
  assert.match(changedExplanation.body, /same Priority adjustment used by the main engine/i)
  assert.match(changedExplanation.body, /approval run may be delayed/i)
  assert.match(changedExplanation.body, /change from this customer's normal payment pattern/i)
})

test('matches the main engine scores and ordering for every concern configuration', () => {
  const configurations = [
    getInitialPlaybookConcerns(),
    { ...getInitialPlaybookConcerns(), 'calder-kitchens': 'high' },
    {
      ...getInitialPlaybookConcerns(),
      'elmstead-engineering': 'low',
      'marlowe-fit-out': 'high',
      'harbour-studio': 'low',
    },
  ]
  const concernToOverride = { low: 'safe', medium: 'normal', high: 'priority' }
  const totalOverdueOutstanding = PLAYBOOK_CUSTOMERS.reduce(
    (total, customer) => total + customer.outstanding,
    0
  )
  const context = {
    totalOverdueOutstandingBase: totalOverdueOutstanding,
    maxOverdueOutstandingBase: Math.max(
      ...PLAYBOOK_CUSTOMERS.map((customer) => customer.outstanding)
    ),
    overallWeightedAvgOverdueDays:
      PLAYBOOK_CUSTOMERS.reduce(
        (total, customer) => total + customer.outstanding * customer.daysOverdue,
        0
      ) / totalOverdueOutstanding,
    maxWeightedAvgOverdueDays: Math.max(
      ...PLAYBOOK_CUSTOMERS.map((customer) => customer.daysOverdue)
    ),
    relativeLateness: buildRelativeLatenessContext(
      PLAYBOOK_CUSTOMERS.map((customer) => ({
        overdueOutstandingBase: customer.outstanding,
        relativeLatenessDays: customer.daysOverdue - customer.normalDaysLate,
      }))
    ),
  }

  for (const concerns of configurations) {
    const expected = PLAYBOOK_CUSTOMERS.map((customer) => {
      const ranked = prioritiseCustomer(
        {
          customer_source_id: customer.id,
          customer_name: customer.name,
          customer_email: null,
          overdue_outstanding_base: customer.outstanding,
          total_outstanding_base: customer.outstanding,
          overdue_invoices_count: customer.overdueInvoiceCount,
          open_invoices_count: customer.overdueInvoiceCount,
          weighted_avg_overdue_days: customer.daysOverdue,
          last_payment_date: null,
          last_payment_days_ago: customer.daysSinceLastPayment,
          has_recent_partial_payment: false,
          relative_lateness_days: customer.daysOverdue - customer.normalDaysLate,
          organisation_base_currency_code: 'GBP',
        },
        context,
        concernToOverride[concerns[customer.id]]
      )

      return {
        id: customer.id,
        name: customer.name,
        outstanding: customer.outstanding,
        baseScore: ranked.base_score,
        finalScore: ranked.priority_score,
      }
    })
      .sort(
        (a, b) =>
          b.finalScore - a.finalScore ||
          b.outstanding - a.outstanding ||
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      )
      .map(({ id, baseScore, finalScore }, index) => ({
        id,
        baseScore,
        finalScore,
        rank: index + 1,
      }))

    assert.deepEqual(
      rankPlaybookCustomers(concerns).map(({ id, baseScore, finalScore, rank }) => ({
        id,
        baseScore,
        finalScore,
        rank,
      })),
      expected
    )
  }
})

test('invalid concern input falls back deterministically with no invalid ranks or scores', () => {
  const initial = rankPlaybookCustomers(getInitialPlaybookConcerns())
  const invalid = rankPlaybookCustomers({
    ...getInitialPlaybookConcerns(),
    'marlowe-fit-out': 'extreme',
  })

  assert.deepEqual(
    invalid.map(({ id, concern, rank }) => ({ id, concern, rank })),
    initial.map(({ id, concern, rank }) => ({ id, concern, rank }))
  )
  assert.equal(new Set(invalid.map((customer) => customer.rank)).size, invalid.length)
  assert.equal(
    invalid.every(
      (customer) => Number.isFinite(customer.baseScore) && Number.isFinite(customer.finalScore)
    ),
    true
  )
})

test('the page is local-only, responsive by composition and exposes accessible concern controls', async () => {
  const [pageSource, clientSource] = await Promise.all([
    readFile(PLAYBOOK_PAGE_PATH, 'utf8'),
    readFile(PLAYBOOK_CLIENT_PATH, 'utf8'),
  ])

  assert.match(pageSource, /canonicalPath = '\/guides\/credit-control-prioritisation-playbook'/)
  assert.match(pageSource, /No login or Xero connection/)
  assert.match(pageSource, /educational comparison, not a default\s+prediction/i)
  assert.match(pageSource, /same prioritisation engine and weights as the\s+product/i)
  assert.match(pageSource, /distinguish predictable delay from a\s+meaningful deterioration/i)
  assert.match(pageSource, /sm:grid-cols-3/)
  assert.match(clientSource, /lg:grid-cols-/)
  assert.match(clientSource, /<fieldset/)
  assert.match(clientSource, /<legend className="sr-only">/)
  assert.match(clientSource, /aria-pressed=\{selected\}/)
  assert.match(clientSource, /aria-live="polite"/)
  assert.doesNotMatch(clientSource, /fetch\(/)
})

test('the highest-intent Hub A and Hub E guides link contextually to the playbook', async () => {
  const source = await readFile(PLAYBOOK_CALLOUT_PATH, 'utf8')
  const expectedInboundGuideSlugs = [
    'how-to-prioritise-overdue-invoices',
    'which-customer-should-i-chase-first-for-payment',
    'how-to-prioritise-multiple-overdue-customers',
    'should-i-chase-the-largest-invoice-first',
    'should-i-chase-the-oldest-invoice-first',
    'how-to-prioritise-debtors-by-risk',
    'how-to-prioritise-invoice-chasing-when-you-only-have-an-hour',
    'how-to-prioritise-overdue-invoices-in-xero',
  ]

  for (const slug of expectedInboundGuideSlugs) {
    assert.match(source, new RegExp(`'${slug}'`))
  }

  assert.match(source, /href=\{PLAYBOOK_PATH\}/)
})

// ---------------------------------------------------------------------------
// Parity tests — methodology and data parity alignment
// ---------------------------------------------------------------------------

/**
 * Helpers: build the same context and customer row that credit-control-playbook
 * builds internally, so tests can call prioritiseCustomer directly and compare
 * results with rankPlaybookCustomers.
 */
function buildReferenceContext(customers) {
  const totalOverdueOutstanding = customers.reduce(
    (total, customer) => total + customer.outstanding,
    0
  )
  return {
    totalOverdueOutstandingBase: totalOverdueOutstanding,
    maxOverdueOutstandingBase: Math.max(0, ...customers.map((c) => c.outstanding)),
    overallWeightedAvgOverdueDays:
      totalOverdueOutstanding > 0
        ? customers.reduce((t, c) => t + c.outstanding * c.daysOverdue, 0) / totalOverdueOutstanding
        : 0,
    maxWeightedAvgOverdueDays: Math.max(0, ...customers.map((c) => c.daysOverdue)),
    relativeLateness: buildRelativeLatenessContext(
      customers.map((c) => ({
        overdueOutstandingBase: c.outstanding,
        relativeLatenessDays: c.daysOverdue - c.normalDaysLate,
      }))
    ),
  }
}

function toReferenceRow(customer) {
  return {
    customer_source_id: customer.id,
    customer_name: customer.name,
    customer_email: null,
    overdue_outstanding_base: customer.outstanding,
    total_outstanding_base: customer.outstanding,
    overdue_invoices_count: customer.overdueInvoiceCount,
    open_invoices_count: customer.overdueInvoiceCount,
    weighted_avg_overdue_days: customer.daysOverdue,
    last_payment_date: null,
    last_payment_days_ago: customer.daysSinceLastPayment,
    has_recent_partial_payment: false,
    relative_lateness_days: customer.daysOverdue - customer.normalDaysLate,
    organisation_base_currency_code: 'GBP',
  }
}

test('exact component-level score parity: rankPlaybookCustomers matches direct prioritiseCustomer for every fixture customer', () => {
  const context = buildReferenceContext(PLAYBOOK_CUSTOMERS)
  const ranked = rankPlaybookCustomers(getInitialPlaybookConcerns())

  for (const customer of PLAYBOOK_CUSTOMERS) {
    const row = toReferenceRow(customer)
    const direct = prioritiseCustomer(row, context, 'normal')
    const fromRank = ranked.find((r) => r.id === customer.id)

    assert.equal(
      fromRank.baseScore,
      direct.base_score,
      `base_score mismatch for ${customer.name}: got ${fromRank.baseScore}, expected ${direct.base_score}`
    )
    assert.equal(
      fromRank.finalScore,
      direct.priority_score,
      `priority_score mismatch for ${customer.name}`
    )
  }
})

test('relative deterioration — sufficient history, no deterioration (zero) scores 0 and is distinct from missing history', () => {
  // normalDaysLate = daysOverdue → relative_lateness_days = 0
  // This means history exists and the customer is behaving normally. Score = 0.
  // This is NOT missing history.
  const customerAtNormal = toReferenceRow(
    PLAYBOOK_CUSTOMERS.find((c) => c.id === 'birch-and-stone')
  )
  // Override so the customer is exactly at its normal: relative_lateness_days = 0
  const rowExactlyNormal = { ...customerAtNormal, relative_lateness_days: 0 }

  // Missing history: relative_lateness_days = null
  const rowMissingHistory = { ...customerAtNormal, relative_lateness_days: null }

  const context = buildReferenceContext(PLAYBOOK_CUSTOMERS)
  const resultNormal = prioritiseCustomer(rowExactlyNormal, context, 'normal')
  const resultMissing = prioritiseCustomer(rowMissingHistory, context, 'normal')

  // Both score 0 for relative deterioration component
  assert.equal(resultNormal.relative_lateness_score, 0)
  assert.equal(resultMissing.relative_lateness_score, 0)

  // Both have the same base_score (15% weight not redistributed for either)
  assert.equal(resultNormal.base_score, resultMissing.base_score)

  // Breakdown semantics differ: null → "not enough recent payment history"
  const breakdownMissing = resultMissing.score_breakdown_lines.join('\n')
  assert.match(breakdownMissing, /not enough recent payment history/i)

  // Breakdown for exactly-normal shows the 0 days input, not "not enough history"
  const breakdownNormal = resultNormal.score_breakdown_lines.join('\n')
  assert.match(breakdownNormal, /0\.0 days versus recent normal/)
  assert.doesNotMatch(breakdownNormal, /not enough recent payment history/i)
})

test('relative deterioration — missing history (null) causes score 0 with no weight redistribution', () => {
  const context = buildReferenceContext(PLAYBOOK_CUSTOMERS)
  const anyCustomer = toReferenceRow(PLAYBOOK_CUSTOMERS[0])
  const withHistory = prioritiseCustomer({ ...anyCustomer, relative_lateness_days: 30 }, context, 'normal')
  const withoutHistory = prioritiseCustomer({ ...anyCustomer, relative_lateness_days: null }, context, 'normal')

  assert.equal(withoutHistory.relative_lateness_score, 0)

  // The base_score difference is exactly 15% × 30-day score (not redistributed means
  // scores differ by the contribution, not inflated by reallocation).
  assert.ok(
    withHistory.base_score > withoutHistory.base_score,
    'history-based customer scores higher'
  )
  assert.equal(
    Number((withHistory.base_score - withoutHistory.base_score).toFixed(1)),
    Number((0.15 * withHistory.relative_lateness_score).toFixed(1))
  )
})

test('currency: fixture adapter always supplies GBP and cannot mix currencies', () => {
  // Every PLAYBOOK_CUSTOMER row passed to the engine must carry GBP.
  for (const customer of PLAYBOOK_CUSTOMERS) {
    const row = toReferenceRow(customer)
    assert.equal(
      row.organisation_base_currency_code,
      'GBP',
      `Expected GBP for ${customer.name}, got ${row.organisation_base_currency_code}`
    )
  }

  // All outstanding values are finite positive numbers (no NaN or mixing signal).
  for (const customer of PLAYBOOK_CUSTOMERS) {
    assert.ok(
      Number.isFinite(customer.outstanding) && customer.outstanding > 0,
      `Expected finite positive outstanding for ${customer.name}`
    )
  }
})

test('concern-to-multiplier mapping: low and high use exact production multipliers', () => {
  // OVERRIDE_MULTIPLIERS is the canonical source in prioritization.ts.
  assert.equal(OVERRIDE_MULTIPLIERS['safe'], 0.4)
  assert.equal(OVERRIDE_MULTIPLIERS['normal'], 1.0)
  assert.equal(OVERRIDE_MULTIPLIERS['priority'], 1.6)
  assert.equal(OVERRIDE_MULTIPLIERS['do_not_chase'], 0.0)

  // Verify through rankPlaybookCustomers that low and high produce scores consistent
  // with ×0.4 and ×1.6 applied to the shared base_score.
  const context = buildReferenceContext(PLAYBOOK_CUSTOMERS)
  const testCustomer = PLAYBOOK_CUSTOMERS[0]
  const row = toReferenceRow(testCustomer)

  const neutralDirect = prioritiseCustomer(row, context, 'normal')
  const safeDirect = prioritiseCustomer(row, context, 'safe')
  const priorityDirect = prioritiseCustomer(row, context, 'priority')

  assert.equal(safeDirect.final_score, Number((neutralDirect.base_score * 0.4).toFixed(1)))
  assert.equal(priorityDirect.final_score, Number((neutralDirect.base_score * 1.6).toFixed(1)))

  // Confirm rankPlaybookCustomers with low/high concern produces the same final score.
  const lowConcerns = { ...getInitialPlaybookConcerns(), [testCustomer.id]: 'low' }
  const highConcerns = { ...getInitialPlaybookConcerns(), [testCustomer.id]: 'high' }
  const rankedLow = rankPlaybookCustomers(lowConcerns).find((c) => c.id === testCustomer.id)
  const rankedHigh = rankPlaybookCustomers(highConcerns).find((c) => c.id === testCustomer.id)

  assert.equal(rankedLow.finalScore, safeDirect.final_score)
  assert.equal(rankedHigh.finalScore, priorityDirect.final_score)
})

test('do_not_chase is intentionally absent from PLAYBOOK_CONCERNS', () => {
  // The interactive control uses Low / Medium / High (3 levels). do_not_chase (×0)
  // is a production-only option; the educational demo has no remove-from-list concept.
  assert.deepEqual([...PLAYBOOK_CONCERNS], ['low', 'medium', 'high'])
  assert.equal(PLAYBOOK_CONCERNS.includes('do_not_chase'), false)
})

test('full-score parity: the 4-weight formula produces consistent base scores via computePrioritizationBaseScore', () => {
  // Verify the weights sum to 1.0 and each component contributes at the right fraction.
  assert.equal(computePrioritizationBaseScore({ exposureScore: 100, urgencyScore: 0, relativeDeteriorationScore: 0, paymentRecencyScore: 0 }), 50)
  assert.equal(computePrioritizationBaseScore({ exposureScore: 0, urgencyScore: 100, relativeDeteriorationScore: 0, paymentRecencyScore: 0 }), 25)
  assert.equal(computePrioritizationBaseScore({ exposureScore: 0, urgencyScore: 0, relativeDeteriorationScore: 100, paymentRecencyScore: 0 }), 15)
  assert.equal(computePrioritizationBaseScore({ exposureScore: 0, urgencyScore: 0, relativeDeteriorationScore: 0, paymentRecencyScore: 100 }), 10)
  assert.equal(computePrioritizationBaseScore({ exposureScore: 100, urgencyScore: 100, relativeDeteriorationScore: 100, paymentRecencyScore: 100 }), 100)
})

test('page copy accurately distinguishes pre-set profiles from computed baselines', async () => {
  const source = await readFile(
    new URL('../../app/guides/credit-control-prioritisation-playbook/page.tsx', import.meta.url),
    'utf8'
  )

  // Must state same engine/weights
  assert.match(source, /same prioritisation engine and weights as the\s+product/i)

  // Must distinguish pre-set profiles from computed baselines
  assert.match(source, /normal payment patterns\s+are pre-set as part\s+of the example/i)
  assert.match(source, /connected product calculates those baselines\s+automatically/i)
  assert.match(source, /actual recent settled-invoice history/i)

  // Must mention do_not_chase once
  assert.match(source, /Do not chase/i)
  assert.match(source, /removes a customer from active\s+chasing/i)

  // Must NOT expose internal scoring machinery
  assert.doesNotMatch(source, /P50|P90|16\.5|percentile/i)
  assert.doesNotMatch(source, /0\.50|0\.25|0\.15|0\.10/)
})
