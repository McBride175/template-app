import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const { loadCustomerCollectionsSummaryWithMetadata } = loadTypeScriptModule(
  'lib/collections/customer-summary.ts',
  {
    mocks: {
      '@/lib/supabase-server': {},
    },
  }
)

const USER_ID = 'currency-user'
const TENANT_ID = 'currency-tenant'

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

    assert.equal(result.currencyHealth.status, 'complete')
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

test('incomplete open foreign conversion fails aggregation closed', async () => {
  const result = await loadSummary({
    baseCurrency: 'GBP',
    customers: [customer('unsafe-customer')],
    invoices: [
      invoice({
        sourceId: 'unsafe-invoice',
        customerSourceId: 'unsafe-customer',
        transactionCurrency: 'USD',
        baseCurrency: 'GBP',
        amountDueNative: '500',
        amountDueBase: null,
        conversionStatus: 'incomplete',
        failureReason: 'missing_rate',
      }),
    ],
  })

  assert.deepEqual(result.rows, [])
  assert.equal(result.currencyHealth.status, 'incomplete')
  assert.equal(result.currencyHealth.affectedInvoiceCount, 1)
  assert.equal(result.currencyHealth.affectedCustomerCount, 1)
  assert.equal(result.currencyHealth.failureReasons.missing_rate, 1)

  const { response, payload } = await requestCustomerApi(result)
  assert.equal(response.status, 200)
  assert.deepEqual(payload.rows, [])
  assert.equal(payload.organisationBaseCurrency, 'GBP')
  assert.equal(payload.currencyHealth.status, 'incomplete')
})

test('missing authoritative organisation base currency fails aggregation closed', async () => {
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
  assert.equal(result.currencyHealth.status, 'incomplete')
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

  assert.equal(result.currencyHealth.status, 'complete')
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].historical_paid_invoice_count, 3)
  assert.equal(result.rows[0].historical_normal_days_late, 10)
  assert.equal(result.rows[0].relative_lateness_days, 20)
})
