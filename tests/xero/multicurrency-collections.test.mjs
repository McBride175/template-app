import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const { loadCustomerCollectionsSummaryWithMetadata } = loadTypeScriptModule(
  'lib/collections/customer-summary.ts',
  {
    mocks: {
      '@/lib/supabase-server': {},
    },
  }
)
const { logCollectionsCurrencyHealth } = loadTypeScriptModule(
  'lib/collections/currency-health.ts'
)
const { resolveCollectionsCurrencyAccess } = loadTypeScriptModule(
  'lib/billing/collections-access.ts'
)

const USER_ID = 'currency-user'
const TENANT_ID = 'currency-tenant'
const CUSTOMER_COLLECTIONS_CLIENT_PATH = new URL(
  '../../app/collections/customers/CustomerCollectionsClient.tsx',
  import.meta.url
)

function daysAgoIso(days) {
  const date = new Date()
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

function customer(sourceId) {
  return {
    user_id: USER_ID,
    tenant_id: TENANT_ID,
    source_id: sourceId,
    name: sourceId,
    email: null,
    is_customer: true,
    is_supplier: false,
    status: 'ACTIVE',
  }
}

function invoice({
  sourceId,
  customerSourceId,
  transactionCurrency,
  baseCurrency,
  amountDueNative,
  amountDueBase,
  overdueDays = 30,
  status = 'AUTHORISED',
  conversionStatus = transactionCurrency === baseCurrency ? 'identity' : 'converted',
  failureReason = null,
  fullyPaidDate = null,
  totalNative = amountDueNative,
  amountPaidNative = '0',
  amountCreditedNative = '0',
  xeroCurrencyRate = null,
}) {
  return {
    user_id: USER_ID,
    tenant_id: TENANT_ID,
    source_system: 'xero',
    source_id: sourceId,
    customer_source_id: customerSourceId,
    type: 'ACCREC',
    status,
    issue_date: daysAgoIso(overdueDays + 30),
    due_date: daysAgoIso(overdueDays),
    fully_paid_date: fullyPaidDate,
    transaction_currency_code: transactionCurrency,
    organisation_base_currency_code: baseCurrency,
    total_native: totalNative,
    amount_paid_native: amountPaidNative,
    amount_due_native: amountDueNative,
    amount_credited_native: amountCreditedNative,
    amount_due_base: amountDueBase,
    xero_currency_rate: xeroCurrencyRate,
    currency_conversion_status: conversionStatus,
    currency_conversion_failure_reason: failureReason,
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
    is(column, value) {
      filters.push((row) => (row[column] ?? null) === value)
      return query
    },
    order() {
      return query
    },
    range(from, to) {
      return Promise.resolve({
        data: rows.filter((row) => filters.every((filter) => filter(row))).slice(from, to + 1),
        error: null,
      })
    },
    maybeSingle() {
      const filtered = rows.filter((row) => filters.every((filter) => filter(row)))
      return Promise.resolve({ data: filtered[0] ?? null, error: null })
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

async function loadSummary({ baseCurrency = 'GBP', customers, invoices, payments = [], disputes = [] }) {
  const tables = {
    xero_sync_tenant_state: [],
    xero_sync_runs: [],
    canonical_organisations: baseCurrency
      ? [{ user_id: USER_ID, tenant_id: TENANT_ID, base_currency_code: baseCurrency }]
      : [],
    canonical_customers: customers,
    canonical_invoices: invoices,
    canonical_payments: payments,
    invoice_disputes: disputes,
  }

  const supabase = {
    from(table) {
      if (!Object.hasOwn(tables, table)) throw new Error(`Unexpected table: ${table}`)
      return createQuery(tables[table])
    },
  }

  return loadCustomerCollectionsSummaryWithMetadata(supabase, USER_ID, TENANT_ID)
}

async function requestCustomerApi(summary, overrides = [], query = '') {
  const { GET } = loadTypeScriptModule('app/api/collections/customers/route.ts', {
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
                return { data: { user: { id: USER_ID } }, error: null }
              },
            },
          }
        },
      },
      '@/lib/supabase-admin': {
        createSupabaseAdminClient() {
          return {
            from(table) {
              if (table !== 'customer_overrides') {
                throw new Error(`Unexpected table: ${table}`)
              }
              return createQuery(overrides)
            },
          }
        },
      },
      '@/lib/billing/entitlements': {
        async claimActionsEntitlementStatus() {
          return {
            plan: 'free',
            isPaid: false,
            paidPlan: null,
            tenantId: TENANT_ID,
            hasActionsAccess: true,
          }
        },
      },
      '@/lib/collections/customer-summary': {
        async loadCustomerCollectionsSummaryWithMetadata() {
          return summary
        },
      },
      '@/lib/collections/currency-health': {
        logCollectionsCurrencyHealth() {},
      },
    },
  })

  const response = await GET({
    nextUrl: new URL(
      `http://localhost/api/collections/customers?tenantId=${TENANT_ID}&limit=200${query}`
    ),
  })
  return { response, payload: await response.json() }
}

function dispute(invoiceSourceId, mode, recordedAmount, overrides = {}) {
  return {
    id: `dispute-${invoiceSourceId}`,
    user_id: USER_ID,
    tenant_id: TENANT_ID,
    source_system: 'xero',
    invoice_source_id: invoiceSourceId,
    dispute_mode: mode,
    recorded_disputed_amount_native: recordedAmount,
    amount_due_at_last_review_native: recordedAmount,
    note: null,
    is_active: true,
    resolved_at: null,
    created_at: '2026-09-24T00:00:00Z',
    updated_at: '2026-09-24T00:00:00Z',
    ...overrides,
  }
}

async function requestActionsApi(summary, overrides = []) {
  const tables = { customer_overrides: overrides, collection_actions: [] }
  const { GET } = loadTypeScriptModule('app/api/collections/actions/route.ts', {
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
          return { auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) } }
        },
      },
      '@/lib/supabase-admin': {
        createSupabaseAdminClient() {
          return { from(table) {
            if (!Object.hasOwn(tables, table)) throw new Error(`Unexpected actions table: ${table}`)
            return createQuery(tables[table])
          } }
        },
      },
      '@/lib/billing/entitlements': {
        async claimActionsEntitlementStatus() {
          return { tenantId: TENANT_ID, hasActionsAccess: true, isPaid: true,
            paidPlan: 'pro', usageDate: new Date().toISOString().slice(0, 10) }
        },
      },
      '@/lib/collections/customer-summary': {
        async loadCustomerCollectionsSummaryWithMetadata() { return summary },
      },
      '@/lib/collections/currency-health': { logCollectionsCurrencyHealth() {} },
    },
  })
  const response = await GET({ nextUrl: new URL(`http://localhost/api/collections/actions?tenantId=${TENANT_ID}&limit=200`) })
  return { status: response.status, payload: await response.json() }
}

for (const baseCurrency of ['GBP', 'USD', 'AUD']) {
  test(`single-currency ${baseCurrency} aggregation preserves established values`, async () => {
    const result = await loadSummary({
      baseCurrency,
      customers: [customer(`customer-${baseCurrency}`)],
      invoices: [
        invoice({
          sourceId: `invoice-${baseCurrency}`,
          customerSourceId: `customer-${baseCurrency}`,
          transactionCurrency: baseCurrency,
          baseCurrency,
          amountDueNative: '250',
          amountDueBase: '250',
        }),
      ],
    })

    assert.equal(result.currencyHealth.status, 'healthy')
    assert.equal(result.currencyHealth.rankingStatus, 'complete')
    assert.deepEqual(result.reviewRequiredCustomers, [])
    assert.equal(result.organisationBaseCurrency, baseCurrency)
    assert.equal(result.rows[0].total_outstanding_base, 250)
    assert.equal(result.rows[0].overdue_outstanding_base, 250)
    assert.equal(result.rows[0].weighted_avg_overdue_days, 30)
    assert.equal(result.rows[0].organisation_base_currency_code, baseCurrency)
  })
}

test('same-customer mixed currencies use base amounts for weighted overdue age', async () => {
  const result = await loadSummary({
    baseCurrency: 'GBP',
    customers: [customer('mixed-customer')],
    invoices: [
      invoice({
        sourceId: 'usd-90-days',
        customerSourceId: 'mixed-customer',
        transactionCurrency: 'USD',
        baseCurrency: 'GBP',
        amountDueNative: '10000',
        amountDueBase: '8000.00000000',
        overdueDays: 90,
      }),
      invoice({
        sourceId: 'gbp-10-days',
        customerSourceId: 'mixed-customer',
        transactionCurrency: 'GBP',
        baseCurrency: 'GBP',
        amountDueNative: '10000',
        amountDueBase: '10000',
        overdueDays: 10,
      }),
    ],
  })

  const row = result.rows[0]
  assert.equal(result.currencyHealth.status, 'healthy')
  assert.equal(row.overdue_outstanding_base, 18_000)
  assert.ok(Math.abs(row.weighted_avg_overdue_days - 45.55555555555556) < 1e-10)
  assert.notEqual(row.weighted_avg_overdue_days, 50)
  assert.deepEqual(row.native_currency_breakdown, [
    {
      currency_code: 'GBP',
      total_outstanding_native: '10000',
      overdue_outstanding_native: '10000',
    },
    {
      currency_code: 'USD',
      total_outstanding_native: '10000',
      overdue_outstanding_native: '10000',
    },
  ])
})

test('decimal-string base amounts are summed exactly before the scoring boundary', async () => {
  const result = await loadSummary({
    baseCurrency: 'GBP',
    customers: [customer('decimal-customer')],
    invoices: [
      invoice({
        sourceId: 'decimal-a',
        customerSourceId: 'decimal-customer',
        transactionCurrency: 'GBP',
        baseCurrency: 'GBP',
        amountDueNative: '0.1',
        amountDueBase: '0.1',
      }),
      invoice({
        sourceId: 'decimal-b',
        customerSourceId: 'decimal-customer',
        transactionCurrency: 'GBP',
        baseCurrency: 'GBP',
        amountDueNative: '0.2',
        amountDueBase: '0.2',
      }),
    ],
  })

  assert.equal(result.rows[0].overdue_outstanding_base, 0.3)
  assert.equal(result.rows[0].weighted_avg_overdue_days, 30)
})

test('one broken foreign invoice degrades aggregation while safe customers remain rankable', async () => {
  const result = await loadSummary({
    baseCurrency: 'GBP',
    customers: [customer('customer-a'), customer('customer-b'), customer('customer-c')],
    invoices: [
      invoice({
        sourceId: 'valid-a',
        customerSourceId: 'customer-a',
        transactionCurrency: 'GBP',
        baseCurrency: 'GBP',
        amountDueNative: '10000',
        amountDueBase: '10000',
      }),
      invoice({
        sourceId: 'valid-b',
        customerSourceId: 'customer-b',
        transactionCurrency: 'GBP',
        baseCurrency: 'GBP',
        amountDueNative: '5000',
        amountDueBase: '5000',
      }),
      invoice({
        sourceId: 'unsafe-invoice',
        customerSourceId: 'customer-c',
        transactionCurrency: 'USD',
        baseCurrency: 'GBP',
        amountDueNative: '20000',
        amountDueBase: null,
        conversionStatus: 'incomplete',
        failureReason: 'missing_rate',
      }),
    ],
  })

  assert.deepEqual(
    result.rows.map((row) => row.customer_source_id).sort(),
    ['customer-a', 'customer-b']
  )
  assert.equal(result.currencyHealth.status, 'degraded')
  assert.equal(result.currencyHealth.rankingStatus, 'provisional')
  assert.equal(result.currencyHealth.affectedInvoiceCount, 1)
  assert.equal(result.currencyHealth.affectedCustomerCount, 1)
  assert.equal(result.currencyHealth.failureReasons.missing_rate, 1)
  assert.deepEqual(result.reviewRequiredCustomers, [
    {
      customer_source_id: 'customer-c',
      customer_name: 'customer-c',
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
    },
  ])

  const { response, payload } = await requestCustomerApi(result, [
    {
      user_id: USER_ID,
      tenant_id: TENANT_ID,
      customer_source_id: 'customer-a',
      override_level: 'priority',
    },
    {
      user_id: 'another-user',
      tenant_id: TENANT_ID,
      customer_source_id: 'customer-b',
      override_level: 'safe',
    },
  ])
  assert.equal(response.status, 200)
  assert.equal(payload.rows.length, 2)
  assert.equal(
    payload.rows.find((row) => row.customer_source_id === 'customer-a').override_level,
    'priority'
  )
  assert.equal(
    payload.rows.find((row) => row.customer_source_id === 'customer-b').override_level,
    'normal'
  )
  assert.equal(payload.reviewRequiredCustomers.length, 1)
  assert.equal(payload.organisationBaseCurrency, 'GBP')
  assert.equal(payload.currencyHealth.status, 'degraded')
  assert.equal(payload.currencyContext.mode, 'multi_currency')
  assert.deepEqual(payload.currencyContext.invoicedCurrencies, ['GBP', 'USD'])
  assert.equal(payload.currencyAccess.allowed, true)
  assert.equal(payload.currencyAccess.requiresPro, false)
})

test('a customer with both valid and broken invoices is entirely review-required', async () => {
  const result = await loadSummary({
    baseCurrency: 'GBP',
    customers: [customer('mixed-validity'), customer('safe-customer')],
    invoices: [
      invoice({
        sourceId: 'valid-small',
        customerSourceId: 'mixed-validity',
        transactionCurrency: 'GBP',
        baseCurrency: 'GBP',
        amountDueNative: '500',
        amountDueBase: '500',
      }),
      invoice({
        sourceId: 'invalid-large',
        customerSourceId: 'mixed-validity',
        transactionCurrency: 'USD',
        baseCurrency: 'GBP',
        amountDueNative: '100000',
        amountDueBase: null,
        conversionStatus: 'incomplete',
        failureReason: 'missing_rate',
      }),
      invoice({
        sourceId: 'valid-safe',
        customerSourceId: 'safe-customer',
        transactionCurrency: 'GBP',
        baseCurrency: 'GBP',
        amountDueNative: '10000',
        amountDueBase: '10000',
      }),
    ],
  })

  assert.deepEqual(result.rows.map((row) => row.customer_source_id), ['safe-customer'])
  assert.equal(result.reviewRequiredCustomers[0].customer_source_id, 'mixed-validity')
  assert.deepEqual(result.reviewRequiredCustomers[0].native_currency_breakdown, [
    {
      currency_code: 'GBP',
      total_outstanding_native: '500',
      overdue_outstanding_native: '500',
    },
    {
      currency_code: 'USD',
      total_outstanding_native: '100000',
      overdue_outstanding_native: '100000',
    },
  ])
})

test('several affected customers remain visible while valid customers aggregate', async () => {
  const result = await loadSummary({
    baseCurrency: 'GBP',
    customers: [customer('safe'), customer('broken-a'), customer('broken-b')],
    invoices: [
      invoice({
        sourceId: 'safe-gbp',
        customerSourceId: 'safe',
        transactionCurrency: 'GBP',
        baseCurrency: 'GBP',
        amountDueNative: '7500',
        amountDueBase: '7500',
      }),
      invoice({
        sourceId: 'broken-usd',
        customerSourceId: 'broken-a',
        transactionCurrency: 'USD',
        baseCurrency: 'GBP',
        amountDueNative: '1000',
        amountDueBase: null,
        conversionStatus: 'incomplete',
        failureReason: 'missing_rate',
      }),
      invoice({
        sourceId: 'broken-eur',
        customerSourceId: 'broken-b',
        transactionCurrency: 'EUR',
        baseCurrency: 'GBP',
        amountDueNative: '2000',
        amountDueBase: null,
        conversionStatus: 'incomplete',
        failureReason: 'invalid_rate',
      }),
    ],
  })

  assert.deepEqual(result.rows.map((row) => row.customer_source_id), ['safe'])
  assert.deepEqual(
    result.reviewRequiredCustomers.map((row) => row.customer_source_id),
    ['broken-a', 'broken-b']
  )
  assert.equal(result.currencyHealth.affectedInvoiceCount, 2)
  assert.equal(result.currencyHealth.affectedCustomerCount, 2)
})

test('missing authoritative organisation base currency makes aggregation unavailable', async () => {
  const result = await loadSummary({
    baseCurrency: null,
    customers: [customer('customer-without-base')],
    invoices: [
      invoice({
        sourceId: 'invoice-without-base',
        customerSourceId: 'customer-without-base',
        transactionCurrency: 'USD',
        baseCurrency: null,
        amountDueNative: '500',
        amountDueBase: null,
        conversionStatus: 'incomplete',
        failureReason: 'missing_base_currency',
      }),
    ],
  })

  assert.deepEqual(result.rows, [])
  assert.equal(result.organisationBaseCurrency, null)
  assert.equal(result.currencyHealth.status, 'unavailable')
  assert.equal(result.currencyHealth.rankingStatus, 'unavailable')
  assert.equal(result.currencyHealth.failureReasons.missing_organisation_base_currency, 1)
})

test('paid foreign history with incomplete conversion remains usable for date-only lateness', async () => {
  const historicalInvoices = [1, 2, 3].map((index) =>
    invoice({
      sourceId: `paid-history-${index}`,
      customerSourceId: 'history-customer',
      transactionCurrency: 'USD',
      baseCurrency: 'GBP',
      amountDueNative: '0',
      amountDueBase: null,
      overdueDays: 50 + index,
      status: 'PAID',
      conversionStatus: 'incomplete',
      failureReason: 'missing_rate',
      fullyPaidDate: daysAgoIso(40 + index),
      totalNative: '100',
      amountPaidNative: '100',
    })
  )
  const result = await loadSummary({
    baseCurrency: 'GBP',
    customers: [customer('history-customer')],
    invoices: [
      invoice({
        sourceId: 'current-gbp',
        customerSourceId: 'history-customer',
        transactionCurrency: 'GBP',
        baseCurrency: 'GBP',
        amountDueNative: '500',
        amountDueBase: '500',
        overdueDays: 30,
      }),
      ...historicalInvoices,
    ],
  })

  assert.equal(result.currencyHealth.status, 'healthy')
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].historical_paid_invoice_count, 3)
  assert.equal(result.rows[0].historical_normal_days_late, 10)
  assert.equal(result.rows[0].relative_lateness_days, 20)
})

test('structured currency-health logging includes diagnostic identifiers but no raw data', () => {
  const logged = []
  const originalWarn = console.warn
  console.warn = (...args) => logged.push(args)

  try {
    logCollectionsCurrencyHealth({
      route: 'collections.actions.get',
      accountId: USER_ID,
      tenantId: TENANT_ID,
      evaluation: {
        organisationBaseCurrency: 'GBP',
        currencyHealth: {
          status: 'degraded',
          rankingStatus: 'provisional',
          affectedInvoiceCount: 1,
          affectedCustomerCount: 1,
          failureReasons: { missing_rate: 1 },
        },
        affectedCustomerSourceIds: ['customer-log'],
        currencyIssues: [
          {
            invoiceSourceId: 'invoice-log',
            customerSourceId: 'customer-log',
            transactionCurrencyCode: 'USD',
            organisationBaseCurrencyCode: 'GBP',
            conversionStatus: 'incomplete',
            failureReason: 'missing_rate',
          },
        ],
      },
    })
  } finally {
    console.warn = originalWarn
  }

  assert.equal(logged.length, 1)
  assert.equal(logged[0][0], '[collections.currency_health] Currency data requires attention')
  assert.equal(logged[0][1].tenant_id, TENANT_ID)
  assert.equal(logged[0][1].issues[0].invoice_source_id, 'invoice-log')
  assert.equal(Object.hasOwn(logged[0][1], 'raw_json'), false)
  assert.equal(Object.hasOwn(logged[0][1], 'token'), false)
})

test('customer collections UI presents degraded warnings and review-required customers', async () => {
  const source = await readFile(CUSTOMER_COLLECTIONS_CLIENT_PATH, 'utf8')

  assert.match(source, /currencyHealth\?\.status === 'degraded'/)
  assert.match(source, /currencyHealth\?\.status === 'unavailable'/)
  assert.match(source, /Ranking uses available currency data/)
  assert.match(source, /Needs review/)
  assert.match(source, /Invoiced outstanding/)
  assert.match(source, /reviewRequiredCustomers\.map/)
  assert.match(source, /MultiCurrencyPlanGate/)
  assert.match(source, /Gross equivalent overdue total/)
  assert.match(source, /invoiced/)
  assert.doesNotMatch(source, /CurrencyRate/)
})

test('partial dispute changes customer and portfolio exposure from the same collectible universe', async () => {
  const customers = ['a', 'b', 'c'].map(customer)
  const invoices = [
    invoice({ sourceId: 'a-1', customerSourceId: 'a', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '10000', amountDueBase: '10000' }),
    invoice({ sourceId: 'b-1', customerSourceId: 'b', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '8000', amountDueBase: '8000' }),
    invoice({ sourceId: 'c-1', customerSourceId: 'c', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '2000', amountDueBase: '2000' }),
  ]
  const baseline = await requestActionsApi(await loadSummary({ customers, invoices }))
  assert.equal(baseline.status, 200)
  assert.equal(baseline.payload.portfolio.totalOverdueBase, 20000)
  assert.equal(baseline.payload.portfolio.largestCustomerOverdueBase, 10000)
  assert.equal(baseline.payload.rows.find((row) => row.customer_source_id === 'b').exposure_relative_to_largest_percent, 80)

  const summary = await loadSummary({ customers, invoices, disputes: [dispute('a-1', 'partial', '3000', { amount_due_at_last_review_native: '10000' })] })
  const a = summary.rows.find((row) => row.customer_source_id === 'a')
  assert.equal(a.gross_outstanding_base_decimal, '10000')
  assert.equal(a.effective_disputed_outstanding_base_decimal, '3000')
  assert.equal(a.collectible_outstanding_base_decimal, '7000')
  assert.equal(a.collectible_overdue_base_decimal, '7000')
  assert.equal(a.actionable_overdue_invoices_count, 1)
  assert.equal(a.weighted_avg_overdue_days, 30)

  const { status, payload } = await requestActionsApi(summary)
  assert.equal(status, 200)
  assert.equal(payload.portfolio.totalOverdueBase, 17000)
  assert.equal(payload.portfolio.largestCustomerOverdueBase, 8000)
  const rankedA = payload.rows.find((row) => row.customer_source_id === 'a')
  const rankedB = payload.rows.find((row) => row.customer_source_id === 'b')
  assert.equal(rankedA.overdue_outstanding_base, 10000) // gross compatibility field
  assert.equal(rankedA.collectible_overdue_base, 7000)
  assert.equal(rankedA.overdue_invoices_count, 1)
  assert.equal(rankedA.actionable_overdue_invoices_count, 1)
  assert.equal(rankedA.first_value_reasons[0].text.includes('£7,000'), true)
  assert.equal(rankedA.exposure_relative_to_largest_percent, 87.5)
  assert.equal(rankedB.exposure_relative_to_largest_percent, 100)
  assert.match(JSON.stringify([rankedA.reason, rankedA.score_breakdown_lines]), /£7,000/)
  assert.doesNotMatch(JSON.stringify([rankedA.reason, rankedA.score_breakdown_lines]), /£10,000/)
})

test('fully disputed debt leaves the queue while mixed and partially disputed invoices remain actionable', async () => {
  const customers = ['full', 'mixed', 'one-pound'].map(customer)
  const invoices = [
    invoice({ sourceId: 'full-1', customerSourceId: 'full', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '10000', amountDueBase: '10000', overdueDays: 90 }),
    invoice({ sourceId: 'mixed-1', customerSourceId: 'mixed', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '5000', amountDueBase: '5000', overdueDays: 80 }),
    invoice({ sourceId: 'mixed-2', customerSourceId: 'mixed', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '8000', amountDueBase: '8000', overdueDays: 20 }),
    invoice({ sourceId: 'one-pound-1', customerSourceId: 'one-pound', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '10000', amountDueBase: '10000', overdueDays: 40 }),
  ]
  const disputes = [
    dispute('full-1', 'full', '10000'), dispute('mixed-1', 'full', '5000'),
    dispute('one-pound-1', 'partial', '9999', { amount_due_at_last_review_native: '10000' }),
  ]
  const summary = await loadSummary({ customers, invoices, disputes })
  const full = summary.rows.find((row) => row.customer_source_id === 'full')
  const mixed = summary.rows.find((row) => row.customer_source_id === 'mixed')
  const onePound = summary.rows.find((row) => row.customer_source_id === 'one-pound')
  assert.equal(full.collectible_outstanding_base, 0)
  assert.equal(full.actionable_overdue_invoices_count, 0)
  assert.equal(full.weighted_avg_overdue_days, 0)
  assert.equal(mixed.gross_outstanding_base_decimal, '13000')
  assert.equal(mixed.effective_disputed_outstanding_base_decimal, '5000')
  assert.equal(mixed.collectible_outstanding_base_decimal, '8000')
  assert.equal(mixed.actionable_overdue_invoices_count, 1)
  assert.equal(mixed.weighted_avg_overdue_days, 20)
  assert.equal(onePound.collectible_outstanding_base_decimal, '1')
  assert.equal(onePound.actionable_overdue_invoices_count, 1)

  const { payload } = await requestActionsApi(summary, [
    { user_id: USER_ID, tenant_id: TENANT_ID, customer_source_id: 'full', override_level: 'priority' },
    { user_id: USER_ID, tenant_id: TENANT_ID, customer_source_id: 'mixed', override_level: 'priority' },
  ])
  assert.deepEqual(payload.rows.map((row) => row.customer_source_id).sort(), ['mixed', 'one-pound'])
  const prioritizedMixed = payload.rows.find((row) => row.customer_source_id === 'mixed')
  assert.equal(prioritizedMixed.override_level, 'priority')
  assert.equal(prioritizedMixed.override_multiplier, 1.6)
  assert.ok(prioritizedMixed.final_score > prioritizedMixed.base_score)
  assert.equal(payload.portfolio.totalOverdueBase, 8001)
  assert.equal(payload.portfolio.largestCustomerOverdueBase, 8000)
  assert.equal(payload.portfolio.weightedAverageOverdueDays, (8000 * 20 + 40) / 8001)
  assert.equal(prioritizedMixed.overdue_invoices_count, 2)
  assert.equal(prioritizedMixed.actionable_overdue_invoices_count, 1)
})

test('collectible weighting changes current deterioration but leaves historical timing and recency intact', async () => {
  const customers = [customer('timing')]
  const invoices = [
    invoice({ sourceId: 'old-open', customerSourceId: 'timing', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '10000', amountDueBase: '10000', overdueDays: 60 }),
    invoice({ sourceId: 'new-open', customerSourceId: 'timing', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '10000', amountDueBase: '10000', overdueDays: 10 }),
    ...[0, 1, 2].map((index) => invoice({ sourceId: `paid-history-${index}`, customerSourceId: 'timing', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '0', amountDueBase: '0', overdueDays: 40 + index, status: 'PAID', fullyPaidDate: daysAgoIso(30 + index), totalNative: '500', amountPaidNative: '500' })),
  ]
  const payments = [{ user_id: USER_ID, tenant_id: TENANT_ID, invoice_source_id: 'paid-history-0', customer_source_id: 'timing', payment_date: daysAgoIso(30) }]
  const baseline = await loadSummary({ customers, invoices, payments })
  const summary = await loadSummary({ customers, invoices, payments, disputes: [
    dispute('old-open', 'full', '10000'),
    dispute('new-open', 'partial', '5000', { amount_due_at_last_review_native: '10000' }),
  ] })
  assert.equal(baseline.rows[0].weighted_avg_overdue_days, 35)
  assert.equal(summary.rows[0].weighted_avg_overdue_days, 10)
  assert.equal(summary.rows[0].historical_normal_days_late, baseline.rows[0].historical_normal_days_late)
  assert.equal(summary.rows[0].relative_lateness_days, 0)
  assert.equal(summary.rows[0].last_payment_days_ago, baseline.rows[0].last_payment_days_ago)
  const before = await requestActionsApi(baseline)
  const after = await requestActionsApi(summary)
  assert.equal(after.payload.rows[0].payment_recency_score, before.payload.rows[0].payment_recency_score)
  assert.notEqual(after.payload.rows[0].relative_lateness_score, before.payload.rows[0].relative_lateness_score)
})

test('fully suppressed bad FX is outside scoring health while gross currency entitlement remains unchanged', async () => {
  const customers = [customer('gbp'), customer('usd')]
  const invoices = [
    invoice({ sourceId: 'gbp-1', customerSourceId: 'gbp', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '1000', amountDueBase: '1000' }),
    invoice({ sourceId: 'usd-1', customerSourceId: 'usd', transactionCurrency: 'USD', baseCurrency: 'GBP', amountDueNative: '1000', amountDueBase: null, conversionStatus: 'incomplete', failureReason: 'missing_rate' }),
  ]
  const full = await loadSummary({ customers, invoices, disputes: [dispute('usd-1', 'full', '1000')] })
  assert.equal(full.currencyHealth.status, 'healthy')
  assert.equal(full.currencyContext.mode, 'multi_currency')
  assert.equal(resolveCollectionsCurrencyAccess({
    entitlement: { hasActionsAccess: true, isPaid: true, paidPlan: 'basic' },
    currencyContext: full.currencyContext,
  }).allowed, false)
  assert.equal(full.rows.find((row) => row.customer_source_id === 'usd').gross_outstanding_base_decimal, null)
  assert.equal(full.rows.find((row) => row.customer_source_id === 'usd').total_outstanding_base, null)
  assert.equal(full.rows.find((row) => row.customer_source_id === 'usd').overdue_outstanding_base_decimal, null)
  assert.equal(full.rows.find((row) => row.customer_source_id === 'usd').native_currency_breakdown[0].total_outstanding_native, '1000')
  assert.equal((await requestActionsApi(full)).payload.rows.length, 1)

  const partial = await loadSummary({ customers, invoices, disputes: [dispute('usd-1', 'partial', '500', { amount_due_at_last_review_native: '1000' })] })
  assert.equal(partial.currencyHealth.status, 'degraded')
  assert.equal(partial.currencyHealth.affectedCustomerCount, 1)
  assert.equal(partial.currencyContext.mode, 'multi_currency')
})

test('resolving and reactivating a dispute restores and removes debt at its original age', async () => {
  const customers = [customer('again')]
  const invoices = [invoice({ sourceId: 'again-1', customerSourceId: 'again', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '6000', amountDueBase: '6000', overdueDays: 45 })]
  const resolved = await loadSummary({ customers, invoices, disputes: [dispute('again-1', 'full', '10000', { is_active: false, resolved_at: '2026-09-24T00:00:00Z' })] })
  const active = await loadSummary({ customers, invoices, disputes: [dispute('again-1', 'full', '10000', { amount_due_at_last_review_native: '6000' })] })
  assert.equal(resolved.rows[0].collectible_outstanding_base, 6000)
  assert.equal(resolved.rows[0].weighted_avg_overdue_days, 45)
  assert.equal(active.rows[0].collectible_outstanding_base, 0)
  assert.equal(active.rows[0].weighted_avg_overdue_days, 0)
  assert.equal((await requestActionsApi(active)).payload.rows.length, 0)
})

test('fully disputed old customer leaves urgency and relative-lateness portfolio benchmarks', async () => {
  const ages = [60, 50, 40, 30, 20, 10]
  const customers = ages.map((_, index) => customer(`benchmark-${index}`))
  const invoices = ages.flatMap((age, index) => [
    invoice({ sourceId: `benchmark-open-${index}`, customerSourceId: `benchmark-${index}`, transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '1000', amountDueBase: '1000', overdueDays: age }),
    ...[0, 1, 2].map((historyIndex) => invoice({ sourceId: `benchmark-paid-${index}-${historyIndex}`, customerSourceId: `benchmark-${index}`, transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '0', amountDueBase: '0', overdueDays: 40 + historyIndex, status: 'PAID', fullyPaidDate: daysAgoIso(30 + historyIndex), totalNative: '100', amountPaidNative: '100' })),
  ])
  const before = (await requestActionsApi(await loadSummary({ customers, invoices }))).payload
  assert.equal(before.portfolio.weightedAverageOverdueDays, 35)
  assert.equal(before.portfolio.totalOverdueBase, 6000)
  assert.equal(before.queue.relativeLateness.materialObservationCount, 5)
  assert.equal(before.queue.relativeLateness.mode, 'portfolio-relative')

  const after = (await requestActionsApi(await loadSummary({ customers, invoices, disputes: [
    dispute('benchmark-open-0', 'full', '1000'),
  ] }))).payload
  assert.equal(after.portfolio.weightedAverageOverdueDays, 30)
  assert.equal(after.portfolio.totalOverdueBase, 5000)
  assert.equal(after.queue.relativeLateness.materialObservationCount, 4)
  assert.equal(after.queue.relativeLateness.mode, 'absolute-fallback')
  assert.equal(after.rows.some((row) => row.customer_source_id === 'benchmark-0'), false)
})

test('partial dispute reweights two surviving overdue invoices and preserves their original ages', async () => {
  const summary = await loadSummary({
    customers: [customer('weighted')],
    invoices: [
      invoice({ sourceId: 'older', customerSourceId: 'weighted', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '10000', amountDueBase: '10000', overdueDays: 60 }),
      invoice({ sourceId: 'newer', customerSourceId: 'weighted', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '2000', amountDueBase: '2000', overdueDays: 10 }),
    ],
    disputes: [dispute('older', 'partial', '6000', { amount_due_at_last_review_native: '10000' })],
  })
  const row = summary.rows[0]
  assert.equal(row.total_outstanding_base, 12000)
  assert.equal(row.collectible_overdue_base, 6000)
  assert.equal(row.actionable_overdue_invoices_count, 2)
  assert.equal(row.oldest_overdue_days, 60)
  assert.equal(row.weighted_avg_overdue_days, (4000 * 60 + 2000 * 10) / 6000)
})

test('fully disputed oldest customer leaves the maximum urgency benchmark', async () => {
  const customers = [customer('old'), customer('mid'), customer('young')]
  const invoices = [
    invoice({ sourceId: 'old-1', customerSourceId: 'old', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '1000', amountDueBase: '1000', overdueDays: 90 }),
    invoice({ sourceId: 'mid-1', customerSourceId: 'mid', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '1000', amountDueBase: '1000', overdueDays: 40 }),
    invoice({ sourceId: 'young-1', customerSourceId: 'young', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '1000', amountDueBase: '1000', overdueDays: 20 }),
  ]
  const before = (await requestActionsApi(await loadSummary({ customers, invoices }))).payload
  const after = (await requestActionsApi(await loadSummary({ customers, invoices, disputes: [dispute('old-1', 'full', '1000')] }))).payload
  const midBefore = before.rows.find((row) => row.customer_source_id === 'mid')
  const midAfter = after.rows.find((row) => row.customer_source_id === 'mid')
  assert.match(midBefore.score_breakdown_lines.join('\n'), /portfolio max weighted avg overdue days = 90\.0/)
  assert.match(midAfter.score_breakdown_lines.join('\n'), /portfolio max weighted avg overdue days = 40\.0/)
  assert.equal(after.portfolio.weightedAverageOverdueDays, 30)
  assert.equal(after.rows.some((row) => row.customer_source_id === 'old'), false)
})

test('fully disputing one of three overdue invoices crosses the existing urgency count bonus', async () => {
  const customers = [customer('three'), customer('older')]
  const invoices = [
    ...[1, 2, 3].map((index) => invoice({ sourceId: `three-${index}`, customerSourceId: 'three', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '1000', amountDueBase: '1000', overdueDays: 30 })),
    invoice({ sourceId: 'older-1', customerSourceId: 'older', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '1000', amountDueBase: '1000', overdueDays: 60 }),
  ]
  const before = (await requestActionsApi(await loadSummary({ customers, invoices }))).payload.rows.find((row) => row.customer_source_id === 'three')
  const after = (await requestActionsApi(await loadSummary({ customers, invoices, disputes: [dispute('three-1', 'full', '1000')] }))).payload.rows.find((row) => row.customer_source_id === 'three')
  assert.equal(before.overdue_invoices_count, 3)
  assert.equal(after.overdue_invoices_count, 3) // accounting count stays gross
  assert.equal(before.actionable_overdue_invoices_count, 3)
  assert.equal(after.actionable_overdue_invoices_count, 2)
  assert.match(before.score_breakdown_lines.join('\n'), /invoice bonus 10/)
  assert.match(after.score_breakdown_lines.join('\n'), /invoice bonus 5/)
})

test('unknown gross FX never becomes zero or a complete known-invoice subtotal', async () => {
  const summary = await loadSummary({
    customers: [customer('mixed-fx')],
    invoices: [
      invoice({ sourceId: 'known', customerSourceId: 'mixed-fx', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '800', amountDueBase: '800' }),
      invoice({ sourceId: 'unknown', customerSourceId: 'mixed-fx', transactionCurrency: 'USD', baseCurrency: 'GBP', amountDueNative: '1000', amountDueBase: null, conversionStatus: 'incomplete', failureReason: 'missing_rate' }),
    ],
    disputes: [dispute('unknown', 'full', '1000')],
  })
  assert.equal(summary.currencyHealth.status, 'healthy')
  const row = summary.rows[0]
  assert.equal(row.total_outstanding_base, null)
  assert.equal(row.overdue_outstanding_base, null)
  assert.equal(row.total_outstanding_base_decimal, null)
  assert.equal(row.gross_outstanding_base_decimal, null)
  assert.equal(row.effective_disputed_outstanding_base_decimal, null)
  assert.equal(row.collectible_outstanding_base, 800)
  assert.deepEqual(row.native_currency_breakdown.map((entry) => entry.total_outstanding_native), ['800', '1000'])
  const { payload } = await requestCustomerApi(summary)
  assert.equal(payload.rows[0].total_outstanding_base, null)
  assert.equal(payload.rows[0].collectible_outstanding_base, 800)
  const recommendation = (await requestActionsApi(summary)).payload.rows[0]
  assert.equal(recommendation.total_outstanding_base, null)
  assert.equal(recommendation.overdue_outstanding_base, null)
  assert.equal(recommendation.collectible_overdue_base, 800)
})

test('gross valuation rejects mismatched invoice base currency without blocking fully suppressed scoring', async () => {
  const summary = await loadSummary({
    customers: [customer('mismatch'), customer('valid')],
    invoices: [
      invoice({ sourceId: 'wrong-base', customerSourceId: 'mismatch', transactionCurrency: 'USD', baseCurrency: 'EUR', amountDueNative: '1000', amountDueBase: '1000', xeroCurrencyRate: '1' }),
      invoice({ sourceId: 'valid-base', customerSourceId: 'valid', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '500', amountDueBase: '500' }),
    ],
    disputes: [dispute('wrong-base', 'full', '1000')],
  })
  assert.equal(summary.currencyHealth.status, 'healthy')
  const mismatch = summary.rows.find((row) => row.customer_source_id === 'mismatch')
  assert.equal(mismatch.total_outstanding_base, null)
  assert.equal(mismatch.gross_outstanding_base_decimal, null)
  assert.equal(mismatch.collectible_outstanding_base, 0)
  assert.equal(mismatch.native_currency_breakdown[0].total_outstanding_native, '1000')
  const actions = (await requestActionsApi(summary)).payload
  assert.deepEqual(actions.rows.map((row) => row.customer_source_id), ['valid'])
})

test('currency review keeps invoiced outstanding gross while classifying collectible FX failures', async () => {
  const summary = await loadSummary({
    customers: [customer('fx-review')],
    invoices: [
      invoice({ sourceId: 'partial-bad-fx', customerSourceId: 'fx-review', transactionCurrency: 'USD', baseCurrency: 'GBP', amountDueNative: '1000', amountDueBase: null, conversionStatus: 'incomplete', failureReason: 'missing_rate' }),
      invoice({ sourceId: 'full-bad-fx', customerSourceId: 'fx-review', transactionCurrency: 'USD', baseCurrency: 'GBP', amountDueNative: '500', amountDueBase: null, conversionStatus: 'incomplete', failureReason: 'missing_rate' }),
    ],
    disputes: [
      dispute('partial-bad-fx', 'partial', '400', { amount_due_at_last_review_native: '1000' }),
      dispute('full-bad-fx', 'full', '500'),
    ],
  })
  assert.equal(summary.currencyHealth.status, 'degraded')
  assert.equal(summary.currencyHealth.affectedInvoiceCount, 1)
  assert.equal(summary.reviewRequiredCustomers[0].affected_invoice_count, 1)
  assert.equal(summary.reviewRequiredCustomers[0].native_currency_breakdown[0].total_outstanding_native, '1500')
  assert.equal(summary.reviewRequiredCustomers[0].native_currency_breakdown[0].overdue_outstanding_native, '1500')
})

test('customer accounting sort and overdue filter keep their gross meanings', async () => {
  const summary = await loadSummary({
    customers: [customer('gross-high'), customer('gross-low')],
    invoices: [
      invoice({ sourceId: 'high-1', customerSourceId: 'gross-high', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '10000', amountDueBase: '10000' }),
      invoice({ sourceId: 'low-1', customerSourceId: 'gross-low', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '8000', amountDueBase: '8000' }),
    ],
    disputes: [dispute('high-1', 'full', '10000')],
  })
  const { payload } = await requestCustomerApi(summary, [], '&sortBy=overdue_outstanding&sortDir=desc&overdueOnly=true')
  assert.deepEqual(payload.rows.map((row) => row.customer_source_id), ['gross-high', 'gross-low'])
  assert.equal(payload.rows[0].overdue_outstanding_base, 10000)
  assert.equal(payload.rows[0].collectible_overdue_base, 0)
  assert.equal(payload.rows[0].overdue_invoices_count, 1)
  assert.equal(payload.rows[0].actionable_overdue_invoices_count, 0)
})

test('priority deep link retains an owned customer beyond the customer list page', async () => {
  const summary = await loadSummary({
    customers: [customer('c001')],
    invoices: [invoice({ sourceId: 'i001', customerSourceId: 'c001', transactionCurrency: 'GBP', baseCurrency: 'GBP', amountDueNative: '100', amountDueBase: '100' })],
  })
  const template = summary.rows[0]
  summary.rows = Array.from({ length: 201 }, (_, index) => ({
    ...template,
    customer_source_id: `c${String(index + 1).padStart(3, '0')}`,
    customer_name: `Customer ${String(index + 1).padStart(3, '0')}`,
  }))
  const { payload } = await requestCustomerApi(summary, [], '&customerSourceId=c201')
  assert.equal(payload.rows.length, 201)
  assert.equal(payload.rows.at(-1).customer_source_id, 'c201')
  const foreign = await requestCustomerApi(summary, [], '&customerSourceId=foreign-tenant-customer')
  assert.equal(foreign.payload.rows.length, 200)
})
