import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const USER_ID = 'user-a'
const OTHER_USER_ID = 'user-b'
const TENANT_ID = 'tenant-a'
const OTHER_TENANT_ID = 'tenant-b'
const RUN_A = 'run-a'
const RUN_B = 'run-b'
const PROMOTED_AT = '2026-09-16T13:30:21.785631Z'

const snapshotModule = loadTypeScriptModule('lib/xero/authoritative-snapshot.ts')
const { loadCustomerCollectionsSummaryWithMetadata } = loadTypeScriptModule(
  'lib/collections/customer-summary.ts',
  { mocks: { '@/lib/supabase-server': {} } }
)

function createQuery(tableName, state) {
  const filters = []
  let limitCount = null

  const filteredRows = () => {
    const rows = state.tables[tableName] ?? []
    const filtered = rows.filter((row) => filters.every((filter) => filter(row)))
    return limitCount === null ? filtered : filtered.slice(0, limitCount)
  }

  const query = {
    select() {
      return query
    },
    eq(column, value) {
      state.calls.push({ table: tableName, operator: 'eq', column, value })
      filters.push((row) => row[column] === value)
      return query
    },
    is(column, value) {
      state.calls.push({ table: tableName, operator: 'is', column, value })
      filters.push((row) => (row[column] ?? null) === value)
      return query
    },
    order() {
      return query
    },
    limit(value) {
      limitCount = value
      return query
    },
    range(from, to) {
      const error = state.errors[tableName] ?? null
      return Promise.resolve({
        data: error ? null : filteredRows().slice(from, to + 1),
        error,
      })
    },
    maybeSingle() {
      const error = state.errors[tableName] ?? null
      const rows = filteredRows()
      const result = { data: error ? null : rows[0] ?? null, error }
      state.afterMaybeSingle?.(tableName, result)
      return Promise.resolve(result)
    },
    then(resolve, reject) {
      const error = state.errors[tableName] ?? null
      return Promise.resolve({ data: error ? null : filteredRows(), error }).then(resolve, reject)
    },
  }
  return query
}

function createDatabase(tables = {}, options = {}) {
  const state = {
    tables: {
      xero_sync_tenant_state: [],
      xero_sync_runs: [],
      xero_raw: [],
      canonical_organisations: [],
      canonical_customers: [],
      canonical_invoices: [],
      canonical_payments: [],
      ...tables,
    },
    errors: options.errors ?? {},
    calls: [],
    afterMaybeSingle: options.afterMaybeSingle,
  }

  return {
    state,
    client: {
      from(tableName) {
        state.calls.push({ table: tableName, operator: 'from' })
        return createQuery(tableName, state)
      },
    },
  }
}

function tenantState(activeSyncRunId, lastSuccessfulSyncAt = PROMOTED_AT) {
  return {
    user_id: USER_ID,
    tenant_id: TENANT_ID,
    active_sync_run_id: activeSyncRunId,
    latest_sync_run_id: RUN_B,
    last_successful_sync_at: activeSyncRunId ? lastSuccessfulSyncAt : null,
  }
}

function run(id, overrides = {}) {
  return {
    id,
    user_id: USER_ID,
    tenant_id: TENANT_ID,
    status: 'succeeded',
    ...overrides,
  }
}

function canonicalRows(syncRunId, prefix, options = {}) {
  const baseCurrency = options.baseCurrency ?? 'GBP'
  const transactionCurrency = options.transactionCurrency ?? baseCurrency
  return {
    organisation: {
      user_id: USER_ID,
      tenant_id: TENANT_ID,
      sync_run_id: syncRunId,
      base_currency_code: baseCurrency,
    },
    customer: {
      user_id: USER_ID,
      tenant_id: TENANT_ID,
      sync_run_id: syncRunId,
      source_id: `${prefix}-customer`,
      name: `${prefix} customer`,
      email: null,
      is_customer: true,
      is_supplier: false,
      status: 'ACTIVE',
    },
    invoice: {
      user_id: USER_ID,
      tenant_id: TENANT_ID,
      sync_run_id: syncRunId,
      source_id: `${prefix}-invoice`,
      customer_source_id: `${prefix}-customer`,
      type: 'ACCREC',
      status: 'AUTHORISED',
      issue_date: '2026-08-01',
      due_date: '2026-08-31',
      fully_paid_date: null,
      transaction_currency_code: transactionCurrency,
      organisation_base_currency_code: baseCurrency,
      total_native: '100',
      amount_paid_native: '0',
      amount_due_native: '100',
      amount_credited_native: '0',
      amount_due_base: transactionCurrency === baseCurrency ? '100' : '80',
      currency_conversion_status:
        transactionCurrency === baseCurrency ? 'identity' : 'converted',
      currency_conversion_failure_reason: null,
    },
    payment: {
      user_id: USER_ID,
      tenant_id: TENANT_ID,
      sync_run_id: syncRunId,
      source_id: `${prefix}-payment`,
      invoice_source_id: `${prefix}-invoice`,
      customer_source_id: `${prefix}-customer`,
      payment_date: '2026-09-01',
    },
  }
}

function completeSnapshotTables() {
  const legacy = canonicalRows(null, 'legacy', { baseCurrency: 'USD' })
  const generationA = canonicalRows(RUN_A, 'a')
  const generationAUsd = canonicalRows(RUN_A, 'a-usd', {
    baseCurrency: 'GBP',
    transactionCurrency: 'USD',
  })
  const generationB = canonicalRows(RUN_B, 'b', { baseCurrency: 'EUR' })
  return {
    xero_sync_tenant_state: [tenantState(RUN_A)],
    xero_sync_runs: [run(RUN_A), run(RUN_B, { status: 'running' })],
    canonical_organisations: [
      legacy.organisation,
      generationA.organisation,
      generationB.organisation,
    ],
    canonical_customers: [
      legacy.customer,
      generationA.customer,
      generationAUsd.customer,
      generationB.customer,
    ],
    canonical_invoices: [
      legacy.invoice,
      generationA.invoice,
      generationAUsd.invoice,
      generationB.invoice,
    ],
    canonical_payments: [legacy.payment, generationA.payment, generationB.payment],
  }
}

test('a tenant without state resolves only the explicit legacy snapshot', async () => {
  const legacyRawTime = '2026-09-15T10:00:00.000Z'
  const database = createDatabase({
    xero_raw: [
      {
        user_id: USER_ID,
        tenant_id: TENANT_ID,
        sync_run_id: null,
        fetched_at: legacyRawTime,
      },
      {
        user_id: USER_ID,
        tenant_id: TENANT_ID,
        sync_run_id: RUN_A,
        fetched_at: PROMOTED_AT,
      },
    ],
  })

  const snapshot = await snapshotModule.resolveXeroAuthoritativeSnapshot({
    supabaseAdmin: database.client,
    userId: USER_ID,
    tenantId: TENANT_ID,
  })
  assert.equal(snapshot.mode, 'legacy')
  assert.equal(snapshot.syncRunId, null)
  assert.equal(
    await snapshotModule.loadXeroAuthoritativeFreshness({
      supabaseAdmin: database.client,
      snapshot,
    }),
    legacyRawTime
  )
  assert.ok(
    database.state.calls.some(
      (call) =>
        call.table === 'xero_raw' &&
        call.operator === 'is' &&
        call.column === 'sync_run_id' &&
        call.value === null
    )
  )
})

test('an explicit null active pointer resolves only the legacy snapshot', async () => {
  const database = createDatabase({ xero_sync_tenant_state: [tenantState(null)] })
  const snapshot = await snapshotModule.resolveXeroAuthoritativeSnapshot({
    supabaseAdmin: database.client,
    userId: USER_ID,
    tenantId: TENANT_ID,
  })
  assert.equal(snapshot.mode, 'legacy')
  assert.equal(snapshot.syncRunId, null)
})

test('active generation A excludes legacy rows and inactive/latest generation B', async () => {
  const database = createDatabase(completeSnapshotTables())
  const result = await loadCustomerCollectionsSummaryWithMetadata(
    database.client,
    USER_ID,
    TENANT_ID
  )

  assert.deepEqual(result.snapshot, { mode: 'generation', syncRunId: RUN_A })
  assert.deepEqual(result.sourceCounts, { customers: 2, invoices: 2, payments: 1 })
  assert.equal(result.organisationBaseCurrency, 'GBP')
  assert.equal(result.currencyContext.mode, 'multi_currency')
  assert.deepEqual(result.currencyContext.invoicedCurrencies, ['GBP', 'USD'])
  assert.deepEqual(
    result.rows.map((row) => row.customer_source_id).sort(),
    ['a-customer', 'a-usd-customer']
  )

  for (const table of [
    'canonical_organisations',
    'canonical_customers',
    'canonical_invoices',
    'canonical_payments',
  ]) {
    assert.ok(
      database.state.calls.some(
        (call) =>
          call.table === table &&
          call.operator === 'eq' &&
          call.column === 'sync_run_id' &&
          call.value === RUN_A
      ),
      table
    )
    assert.equal(
      database.state.calls.some(
        (call) => call.table === table && call.operator === 'is' && call.column === 'sync_run_id'
      ),
      false,
      table
    )
  }
})

test('generation freshness comes only from the promoted tenant-state timestamp', async () => {
  const database = createDatabase(completeSnapshotTables())
  const snapshot = await snapshotModule.resolveXeroAuthoritativeSnapshot({
    supabaseAdmin: database.client,
    userId: USER_ID,
    tenantId: TENANT_ID,
  })
  const callCountBeforeFreshness = database.state.calls.length

  assert.equal(
    await snapshotModule.loadXeroAuthoritativeFreshness({
      supabaseAdmin: database.client,
      snapshot,
    }),
    PROMOTED_AT
  )
  assert.equal(database.state.calls.length, callCountBeforeFreshness)
})

test('Xero status reports promoted freshness and never consults legacy raw freshness', async () => {
  const publicDatabase = createDatabase({
    xero_connections_public: [
      {
        user_id: USER_ID,
        tenant_id: TENANT_ID,
        tenant_name: 'Test tenant',
        auth_state: 'active',
        last_refresh_error: null,
        reauth_required_at: null,
        updated_at: '2026-09-16T13:00:00.000Z',
      },
    ],
  })
  const adminDatabase = createDatabase(completeSnapshotTables())
  const { GET } = loadTypeScriptModule('app/api/xero/status/route.ts', {
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
            ...publicDatabase.client,
            auth: {
              async getUser() {
                return { data: { user: { id: USER_ID, email: 'test@example.com' } }, error: null }
              },
            },
          }
        },
      },
      '@/lib/supabase-admin': {
        createSupabaseAdminClient() {
          return adminDatabase.client
        },
      },
      '@/lib/xero/internal-access': {
        canAccessInternalXeroTools() {
          return false
        },
      },
    },
  })

  const response = await GET({
    nextUrl: new URL(`http://localhost/api/xero/status?tenantId=${TENANT_ID}`),
  })
  const payload = await response.json()
  assert.equal(response.status, 200)
  assert.equal(payload.lastSyncedAt, PROMOTED_AT)
  assert.deepEqual(payload.snapshot, { mode: 'generation', syncRunId: RUN_A })
  assert.equal(payload.preparation.stage, 'ready')
  assert.equal(
    adminDatabase.state.calls.some((call) => call.table === 'xero_raw'),
    false
  )
})

test('Xero status reconstructs safe preparation counts from the owned running manifest', async () => {
  const publicDatabase = createDatabase({
    xero_connections_public: [
      {
        user_id: USER_ID,
        tenant_id: TENANT_ID,
        tenant_name: 'Test tenant',
        auth_state: 'active',
        last_refresh_error: null,
        reauth_required_at: null,
        updated_at: '2026-09-17T12:00:00.000Z',
        grant_id: 'grant-a',
      },
    ],
  })
  const adminDatabase = createDatabase({
    xero_oauth_grants: [{ id: 'grant-a', user_id: USER_ID, scopes: ['accounting.transactions.read'] }],
    xero_sync_tenant_state: [{
      user_id: USER_ID,
      tenant_id: TENANT_ID,
      active_sync_run_id: null,
      latest_sync_run_id: RUN_A,
      last_successful_sync_at: null,
    }],
    xero_sync_runs: [{
      id: RUN_A,
      user_id: USER_ID,
      tenant_id: TENANT_ID,
      status: 'running',
      lease_expires_at: '2099-09-17T12:10:00.000Z',
      started_at: '2026-09-17T12:00:00.000Z',
      error_code: null,
    }],
    xero_sync_run_steps: [
      { sync_run_id: RUN_A, step_key: 'contacts', status: 'succeeded', record_count: 54 },
      { sync_run_id: RUN_A, step_key: 'authorised_accrec_invoices', status: 'succeeded', record_count: 20 },
      { sync_run_id: RUN_A, step_key: 'paid_accrec_invoices', status: 'succeeded', record_count: 27 },
      { sync_run_id: RUN_A, step_key: 'authorised_accrec_payments', status: 'succeeded', record_count: 32 },
      { sync_run_id: RUN_A, step_key: 'canonical_mapping', status: 'pending', record_count: null },
    ],
  })
  const { GET } = loadTypeScriptModule('app/api/xero/status/route.ts', {
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
            ...publicDatabase.client,
            auth: {
              async getUser() {
                return { data: { user: { id: USER_ID, email: 'test@example.com' } }, error: null }
              },
            },
          }
        },
      },
      '@/lib/supabase-admin': {
        createSupabaseAdminClient() {
          return adminDatabase.client
        },
      },
      '@/lib/xero/internal-access': {
        canAccessInternalXeroTools() {
          return false
        },
      },
    },
  })

  const response = await GET({
    nextUrl: new URL(`http://localhost/api/xero/status?tenantId=${TENANT_ID}`),
  })
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.preparation.stage, 'analysing_receivables')
  assert.deepEqual(payload.preparation.counts, { contacts: 54, invoices: 47, payments: 32 })
  assert.equal(payload.preparation.active, true)
  assert.ok(
    adminDatabase.state.calls.some(
      (call) =>
        call.table === 'xero_sync_run_steps' &&
        call.operator === 'eq' &&
        call.column === 'sync_run_id' &&
        call.value === RUN_A
    )
  )
})

test('pointer changes after resolution cannot mix generations within a logical read', async () => {
  let changed = false
  const tables = completeSnapshotTables()
  const database = createDatabase(tables, {
    afterMaybeSingle(tableName) {
      if (tableName !== 'xero_sync_tenant_state' || changed) return
      changed = true
      tables.xero_sync_tenant_state[0] = {
        ...tables.xero_sync_tenant_state[0],
        active_sync_run_id: RUN_B,
      }
    },
  })

  const result = await loadCustomerCollectionsSummaryWithMetadata(
    database.client,
    USER_ID,
    TENANT_ID
  )
  assert.deepEqual(result.snapshot, { mode: 'generation', syncRunId: RUN_A })
  assert.ok(result.rows.every((row) => row.customer_source_id.startsWith('a')))
})

for (const [name, tables, expectedCode] of [
  [
    'active pointer references a missing run',
    { xero_sync_tenant_state: [tenantState(RUN_A)] },
    'active_run_invalid',
  ],
  [
    'active run belongs to the wrong user',
    {
      xero_sync_tenant_state: [tenantState(RUN_A)],
      xero_sync_runs: [run(RUN_A, { user_id: OTHER_USER_ID })],
    },
    'active_run_invalid',
  ],
  [
    'active run belongs to the wrong tenant',
    {
      xero_sync_tenant_state: [tenantState(RUN_A)],
      xero_sync_runs: [run(RUN_A, { tenant_id: OTHER_TENANT_ID })],
    },
    'active_run_invalid',
  ],
  [
    'active run has not succeeded',
    {
      xero_sync_tenant_state: [tenantState(RUN_A)],
      xero_sync_runs: [run(RUN_A, { status: 'running' })],
    },
    'active_run_invalid',
  ],
  [
    'active pointer lacks a promotion timestamp',
    {
      xero_sync_tenant_state: [tenantState(RUN_A, null)],
      xero_sync_runs: [run(RUN_A)],
    },
    'tenant_state_inconsistent',
  ],
]) {
  test(`${name} fails closed without legacy fallback`, async () => {
    const database = createDatabase(tables)
    await assert.rejects(
      snapshotModule.resolveXeroAuthoritativeSnapshot({
        supabaseAdmin: database.client,
        userId: USER_ID,
        tenantId: TENANT_ID,
      }),
      (error) => error?.code === expectedCode
    )
    assert.equal(
      database.state.calls.some((call) => call.table.startsWith('canonical_')),
      false
    )
  })
}

test('an inaccessible active run fails closed', async () => {
  const database = createDatabase(
    {
      xero_sync_tenant_state: [tenantState(RUN_A)],
      xero_sync_runs: [run(RUN_A)],
    },
    { errors: { xero_sync_runs: { message: 'denied' } } }
  )

  await assert.rejects(
    snapshotModule.resolveXeroAuthoritativeSnapshot({
      supabaseAdmin: database.client,
      userId: USER_ID,
      tenantId: TENANT_ID,
    }),
    (error) => error?.code === 'active_run_unavailable'
  )
})

test('an inaccessible tenant-state row fails closed', async () => {
  const database = createDatabase({}, {
    errors: { xero_sync_tenant_state: { message: 'denied' } },
  })
  await assert.rejects(
    snapshotModule.resolveXeroAuthoritativeSnapshot({
      supabaseAdmin: database.client,
      userId: USER_ID,
      tenantId: TENANT_ID,
    }),
    (error) => error?.code === 'tenant_state_unavailable'
  )
})

test('unpromoted generation data is invisible to the legacy fallback', async () => {
  const generation = canonicalRows(RUN_A, 'unpromoted')
  const legacy = canonicalRows(null, 'legacy')
  const database = createDatabase({
    xero_sync_runs: [run(RUN_A, { status: 'running' })],
    canonical_organisations: [legacy.organisation, generation.organisation],
    canonical_customers: [legacy.customer, generation.customer],
    canonical_invoices: [legacy.invoice, generation.invoice],
    canonical_payments: [legacy.payment, generation.payment],
  })

  const result = await loadCustomerCollectionsSummaryWithMetadata(
    database.client,
    USER_ID,
    TENANT_ID
  )
  assert.deepEqual(result.snapshot, { mode: 'legacy', syncRunId: null })
  assert.deepEqual(result.sourceCounts, { customers: 1, invoices: 1, payments: 1 })
  assert.equal(result.rows[0].customer_source_id, 'legacy-customer')
})

test('reader authority cannot be selected with a caller-supplied run ID', async () => {
  const source = await readFile(
    new URL('../../lib/xero/authoritative-snapshot.ts', import.meta.url),
    'utf8'
  )
  assert.match(source, /active_sync_run_id/)
  const resolverSignature = source.match(
    /resolveXeroAuthoritativeSnapshot\(params: \{([\s\S]*?)\}\): Promise/
  )?.[1]
  assert.ok(resolverSignature)
  assert.doesNotMatch(resolverSignature, /syncRunId/)
  assert.match(source, /import 'server-only'/)

  assert.throws(
    () =>
      snapshotModule.applyXeroAuthoritativeSnapshot(
        {
          eq() {
            throw new Error('must not be reached')
          },
          is() {
            throw new Error('must not be reached')
          },
        },
        {
          mode: 'generation',
          syncRunId: RUN_B,
          userId: USER_ID,
          tenantId: TENANT_ID,
          lastSuccessfulSyncAt: PROMOTED_AT,
        }
      ),
    (error) => error?.code === 'snapshot_identity_mismatch'
  )
})

test('overrides and collection actions continue joining by stable Xero source identity', async () => {
  const source = await readFile(
    new URL('../../app/api/collections/actions/route.ts', import.meta.url),
    'utf8'
  )
  assert.match(source, /customer_overrides/)
  assert.match(source, /collection_actions/)
  assert.match(source, /customer_source_id/)
  assert.doesNotMatch(source, /canonical_customer_id/)
})
