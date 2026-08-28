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
  return {
    customer_source_id: 'contact-overdue',
    customer_name: 'Overdue Customer',
    customer_email: 'billing@example.test',
    is_customer: true,
    is_supplier: false,
    status: 'ACTIVE',
    total_invoices_count: 1,
    open_invoices_count: 1,
    overdue_invoices_count: 1,
    total_outstanding: 500,
    overdue_outstanding: 500,
    oldest_overdue_invoice_date: '2026-06-30',
    oldest_overdue_days: 59,
    weighted_avg_overdue_days: 59,
    latest_invoice_date: '2026-06-01',
    latest_due_date: '2026-06-30',
    last_payment_date: null,
    last_payment_days_ago: null,
    has_recent_partial_payment: false,
    currency_code: 'GBP',
    ...overrides,
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

function loadActionsRoute({ summaryRows, sourceCounts, actionRows = [] }) {
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
          return { rows: summaryRows, sourceCounts }
        },
      },
      '@/lib/collections/tenant-context': {
        isMissingRelationError() {
          return false
        },
      },
      '@/lib/billing/entitlements': {
        async getActionsEntitlementStatus() {
          return {
            plan: 'paid',
            isPaid: true,
            tenantId: 'queue-tenant',
            usageDaysConsumed: 0,
            usageDaysRemaining: null,
            freeUsageDaysLimit: 5,
            hasActionsAccess: true,
          }
        },
        async recordFreeActionsUsageDay() {
          throw new Error('paid test entitlement should not record a usage day')
        },
      },
    },
  })
}

async function requestActions(options) {
  const { GET } = loadActionsRoute(options)
  const response = await GET({
    nextUrl: new URL(
      'http://localhost/api/collections/actions?tenantId=queue-tenant&overdueOnly=true'
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

test('empty queue UI renders reason-specific states and gates the completion summary', async () => {
  const source = await readFile(COLLECTION_ACTIONS_CLIENT_PATH, 'utf8')

  assert.match(source, /queueInfo\?\.status === 'no_mapped_data'/)
  assert.match(source, /Collections data not ready/)
  assert.match(source, /queueInfo\?\.status === 'no_overdue_customers'/)
  assert.match(source, /No overdue customers/)
  assert.match(source, /queueInfo\?\.status === 'complete_today'/)
  assert.match(
    source,
    /!currentQueueRow && queueInfo\?\.status === 'complete_today'/
  )
  assert.doesNotMatch(source, /All queued customers are actioned for today/)
})
