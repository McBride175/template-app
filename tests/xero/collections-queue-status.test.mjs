import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const COLLECTION_ACTIONS_ROUTE_PATH = new URL(
  '../../app/api/collections/actions/route.ts',
  import.meta.url
)
const COLLECTION_ACTIONS_CLIENT_PATH = new URL(
  '../../app/collections/actions/CollectionActionsClient.tsx',
  import.meta.url
)

function buildSummaryRow(overrides = {}) {
  const row = {
    customer_source_id: 'contact-overdue',
    customer_name: 'Overdue Customer',
    customer_email: 'billing@example.test',
    is_customer: true,
    is_supplier: false,
    status: 'ACTIVE',
    total_invoices_count: 1,
    open_invoices_count: 1,
    overdue_invoices_count: 1,
    total_outstanding_base_decimal: '500',
    overdue_outstanding_base_decimal: '500',
    total_outstanding_base: 500,
    overdue_outstanding_base: 500,
    total_outstanding: 500,
    overdue_outstanding: 500,
    oldest_overdue_invoice_date: '2026-06-30',
    oldest_overdue_days: 59,
    weighted_avg_overdue_days: 59,
    historical_paid_invoice_count: 0,
    historical_mean_days_late: null,
    historical_normal_days_late: null,
    relative_lateness_days: null,
    latest_invoice_date: '2026-06-01',
    latest_due_date: '2026-06-30',
    last_payment_date: null,
    last_payment_days_ago: null,
    has_recent_partial_payment: false,
    organisation_base_currency_code: 'GBP',
    currency_code: 'GBP',
    native_currency_breakdown: [
      {
        currency_code: 'GBP',
        total_outstanding_native: '500',
        overdue_outstanding_native: '500',
      },
    ],
    ...overrides,
  }

  if (!Object.hasOwn(overrides, 'total_outstanding_base_decimal')) {
    row.total_outstanding_base_decimal = String(row.total_outstanding_base)
  }
  if (!Object.hasOwn(overrides, 'overdue_outstanding_base_decimal')) {
    row.overdue_outstanding_base_decimal = String(row.overdue_outstanding_base)
  }

  return row
}

function buildReviewRequiredCustomer(overrides = {}) {
  return {
    customer_source_id: 'currency-review-customer',
    customer_name: 'Currency Review Customer',
    customer_email: null,
    review_status: 'unscored_due_to_currency',
    affected_invoice_count: 1,
    open_invoices_count: 1,
    overdue_invoices_count: 1,
    failure_reasons: { missing_rate: 1 },
    native_currency_breakdown: [
      {
        currency_code: 'USD',
        total_outstanding_native: '20000',
        overdue_outstanding_native: '20000',
      },
    ],
    ...overrides,
  }
}

function buildCurrencyContext(summaryRows) {
  const invoicedCurrencies = Array.from(
    new Set(
      summaryRows.flatMap((row) =>
        row.native_currency_breakdown.map((breakdown) => breakdown.currency_code)
      )
    )
  ).sort()

  return {
    mode: invoicedCurrencies.length > 1 ? 'multi_currency' : 'single_currency',
    invoicedCurrencies,
    relevantInvoiceCount: summaryRows.reduce(
      (total, row) => total + row.open_invoices_count,
      0
    ),
  }
}

function createQuery(rows) {
  const filters = []
  const query = {
    select() {
      return query
    },
    eq(column, value) {
      filters.push((row) => row[column] === value)
      return query
    },
    order() {
      return query
    },
    then(resolve, reject) {
      return Promise.resolve({
        data: rows.filter((row) => filters.every((filter) => filter(row))),
        error: null,
      }).then(resolve, reject)
    },
  }
  return query
}

function loadActionsRoute({
  summaryRows,
  sourceCounts,
  actionRows = [],
  organisationBaseCurrency = 'GBP',
  currencyHealth = {
    status: 'healthy',
    rankingStatus: 'complete',
    affectedInvoiceCount: 0,
    affectedCustomerCount: 0,
    failureReasons: {},
  },
  reviewRequiredCustomers = [],
  currencyIssues = [],
  currencyContext = buildCurrencyContext(summaryRows),
  onCurrencyLog = () => {},
}) {
  const tables = {
    customer_overrides: [],
    collection_actions: actionRows,
  }

  return loadTypeScriptModule(COLLECTION_ACTIONS_ROUTE_PATH, {
    mocks: {
      'next/server': {
        NextResponse: {
          json(body, init = {}) {
            return new Response(JSON.stringify(body), {
              status: init.status ?? 200,
              headers: { 'content-type': 'application/json' },
            })
          },
        },
      },
      '@/lib/supabase-server': {
        async createServerSupabaseClient() {
          return {
            auth: {
              async getUser() {
                return { data: { user: { id: 'queue-user' } }, error: null }
              },
            },
            from(table) {
              if (!Object.hasOwn(tables, table)) {
                throw new Error(`Unexpected queue table: ${table}`)
              }
              return createQuery(tables[table])
            },
          }
        },
      },
      '@/lib/collections/customer-summary': {
        async loadCustomerCollectionsSummaryWithMetadata() {
          return {
            rows: summaryRows,
            sourceCounts,
            organisationBaseCurrency,
            currencyHealth,
            currencyContext,
            reviewRequiredCustomers,
            currencyEvaluation: {
              organisationBaseCurrency,
              currencyHealth,
              affectedCustomerSourceIds: reviewRequiredCustomers.map(
                (customer) => customer.customer_source_id
              ),
              currencyIssues,
            },
          }
        },
      },
      '@/lib/collections/currency-health': {
        logCollectionsCurrencyHealth(params) {
          onCurrencyLog(params)
        },
      },
      '@/lib/collections/tenant-context': {
        isMissingRelationError() {
          return false
        },
      },
      '@/lib/billing/entitlements': {
        async claimActionsEntitlementStatus() {
          return {
            plan: 'paid',
            isPaid: true,
            paidPlan: 'pro',
            tenantId: 'queue-tenant',
            usageDaysConsumed: 0,
            usageDaysRemaining: null,
            freeUsageDaysLimit: 5,
            hasActionsAccess: true,
            usageDate: new Date().toISOString().slice(0, 10),
            usageDateConsumed: false,
          }
        },
      },
      '@/lib/supabase-admin': {
        createSupabaseAdminClient() {
          return {
            from(table) {
              if (!Object.hasOwn(tables, table)) {
                throw new Error(`Unexpected queue table: ${table}`)
              }
              return createQuery(tables[table])
            },
          }
        },
      },
    },
  })
}

async function requestActions(options) {
  const { GET } = loadActionsRoute(options)
  const limit = Number.isInteger(options.limit) ? `&limit=${options.limit}` : ''
  const response = await GET({
    nextUrl: new URL(
      `http://localhost/api/collections/actions?tenantId=queue-tenant&overdueOnly=true${limit}`
    ),
  })
  return { response, payload: await response.json() }
}

test('mapped overdue data returns an eligible collections customer', async () => {
  const { response, payload } = await requestActions({
    summaryRows: [buildSummaryRow()],
    sourceCounts: { customers: 1, invoices: 1, payments: 0 },
  })

  assert.equal(response.status, 200)
  assert.equal(payload.rows.length, 1)
  assert.equal(payload.rows[0].customer_source_id, 'contact-overdue')
  assert.equal(payload.queue.status, 'ready')
  assert.equal(payload.queue.eligibleCustomerCount, 1)
  assert.equal(payload.queue.remainingCustomerCount, 1)
  assert.equal(payload.organisationBaseCurrency, 'GBP')
  assert.equal(payload.currencyHealth.status, 'healthy')
  assert.equal(payload.currencyHealth.rankingStatus, 'complete')
  assert.equal(payload.currencyContext.mode, 'single_currency')
  assert.equal(payload.currencyAccess.allowed, true)
  assert.deepEqual(payload.reviewRequiredCustomers, [])
  assert.equal(payload.portfolio.totalOverdueBase, 500)
})

for (const organisationBaseCurrency of ['USD', 'AUD']) {
  test(`${organisationBaseCurrency} organisation ranks in its explicit base currency`, async () => {
    const { payload } = await requestActions({
      summaryRows: [
        buildSummaryRow({
          organisation_base_currency_code: organisationBaseCurrency,
          currency_code: organisationBaseCurrency,
          native_currency_breakdown: [
            {
              currency_code: organisationBaseCurrency,
              total_outstanding_native: '500',
              overdue_outstanding_native: '500',
            },
          ],
        }),
      ],
      sourceCounts: { customers: 1, invoices: 1, payments: 0 },
      organisationBaseCurrency,
    })

    assert.equal(payload.rows.length, 1)
    assert.equal(payload.organisationBaseCurrency, organisationBaseCurrency)
    assert.equal(
      payload.rows[0].organisation_base_currency_code,
      organisationBaseCurrency
    )
    assert.equal(payload.rows[0].exposure_score, 100)
  })
}

test('mixed GBP and USD customers use base-currency exposure and portfolio denominators', async () => {
  const { payload } = await requestActions({
    summaryRows: [
      buildSummaryRow({
        customer_source_id: 'customer-gbp',
        customer_name: 'GBP Customer',
        total_outstanding_base: 20_000,
        overdue_outstanding_base: 20_000,
        total_outstanding: 20_000,
        overdue_outstanding: 20_000,
        native_currency_breakdown: [
          {
            currency_code: 'GBP',
            total_outstanding_native: '20000',
            overdue_outstanding_native: '20000',
          },
        ],
      }),
      buildSummaryRow({
        customer_source_id: 'customer-usd',
        customer_name: 'USD Customer',
        total_outstanding_base: 40_000,
        overdue_outstanding_base: 40_000,
        total_outstanding: 40_000,
        overdue_outstanding: 40_000,
        native_currency_breakdown: [
          {
            currency_code: 'USD',
            total_outstanding_native: '50000',
            overdue_outstanding_native: '50000',
          },
        ],
      }),
    ],
    sourceCounts: { customers: 2, invoices: 2, payments: 0 },
  })

  const gbpCustomer = payload.rows.find((row) => row.customer_source_id === 'customer-gbp')
  const usdCustomer = payload.rows.find((row) => row.customer_source_id === 'customer-usd')

  assert.equal(payload.portfolio.totalOverdueBase, 60_000)
  assert.equal(payload.portfolio.largestCustomerOverdueBase, 40_000)
  assert.equal(usdCustomer.exposure_score, 100)
  assert.equal(gbpCustomer.exposure_score, 50)
  assert.ok(Math.abs(usdCustomer.exposure_share_percent - 66.66666666666666) < 1e-9)
  assert.ok(Math.abs(gbpCustomer.exposure_share_percent - 33.33333333333333) < 1e-9)
})

test('base-currency conversion reverses a ranking that raw native numbers would get wrong', async () => {
  const { payload } = await requestActions({
    summaryRows: [
      buildSummaryRow({
        customer_source_id: 'customer-usd-native-larger',
        customer_name: 'USD Native Larger',
        total_outstanding_base: 800,
        overdue_outstanding_base: 800,
        total_outstanding: 800,
        overdue_outstanding: 800,
        native_currency_breakdown: [
          {
            currency_code: 'USD',
            total_outstanding_native: '1000',
            overdue_outstanding_native: '1000',
          },
        ],
      }),
      buildSummaryRow({
        customer_source_id: 'customer-gbp-base-larger',
        customer_name: 'GBP Base Larger',
        total_outstanding_base: 900,
        overdue_outstanding_base: 900,
        total_outstanding: 900,
        overdue_outstanding: 900,
        native_currency_breakdown: [
          {
            currency_code: 'GBP',
            total_outstanding_native: '900',
            overdue_outstanding_native: '900',
          },
        ],
      }),
    ],
    sourceCounts: { customers: 2, invoices: 2, payments: 0 },
  })

  assert.deepEqual(
    payload.rows.map((row) => row.customer_source_id),
    ['customer-gbp-base-larger', 'customer-usd-native-larger']
  )
  assert.equal(payload.rows[0].exposure_score, 100)
  assert.ok(payload.rows[1].exposure_score < 100)
})

test('isolated conversion failure returns a provisional queue from safely valued customers', async () => {
  const logged = []
  const { payload } = await requestActions({
    summaryRows: [
      buildSummaryRow({
        customer_source_id: 'customer-a',
        customer_name: 'Customer A',
        total_outstanding_base: 10000,
        overdue_outstanding_base: 10000,
      }),
      buildSummaryRow({
        customer_source_id: 'customer-b',
        customer_name: 'Customer B',
        total_outstanding_base: 5000,
        overdue_outstanding_base: 5000,
      }),
    ],
    sourceCounts: { customers: 3, invoices: 3, payments: 0 },
    currencyHealth: {
      status: 'degraded',
      rankingStatus: 'provisional',
      affectedInvoiceCount: 1,
      affectedCustomerCount: 1,
      failureReasons: { missing_rate: 1 },
    },
    reviewRequiredCustomers: [buildReviewRequiredCustomer()],
    currencyIssues: [
      {
        invoiceSourceId: 'broken-usd-invoice',
        customerSourceId: 'currency-review-customer',
        transactionCurrencyCode: 'USD',
        organisationBaseCurrencyCode: 'GBP',
        conversionStatus: 'incomplete',
        failureReason: 'missing_rate',
      },
    ],
    onCurrencyLog(params) {
      logged.push(params)
    },
  })

  assert.deepEqual(payload.rows.map((row) => row.customer_source_id), [
    'customer-a',
    'customer-b',
  ])
  assert.equal(payload.rows[0].exposure_score, 100)
  assert.equal(payload.rows[1].exposure_score, 50)
  assert.equal(payload.portfolio.totalOverdueBase, 15000)
  assert.equal(payload.portfolio.largestCustomerOverdueBase, 10000)
  assert.equal(payload.portfolio.rankingStatus, 'provisional')
  assert.equal(payload.queue.status, 'currency_data_degraded')
  assert.equal(payload.queue.rankingStatus, 'provisional')
  assert.equal(payload.queue.reviewRequiredCustomerCount, 1)
  assert.equal(payload.currencyHealth.failureReasons.missing_rate, 1)
  assert.equal(payload.reviewRequiredCustomers[0].customer_source_id, 'currency-review-customer')
  assert.equal(logged.length, 1)
  assert.equal(logged[0].route, 'collections.actions.get')
  assert.equal(logged[0].tenantId, 'queue-tenant')
})

test('missing organisation base currency makes the queue unavailable instead of assuming GBP', async () => {
  const { payload } = await requestActions({
    summaryRows: [],
    sourceCounts: { customers: 1, invoices: 1, payments: 0 },
    organisationBaseCurrency: null,
    currencyHealth: {
      status: 'unavailable',
      rankingStatus: 'unavailable',
      affectedInvoiceCount: 1,
      affectedCustomerCount: 1,
      failureReasons: { missing_organisation_base_currency: 1 },
    },
  })

  assert.deepEqual(payload.rows, [])
  assert.equal(payload.organisationBaseCurrency, null)
  assert.equal(payload.queue.status, 'currency_data_unavailable')
  assert.equal(payload.queue.rankingStatus, 'unavailable')
  assert.equal(payload.portfolio, null)
  assert.equal(payload.currencyHealth.failureReasons.missing_organisation_base_currency, 1)
})

test('partial-payment status cannot change route-level scores or queue ordering', async () => {
  const sourceCounts = { customers: 2, invoices: 2, payments: 1 }
  const makeRows = (alphaPartialPayment, zebraPartialPayment) => [
    buildSummaryRow({
      customer_source_id: 'customer-alpha',
      customer_name: 'Alpha Customer',
      has_recent_partial_payment: alphaPartialPayment,
    }),
    buildSummaryRow({
      customer_source_id: 'customer-zebra',
      customer_name: 'Zebra Customer',
      has_recent_partial_payment: zebraPartialPayment,
    }),
  ]

  const first = await requestActions({
    summaryRows: makeRows(false, true),
    sourceCounts,
  })
  const swapped = await requestActions({
    summaryRows: makeRows(true, false),
    sourceCounts,
  })

  assert.deepEqual(
    first.payload.rows.map((row) => row.customer_source_id),
    ['customer-alpha', 'customer-zebra']
  )
  assert.deepEqual(
    swapped.payload.rows.map((row) => row.customer_source_id),
    ['customer-alpha', 'customer-zebra']
  )
  assert.equal(first.payload.rows[0].base_score, first.payload.rows[1].base_score)
  assert.equal(swapped.payload.rows[0].base_score, swapped.payload.rows[1].base_score)
  assert.deepEqual(
    first.payload.rows.map((row) => row.final_score),
    swapped.payload.rows.map((row) => row.final_score)
  )
  assert.equal(
    first.payload.rows.flatMap((row) => row.score_breakdown_lines).some(
      (line) => /partial payment/i.test(line)
    ),
    false
  )
})

test('relative lateness is scored by the production engine and changes ordering', async () => {
  const { payload } = await requestActions({
    summaryRows: [
      buildSummaryRow({
        customer_source_id: 'customer-alpha',
        customer_name: 'Alpha Customer',
        historical_paid_invoice_count: 3,
        historical_normal_days_late: 54,
        relative_lateness_days: 5,
      }),
      buildSummaryRow({
        customer_source_id: 'customer-zebra',
        customer_name: 'Zebra Customer',
        historical_paid_invoice_count: 20,
        historical_normal_days_late: 39,
        relative_lateness_days: 20,
      }),
    ],
    sourceCounts: { customers: 2, invoices: 8, payments: 6 },
  })

  assert.equal(payload.queue.relativeLateness.mode, 'absolute-fallback')
  assert.equal(payload.queue.relativeLateness.materialObservationCount, 2)
  assert.deepEqual(
    payload.rows.map((row) => row.customer_source_id),
    ['customer-zebra', 'customer-alpha']
  )
  assert.equal(payload.rows[0].relative_lateness_days, 20)
  assert.ok(Math.abs(payload.rows[0].relative_lateness_score - 62.96296296296296) < 1e-9)
  assert.equal(payload.rows[0].base_score, 94.4)
  assert.equal(payload.rows[0].final_score, 94.4)
  assert.equal(payload.rows[1].relative_lateness_days, 5)
  assert.ok(Math.abs(payload.rows[1].relative_lateness_score - 7.407407407407407) < 1e-9)
  assert.equal(payload.rows[1].base_score, 86.1)
  assert.equal(payload.rows[1].final_score, 86.1)
  assert.match(payload.rows[0].score_breakdown_lines.join('\n'), /Customer-relative deterioration/)
})

test('relative-lateness portfolio context uses the full eligible queue before limiting results', async () => {
  const relativeValues = [8, 10, 12, 14, 16]
  const { payload } = await requestActions({
    summaryRows: relativeValues.map((relativeLatenessDays, index) =>
      buildSummaryRow({
        customer_source_id: `customer-${index + 1}`,
        customer_name: `Customer ${index + 1}`,
        historical_paid_invoice_count: 5,
        relative_lateness_days: relativeLatenessDays,
      })
    ),
    sourceCounts: { customers: 5, invoices: 20, payments: 15 },
    limit: 1,
  })

  assert.equal(payload.rows.length, 1)
  assert.equal(payload.queue.returnedCustomerCount, 1)
  assert.equal(payload.queue.relativeLateness.materialObservationCount, 5)
  assert.equal(payload.queue.relativeLateness.mode, 'portfolio-relative')
  assert.equal(payload.queue.relativeLateness.materialP50Days, 12)
  assert.ok(Math.abs(payload.rows[0].relative_lateness_score - 48.148148148148145) < 1e-9)
})

test('relative lateness context excludes customers suppressed from the queue', async () => {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const yesterdayTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const relativeValues = [25, 30, 35, 40, 45]
  const summaryRows = relativeValues.map((relativeLatenessDays, index) =>
    buildSummaryRow({
      customer_source_id: `customer-${index + 1}`,
      customer_name: `Customer ${index + 1}`,
      historical_paid_invoice_count: 5,
      historical_normal_days_late: 59 - relativeLatenessDays,
      relative_lateness_days: relativeLatenessDays,
    })
  )

  const { payload } = await requestActions({
    summaryRows,
    sourceCounts: { customers: 5, invoices: 20, payments: 15 },
    actionRows: [
      {
        id: 'suppress-fifth-customer',
        user_id: 'queue-user',
        tenant_id: 'queue-tenant',
        customer_source_id: 'customer-5',
        action_type: 'postponed',
        outcome: null,
        next_action_date: tomorrow,
        action_timestamp: yesterdayTimestamp,
      },
    ],
  })

  assert.equal(payload.queue.relativeLateness.materialObservationCount, 4)
  assert.equal(payload.queue.relativeLateness.mode, 'absolute-fallback')
  assert.equal(payload.rows.some((row) => row.customer_source_id === 'customer-5'), false)
  const firstCustomer = payload.rows.find((row) => row.customer_source_id === 'customer-1')
  assert.ok(Math.abs(firstCustomer.relative_lateness_score - 81.48148148148148) < 1e-9)
})

test('raw-only failure mode is reported as no mapped data rather than queue complete', async () => {
  const { payload } = await requestActions({
    summaryRows: [],
    sourceCounts: { customers: 0, invoices: 0, payments: 0 },
  })

  assert.deepEqual(payload.rows, [])
  assert.equal(payload.queue.status, 'no_mapped_data')
  assert.equal(payload.queue.eligibleCustomerCount, 0)
})

test('mapped data with no overdue receivables reports no overdue customers', async () => {
  const { payload } = await requestActions({
    summaryRows: [
      buildSummaryRow({
        open_invoices_count: 0,
        overdue_invoices_count: 0,
        total_outstanding_base: 0,
        overdue_outstanding_base: 0,
        total_outstanding: 0,
        overdue_outstanding: 0,
        oldest_overdue_invoice_date: null,
        oldest_overdue_days: null,
        weighted_avg_overdue_days: 0,
      }),
    ],
    sourceCounts: { customers: 1, invoices: 1, payments: 0 },
  })

  assert.deepEqual(payload.rows, [])
  assert.equal(payload.queue.status, 'no_overdue_customers')
})

test('queue is complete only when an eligible customer was actioned today', async () => {
  const today = new Date().toISOString().slice(0, 10)
  const { payload } = await requestActions({
    summaryRows: [buildSummaryRow()],
    sourceCounts: { customers: 1, invoices: 1, payments: 0 },
    actionRows: [
      {
        id: 'action-today',
        user_id: 'queue-user',
        tenant_id: 'queue-tenant',
        customer_source_id: 'contact-overdue',
        action_type: 'called',
        outcome: 'spoke_to_customer',
        next_action_date: null,
        action_timestamp: `${today}T10:00:00.000Z`,
      },
    ],
  })

  assert.equal(payload.queue.status, 'complete_today')
  assert.equal(payload.queue.eligibleCustomerCount, 1)
  assert.equal(payload.queue.actionedTodayCount, 1)
  assert.equal(payload.queue.remainingCustomerCount, 0)
})

test('future postpone and promise dates still suppress customers without becoming score inputs', async () => {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const yesterdayTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const summaryRows = [
    buildSummaryRow({ customer_source_id: 'postponed', customer_name: 'Postponed' }),
    buildSummaryRow({ customer_source_id: 'promised', customer_name: 'Promised' }),
    buildSummaryRow({ customer_source_id: 'called', customer_name: 'Called' }),
  ]
  const baseAction = {
    user_id: 'queue-user',
    tenant_id: 'queue-tenant',
    next_action_date: tomorrow,
    action_timestamp: yesterdayTimestamp,
  }

  const { payload } = await requestActions({
    summaryRows,
    sourceCounts: { customers: 3, invoices: 3, payments: 0 },
    actionRows: [
      {
        ...baseAction,
        id: 'action-postponed',
        customer_source_id: 'postponed',
        action_type: 'postponed',
        outcome: null,
      },
      {
        ...baseAction,
        id: 'action-promised',
        customer_source_id: 'promised',
        action_type: 'called',
        outcome: 'promised_to_pay',
      },
      {
        ...baseAction,
        id: 'action-called',
        customer_source_id: 'called',
        action_type: 'called',
        outcome: 'spoke_to_customer',
      },
    ],
  })

  assert.deepEqual(payload.rows.map((row) => row.customer_source_id), ['called'])
  assert.equal(payload.queue.suppressedCustomerCount, 2)
  assert.equal(payload.queue.remainingCustomerCount, 1)
  assert.equal(payload.queue.status, 'ready')
})

test('queue UI renders degraded review and unavailable states without hiding safe rows', async () => {
  const source = await readFile(COLLECTION_ACTIONS_CLIENT_PATH, 'utf8')

  assert.match(source, /queueInfo\?\.status === 'no_mapped_data'/)
  assert.match(source, /Collections data not ready/)
  assert.match(source, /queueInfo\?\.status === 'currency_data_unavailable'/)
  assert.match(source, /queueInfo\?\.status === 'currency_data_degraded'/)
  assert.match(source, /Currency data needs refreshing/)
  assert.match(source, /Ranking uses available currency data/)
  assert.match(source, /Needs review/)
  assert.match(source, /ReviewRequiredCustomers/)
  assert.match(source, /MultiCurrencyPlanGate/)
  assert.match(source, /equivalent overdue/)
  assert.match(source, /invoiced/)
  assert.doesNotMatch(source, /CurrencyRate/)
  assert.match(source, /queueInfo\?\.status === 'no_overdue_customers'/)
  assert.match(source, /No overdue customers/)
  assert.match(source, /queueInfo\?\.status === 'complete_today'/)
  assert.match(
    source,
    /!currentQueueRow && queueInfo\?\.status === 'complete_today'/
  )
  assert.doesNotMatch(source, /All queued customers are actioned for today/)
})
