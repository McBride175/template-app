import { loadTypeScriptModule } from './ts-module-loader.mjs'

export const USER_ID = 'journey-user'
export const TENANT_ID = 'journey-tenant'
const owner = { user_id: USER_ID, tenant_id: TENANT_ID, source_system: 'xero' }
export function daysAgo(days) {
  const date = new Date()
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

export function journeyInvoice(id, customerId, amount, extra = {}) {
  return { ...owner, id: `generation-1-${id}`, sync_run_id: 'generation-1', source_id: id,
    customer_source_id: customerId, invoice_number: `INV-${id}`, reference: `REF-${id}`,
    type: 'ACCREC', status: 'AUTHORISED', issue_date: daysAgo(100), due_date: daysAgo(30),
    fully_paid_date: null, total_native: String(amount), amount_paid_native: '0',
    amount_credited_native: '0', amount_due_native: String(amount), amount_due_base: String(amount),
    transaction_currency_code: 'GBP', organisation_base_currency_code: 'GBP',
    xero_currency_rate: null, currency_conversion_status: 'identity',
    currency_conversion_failure_reason: null, updated_at: '2026-09-20T00:00:00Z', ...extra }
}

/** Only the database/auth transport is mocked: routes, snapshot, domain, summary,
 * currency classification, scorer and first-value selection execute production code.
 * RPC transport emulation is not atomicity evidence; the real SQL test proves that.
 */
export function createDisputesJourney({ invoices = [
  journeyInvoice('a', 'acme', 10000), journeyInvoice('b', 'baker', 8000),
  journeyInvoice('c', 'cedar', 2000),
], paths = {} } = {}) {
  let userId = USER_ID
  let generation = 1
  let sequence = 0
  let plan = 'pro'
  const tables = {
    xero_sync_tenant_state: [{ ...owner, active_sync_run_id: 'generation-1', last_successful_sync_at: '2026-09-20T00:00:00Z' }],
    xero_sync_runs: [{ ...owner, id: 'generation-1', status: 'succeeded' }],
    canonical_organisations: [{ ...owner, id: 'org-1', sync_run_id: 'generation-1', base_currency_code: 'GBP' }],
    canonical_customers: [...new Set(invoices.map((row) => row.customer_source_id))].map((id) => ({
      ...owner, id: `customer-1-${id}`, sync_run_id: 'generation-1', source_id: id,
      name: `${id} Ltd`, email: null, is_customer: true, is_supplier: false, status: 'ACTIVE',
    })),
    canonical_invoices: structuredClone(invoices), canonical_payments: [], invoice_disputes: [],
    customer_overrides: [], collection_actions: [],
  }
  const calls = []
  const admin = { from(table) {
    if (!Object.hasOwn(tables, table)) throw new Error(`Unexpected fixture table: ${table}`)
    calls.push(table)
    const filters = [], orders = []
    let page = null, limit = null, changes = null, insert = null
    const run = () => {
      if (insert) {
        const keys = ['user_id', 'tenant_id', 'source_system', 'invoice_source_id']
        if (tables[table].some((row) => keys.every((key) => row[key] === insert[key]))) {
          return { data: null, error: { code: '23505' } }
        }
        tables[table].push({ id: `dispute-${++sequence}`, revision: 1,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...insert })
      }
      let rows = insert ? tables[table].slice(-1) : tables[table].filter((row) => filters.every((filter) => filter(row)))
      if (changes) for (const row of rows) Object.assign(row, changes, {
        revision: row.revision + 1, updated_at: new Date().toISOString(),
      })
      rows = [...rows].sort((a, b) => {
        for (const [key, ascending] of orders) {
          const compared = String(a[key] ?? '').localeCompare(String(b[key] ?? ''))
          if (compared) return ascending ? compared : -compared
        }
        return 0
      })
      if (page) rows = rows.slice(page[0], page[1] + 1)
      if (limit !== null) rows = rows.slice(0, limit)
      return { data: structuredClone(rows), error: null }
    }
    const query = {
      select() { return this },
      eq(key, value) { filters.push((row) => String(row[key]) === String(value)); return this },
      is(key, value) { filters.push((row) => (row[key] ?? null) === value); return this },
      in(key, values) { filters.push((row) => values.includes(row[key])); return this },
      order(key, options) { orders.push([key, options?.ascending !== false]); return this },
      range(from, to) { page = [from, to]; return this }, limit(value) { limit = value; return this },
      insert(value) { insert = value; return this }, update(value) { changes = value; return this },
      async maybeSingle() { const result = run(); return { ...result, data: result.data?.[0] ?? null } },
      async single() { return this.maybeSingle() },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject) },
    }
    return query
  }, async rpc(name, { p_user_id, p_tenant_id, p_source_system, p_rows }) {
    if (name !== 'apply_invoice_disputes_bulk_full') throw new Error(`Unexpected RPC: ${name}`)
    const find = (entry) => tables.invoice_disputes.find((row) => row.user_id === p_user_id &&
      row.tenant_id === p_tenant_id && row.source_system === p_source_system && row.invoice_source_id === entry.invoice_source_id)
    if (p_rows.some((entry) => {
      const row = find(entry)
      return row ? !row.is_active || String(row.revision) !== entry.expected_revision : entry.expected_revision !== null
    })) return { data: null, error: { message: 'invoice_disputes_revision_conflict' } }
    const result = p_rows.map((entry) => {
      const row = find(entry)
      const fields = { dispute_mode: 'full', recorded_disputed_amount_native: entry.amount_due_native,
        amount_due_at_last_review_native: entry.amount_due_native, is_active: true, resolved_at: null }
      if (row) return Object.assign(row, fields, { revision: row.revision + 1 })
      const created = { id: `dispute-${++sequence}`, user_id: p_user_id, tenant_id: p_tenant_id,
        source_system: p_source_system, invoice_source_id: entry.invoice_source_id, note: null,
        revision: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...fields }
      tables.invoice_disputes.push(created)
      return created
    })
    return { data: structuredClone(result), error: null }
  } }
  const mocks = {
    'next/server': { NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), { status: options.status ?? 200 }) } },
    '@/lib/supabase-server': { createServerSupabaseClient: async () => ({ auth: {
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    } }) },
    '@/lib/supabase-admin': { createSupabaseAdminClient: () => admin },
    '@/lib/billing/entitlements': { claimActionsEntitlementStatus: async () => ({
      tenantId: userId === USER_ID ? TENANT_ID : 'other-tenant', hasActionsAccess: true,
      isPaid: true, paidPlan: plan, usageDate: daysAgo(0),
    }) },
    '@/lib/observability/first-value-latency': { monotonicNow: () => 0, elapsedMilliseconds: () => 0, recordFirstValueLatency() {} },
    '@/lib/collections/currency-health': {
      ...loadTypeScriptModule('lib/collections/currency-health.ts'), logCollectionsCurrencyHealth() {},
    },
  }
  if (paths.summary) mocks['@/lib/collections/customer-summary'] = loadTypeScriptModule(paths.summary, { mocks })
  const mutation = loadTypeScriptModule('app/api/collections/invoice-disputes/route.ts', { mocks })
  const worklist = loadTypeScriptModule('app/api/collections/disputes/route.ts', { mocks })
  const customers = loadTypeScriptModule(paths.customers ?? 'app/api/collections/customers/route.ts', { mocks })
  const actions = loadTypeScriptModule(paths.actions ?? 'app/api/collections/actions/route.ts', { mocks })
  const { selectFirstValuePriorities } = loadTypeScriptModule('lib/collections/first-value.ts')
  const read = async (handler, path, query) => {
    const response = await handler.GET({ nextUrl: new URL(`http://localhost${path}?tenantId=${TENANT_ID}&${query}`) })
    return { status: response.status, body: await response.json() }
  }
  return { tables, calls, admin,
    setUser: (value) => { userId = value }, setPlan: (value) => { plan = value },
    override(customerId, level) { tables.customer_overrides.push({ ...owner, customer_source_id: customerId, override_level: level }) },
    async mutate(intent) {
      const response = await mutation.POST(new Request('http://localhost/api/collections/invoice-disputes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: TENANT_ID, ...intent }),
      }))
      return { status: response.status, body: await response.json() }
    },
    invoices: (customer = 'acme') => read(mutation, '/api/collections/invoice-disputes', `customerSourceId=${customer}`),
    worklist: (query = '') => read(worklist, '/api/collections/disputes', query),
    customers: (query = '') => read(customers, '/api/collections/customers', query),
    actions: (query = '') => read(actions, '/api/collections/actions', query),
    firstValue: (queue) => selectFirstValuePriorities(queue.rows, queue.actionsTakenByCustomerId),
    promote(changes = {}, absent = [], additions = []) {
      const previous = `generation-${generation++}`
      const current = `generation-${generation}`
      for (const table of ['canonical_organisations', 'canonical_customers', 'canonical_payments']) {
        tables[table].push(...tables[table].filter((row) => row.sync_run_id === previous)
          .map((row) => ({ ...row, id: `${current}-${row.source_id ?? table}`, sync_run_id: current })))
      }
      const next = tables.canonical_invoices.filter((row) => row.sync_run_id === previous && !absent.includes(row.source_id))
        .map((row) => ({ ...row, ...changes[row.source_id], id: `${current}-${row.source_id}`, sync_run_id: current,
          updated_at: `2026-09-${String(20 + generation).padStart(2, '0')}T00:00:00Z` }))
      tables.canonical_invoices.push(...next, ...additions.map((row) => ({ ...row, sync_run_id: current })))
      tables.xero_sync_runs.push({ ...owner, id: current, status: 'succeeded' })
      tables.xero_sync_tenant_state[0].active_sync_run_id = current
    },
  }
}

/** Synthetic portfolio used for a frozen pre-scoring-integration comparison. */
export function createNoDisputeParityJourney(paths = {}) {
  const app = createDisputesJourney({ paths, invoices: [
    journeyInvoice('a-old', 'acme', 10000, { due_date: daysAgo(70) }),
    journeyInvoice('a-young', 'acme', 2000, { due_date: daysAgo(10), amount_paid_native: '500', total_native: '2500' }),
    journeyInvoice('b-usd', 'baker', 20000, { due_date: daysAgo(45), transaction_currency_code: 'USD',
      amount_due_base: '4000', xero_currency_rate: '5', currency_conversion_status: 'converted' }),
    journeyInvoice('c', 'cedar', 3000, { due_date: daysAgo(20) }),
    journeyInvoice('d', 'delta', 5000, { due_date: daysAgo(90) }),
    ...[15, 20, 25].map((late, index) => journeyInvoice(`paid-${index}`, 'acme', 0, {
      status: 'PAID', due_date: daysAgo(60 + index * 10), fully_paid_date: daysAgo(60 + index * 10 - late),
      total_native: '1000', amount_paid_native: '1000',
    })),
  ] })
  app.tables.canonical_payments.push({ user_id: USER_ID, tenant_id: TENANT_ID,
    source_system: 'xero', sync_run_id: 'generation-1', invoice_source_id: 'a-young',
    customer_source_id: 'acme', payment_date: daysAgo(7) })
  app.override('baker', 'priority')
  app.override('cedar', 'safe')
  app.override('delta', 'do_not_chase')
  return app
}

/** Compare original contract fields, omitting additive fields and calendar dates. */
export async function noDisputeParityProjection(app) {
  const pick = (row, keys) => Object.fromEntries(keys.map((key) => [key, row[key]]))
  const shared = ['customer_source_id', 'total_outstanding_base_decimal', 'overdue_outstanding_base_decimal',
    'total_outstanding_base', 'overdue_outstanding_base', 'total_outstanding', 'overdue_outstanding',
    'open_invoices_count', 'overdue_invoices_count', 'weighted_avg_overdue_days',
    'relative_lateness_days', 'last_payment_days_ago', 'native_currency_breakdown', 'override_level']
  const customerFields = [...shared, 'total_invoices_count', 'oldest_overdue_days',
    'historical_paid_invoice_count', 'historical_mean_days_late', 'historical_normal_days_late', 'has_recent_partial_payment']
  const queueFields = [...shared, 'exposure_score', 'exposure_share_percent', 'exposure_relative_to_largest_percent',
    'urgency_score', 'relative_lateness_score', 'payment_recency_score', 'override_multiplier',
    'base_score', 'final_score', 'priority_score', 'recommended_action', 'reason', 'score_breakdown_lines', 'first_value_reasons']
  const customers = await app.customers()
  const actions = await app.actions()
  if (customers.status !== 200 || actions.status !== 200) throw new Error('Parity fixture failed to load')
  return {
    customers: customers.body.rows.map((row) => pick(row, customerFields)),
    queue: actions.body.rows.map((row) => pick(row, queueFields)),
    portfolio: pick(actions.body.portfolio, ['totalOverdueBase', 'totalOverdueBaseDecimal',
      'analysedOverdueBase', 'analysedOverdueBaseDecimal', 'analysedOverdueCustomerCount',
      'largestCustomerOverdueBase', 'largestCustomerOverdueBaseDecimal', 'weightedAverageOverdueDays', 'rankingStatus']),
    currencyContext: actions.body.currencyContext,
    firstValueCustomerIds: app.firstValue(actions.body).map((row) => row.customer_source_id),
  }
}
