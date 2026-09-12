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
}) {
  return {
    user_id: USER_ID,
    tenant_id: TENANT_ID,
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
    order() {
      return query
    },
    range(from, to) {
      return Promise.resolve({
        data: rows.filter((row) => filters.every((filter) => filter(row))).slice(from, to + 1),
        error: null,
      })
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

async function loadSummary({ baseCurrency = 'GBP', customers, invoices, payments = [] }) {
  const tables = {
    canonical_organisations: baseCurrency
      ? [{ user_id: USER_ID, tenant_id: TENANT_ID, base_currency_code: baseCurrency }]
      : [],
    canonical_customers: customers,
    canonical_invoices: invoices,
    canonical_payments: payments,
  }

  const supabase = {
    from(table) {
      if (!Object.hasOwn(tables, table)) throw new Error(`Unexpected table: ${table}`)
      return createQuery(tables[table])
    },
  }

  return loadCustomerCollectionsSummaryWithMetadata(supabase, USER_ID, TENANT_ID)
}

async function requestCustomerApi(summary) {
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
          return {}
        },
      },
      '@/lib/billing/entitlements': {
        async claimActionsEntitlementStatus() {
          return {
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
      `http://localhost/api/collections/customers?tenantId=${TENANT_ID}&limit=200`
    ),
  })
  return { response, payload: await response.json() }
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

  const { response, payload } = await requestCustomerApi(result)
  assert.equal(response.status, 200)
  assert.equal(payload.rows.length, 2)
  assert.equal(payload.reviewRequiredCustomers.length, 1)
  assert.equal(payload.organisationBaseCurrency, 'GBP')
  assert.equal(payload.currencyHealth.status, 'degraded')
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
  assert.match(source, /Native outstanding/)
  assert.match(source, /reviewRequiredCustomers\.map/)
})
