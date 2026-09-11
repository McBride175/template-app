import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const {
  PLAYBOOK_CUSTOMERS,
  explainTopPlaybookCustomer,
  getInitialPlaybookConcerns,
  rankPlaybookCustomers,
} = loadTypeScriptModule('lib/credit-control-playbook.ts')
const { prioritiseCustomer } = loadTypeScriptModule('lib/collections/prioritization.ts')
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
  assert.match(pageSource, /same ranking function as the product/i)
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
