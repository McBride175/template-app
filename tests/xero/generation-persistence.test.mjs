import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const PERSISTENCE_PATH = new URL('../../lib/xero/persistence.ts', import.meta.url)
const GENERATION_MAPPER_PATH = new URL('../../lib/xero/generation-mapper.ts', import.meta.url)

function loadPersistence() {
  return loadTypeScriptModule(PERSISTENCE_PATH, {
    mocks: {
      '@/lib/supabase-admin': {
        createSupabaseAdminClient() {
          throw new Error('tests supply an explicit database client')
        },
      },
    },
  })
}

function rawRow(syncRunId, resourceType, sourceId, rawJson) {
  return {
    sync_run_id: syncRunId,
    user_id: 'generation-user',
    tenant_id: 'generation-tenant',
    resource_type: resourceType,
    source_id: sourceId,
    raw_json: rawJson,
    fetched_at: '2026-09-15T06:30:00.000Z',
  }
}

function createGenerationDatabase(rawRows) {
  const run = {
    id: 'run-a',
    user_id: 'generation-user',
    tenant_id: 'generation-tenant',
    status: 'running',
    fencing_token: 7,
    lease_owner: 'owner-a',
    lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
  }
  const canonical = {
    organisations: [],
    customers: [],
    invoices: [],
    payments: [],
  }
  const rpcCalls = []

  function createQuery(rows) {
    const filters = []
    let range = null
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
        range = { from, to }
        return execute()
      },
      maybeSingle() {
        return execute().then(({ data, error }) => ({ data: data[0] ?? null, error }))
      },
      then(resolve, reject) {
        return execute().then(resolve, reject)
      },
    }

    function execute() {
      let data = rows.filter((row) => filters.every((filter) => filter(row)))
      data = data.slice().sort((left, right) =>
        String(left.source_id ?? left.id).localeCompare(String(right.source_id ?? right.id))
      )
      if (range) data = data.slice(range.from, range.to + 1)
      return Promise.resolve({ data: data.map((row) => ({ ...row })), error: null })
    }

    return query
  }

  return {
    canonical,
    rpcCalls,
    from(table) {
      if (table === 'xero_sync_runs') return createQuery([run])
      if (table === 'xero_raw') return createQuery(rawRows)
      throw new Error(`Unsupported table: ${table}`)
    },
    async rpc(fn, args) {
      assert.equal(fn, 'upsert_xero_generation_canonical_batch')
      rpcCalls.push({ fn, args })
      const rows = canonical[args.p_resource_type]
      const sourceKey = args.p_resource_type === 'organisations'
        ? 'source_organisation_id'
        : 'source_id'
      for (const row of args.p_rows) {
        const index = rows.findIndex(
          (candidate) =>
            candidate.sync_run_id === args.p_sync_run_id &&
            candidate[sourceKey] === row[sourceKey]
        )
        const next = {
          ...row,
          sync_run_id: args.p_sync_run_id,
          user_id: args.p_user_id,
          tenant_id: args.p_tenant_id,
        }
        if (index >= 0) rows[index] = { ...rows[index], ...next }
        else rows.push(next)
      }
      return { data: args.p_rows.length, error: null }
    },
  }
}

test('generation raw persistence requires identity, derives stable IDs, and chunks batches', async () => {
  const {
    persistXeroGenerationCanonicalRows,
    persistXeroGenerationRawBatch,
    toXeroGenerationRawRecords,
  } = loadPersistence()
  const calls = []
  const database = {
    async rpc(fn, args) {
      calls.push({ fn, args })
      return { data: args.p_rows.length, error: null }
    },
  }
  const records = Array.from({ length: 5 }, (_, index) => ({
    ContactID: `contact-${index + 1}`,
    Name: `Contact ${index + 1}`,
  }))

  const result = await persistXeroGenerationRawBatch({
    syncRunId: 'run-a',
    userId: 'generation-user',
    tenantId: 'generation-tenant',
    leaseOwner: 'owner-a',
    fencingToken: 7,
    resourceType: 'contacts',
    fetchedAt: '2026-09-15T06:30:00Z',
    records,
    chunkSize: 2,
    supabaseAdmin: database,
  })

  assert.deepEqual(result, { inputCount: 5, affectedCount: 5, batchCount: 3 })
  assert.deepEqual(calls.map((call) => call.args.p_rows.length), [2, 2, 1])
  assert.ok(calls.every((call) => call.args.p_sync_run_id === 'run-a'))
  assert.ok(calls.every((call) => call.args.p_fencing_token === 7))
  assert.deepEqual(calls[0].args.p_rows[0], {
    source_id: 'contact-1',
    raw_json: records[0],
  })

  assert.deepEqual(
    toXeroGenerationRawRecords('invoices', [
      { InvoiceID: 'invoice-x', Status: 'AUTHORISED' },
    ]),
    [
      {
        sourceId: 'invoice-x',
        rawJson: { InvoiceID: 'invoice-x', Status: 'AUTHORISED' },
      },
    ]
  )
  assert.throws(
    () => toXeroGenerationRawRecords('invoices', [{ Status: 'AUTHORISED' }]),
    /missing InvoiceID/
  )
  assert.throws(
    () => toXeroGenerationRawRecords('payments', [
      { PaymentID: 'payment-x' },
      { PaymentID: 'payment-x' },
    ]),
    /duplicate PaymentID/
  )
  await assert.rejects(
    persistXeroGenerationRawBatch({
      syncRunId: '',
      userId: 'generation-user',
      tenantId: 'generation-tenant',
      leaseOwner: 'owner-a',
      fencingToken: 7,
      resourceType: 'contacts',
      fetchedAt: '2026-09-15T06:30:00Z',
      records,
      supabaseAdmin: database,
    }),
    /syncRunId is required/
  )
  await assert.rejects(
    persistXeroGenerationCanonicalRows({
      syncRunId: 'run-a',
      userId: 'generation-user',
      tenantId: 'generation-tenant',
      leaseOwner: 'owner-a',
      fencingToken: 7,
      resourceType: 'customers',
      rows: [{ source_id: ' ', name: 'Invalid Contact' }],
      supabaseAdmin: database,
    }),
    /source_id is required for customers/
  )
})

test('legacy persistence falls back only when the new RPC is absent', async () => {
  const { persistLegacyXeroRawBatch, persistLegacyCanonicalRows } = loadPersistence()
  const upserts = []
  const database = {
    async rpc() {
      return { data: null, error: { code: 'PGRST202', message: 'function is not in schema cache' } }
    },
    from(table) {
      return {
        async upsert(rows, options) {
          upserts.push({ table, rows, options })
          return { error: null }
        },
      }
    },
  }

  const rawCount = await persistLegacyXeroRawBatch({
    userId: 'legacy-user',
    tenantId: 'legacy-tenant',
    resourceType: 'invoices',
    fetchedAt: '2026-09-15T06:30:00Z',
    rows: [{ sourceId: 'invoice-x', rawJson: { InvoiceID: 'invoice-x' } }],
    supabaseAdmin: database,
  })
  await persistLegacyCanonicalRows({
    userId: 'legacy-user',
    tenantId: 'legacy-tenant',
    resourceType: 'customers',
    rows: [
      {
        user_id: 'legacy-user',
        tenant_id: 'legacy-tenant',
        source_system: 'xero',
        source_id: 'contact-x',
        name: 'Legacy Contact',
      },
    ],
    supabaseAdmin: database,
  })

  assert.equal(rawCount, 1)
  assert.equal(upserts.length, 2)
  assert.equal(upserts[0].options.onConflict, 'user_id,tenant_id,resource_type,source_id')
  assert.equal(upserts[0].rows[0].sync_run_id, undefined)
  assert.equal(upserts[1].options.onConflict, 'user_id,tenant_id,source_system,source_id')

  await assert.rejects(
    persistLegacyXeroRawBatch({
      userId: 'legacy-user',
      tenantId: 'legacy-tenant',
      resourceType: 'contacts',
      fetchedAt: '2026-09-15T06:30:00Z',
      rows: [{ sourceId: 'contact-x', rawJson: { ContactID: 'contact-x' } }],
      supabaseAdmin: {
        async rpc() {
          return { data: null, error: { code: '42501', message: 'sensitive details' } }
        },
      },
    }),
    (error) => error.code === '42501' && !error.message.includes('sensitive details')
  )
})

test('generation mapping reads one run, preserves FX, and maps independent payments', async () => {
  const rawRows = [
    rawRow(null, 'contacts', 'legacy-contact', {
      ContactID: 'legacy-contact',
      Name: 'Legacy Contact',
    }),
    rawRow('run-b', 'contacts', 'other-contact', {
      ContactID: 'other-contact',
      Name: 'Other Generation Contact',
    }),
    rawRow('run-a', 'organisations', 'organisation-a', {
      OrganisationID: 'organisation-a',
      Name: 'Generation Organisation',
      BaseCurrency: 'GBP',
      CountryCode: 'GB',
    }),
    rawRow('run-a', 'organisation_actions', 'UseMulticurrency', {
      Name: 'UseMulticurrency',
      Status: 'ALLOWED',
    }),
    rawRow('run-a', 'contacts', 'contact-a', {
      ContactID: 'contact-a',
      Name: 'Generation Contact',
      IsCustomer: true,
    }),
    rawRow('run-a', 'invoices', 'invoice-a', {
      InvoiceID: 'invoice-a',
      Contact: { ContactID: 'contact-a' },
      Type: 'ACCREC',
      Status: 'AUTHORISED',
      DateString: '2026-08-01',
      DueDateString: '2026-08-31',
      CurrencyCode: 'USD',
      CurrencyRate: '1.25',
      Total: '250',
      AmountDue: '125',
      AmountPaid: '125',
      AmountCredited: '0',
      Payments: [{ PaymentID: 'embedded-payment', Amount: 1 }],
    }),
    rawRow('run-a', 'payments', 'payment-a', {
      PaymentID: 'payment-a',
      Invoice: { InvoiceID: 'invoice-a' },
      Status: 'AUTHORISED',
      PaymentType: 'ACCRECPAYMENT',
      Amount: '125',
      Date: '2026-08-15',
      CurrencyRate: '1.2',
      Reference: 'Bank receipt',
    }),
  ]
  const database = createGenerationDatabase(rawRows)
  const { mapXeroGenerationToCanonical } = loadTypeScriptModule(GENERATION_MAPPER_PATH, {
    mocks: {
      '@/lib/supabase-admin': {
        createSupabaseAdminClient() {
          throw new Error('tests supply an explicit database client')
        },
      },
    },
  })

  const result = await mapXeroGenerationToCanonical({
    syncRunId: 'run-a',
    userId: 'generation-user',
    tenantId: 'generation-tenant',
    leaseOwner: 'owner-a',
    fencingToken: 7,
    supabaseAdmin: database,
  })

  assert.deepEqual(result.counts, {
    organisations: 1,
    customers: 1,
    invoices: 1,
    payments: 1,
  })
  assert.deepEqual(result.validation, {
    organisationBaseCurrencyCode: 'GBP',
    incompleteFxInvoiceCount: 0,
    completeFxInvoiceCount: 1,
  })
  assert.ok(database.rpcCalls.every((call) => call.args.p_sync_run_id === 'run-a'))
  assert.equal(database.canonical.customers[0].source_id, 'contact-a')
  assert.equal(database.canonical.invoices[0].total_native, '250')
  assert.equal(database.canonical.invoices[0].total_base, '200.00000000')
  assert.equal(database.canonical.invoices[0].amount_due_base, '100.00000000')
  assert.equal(database.canonical.payments.length, 1)
  assert.equal(database.canonical.payments[0].source_id, 'payment-a')
  assert.equal(database.canonical.payments[0].invoice_source_id, 'invoice-a')
  assert.equal(database.canonical.payments[0].customer_source_id, 'contact-a')
})

test('generation mapping fails closed on organisation, contact, and payment gaps', async (t) => {
  const { mapXeroGenerationToCanonical, XeroGenerationMappingValidationError } =
    loadTypeScriptModule(GENERATION_MAPPER_PATH, {
      mocks: {
        '@/lib/supabase-admin': {
          createSupabaseAdminClient() {
            throw new Error('tests supply an explicit database client')
          },
        },
      },
    })

  const baseRows = [
    rawRow('run-a', 'organisations', 'organisation-a', {
      OrganisationID: 'organisation-a',
      BaseCurrency: 'GBP',
    }),
    rawRow('run-a', 'contacts', 'contact-a', {
      ContactID: 'contact-a',
      Name: 'Contact A',
    }),
    rawRow('run-a', 'invoices', 'invoice-a', {
      InvoiceID: 'invoice-a',
      Contact: { ContactID: 'contact-a' },
      Type: 'ACCREC',
      Status: 'AUTHORISED',
      CurrencyCode: 'GBP',
      Total: 10,
      AmountDue: 10,
    }),
  ]

  async function expectKind(rows, kind) {
    const database = createGenerationDatabase(rows)
    await assert.rejects(
      mapXeroGenerationToCanonical({
        syncRunId: 'run-a',
        userId: 'generation-user',
        tenantId: 'generation-tenant',
        leaseOwner: 'owner-a',
        fencingToken: 7,
        supabaseAdmin: database,
      }),
      (error) => error instanceof XeroGenerationMappingValidationError && error.kind === kind
    )
    assert.equal(database.rpcCalls.length, 0)
  }

  await t.test('missing organisation', () =>
    expectKind(baseRows.filter((row) => row.resource_type !== 'organisations'), 'organisation_missing')
  )
  await t.test('invalid base currency', () =>
    expectKind(
      baseRows.map((row) => row.resource_type === 'organisations'
        ? { ...row, raw_json: { ...row.raw_json, BaseCurrency: 'not-currency' } }
        : row),
      'organisation_invalid'
    )
  )
  await t.test('invoice contact absent', () =>
    expectKind(baseRows.filter((row) => row.resource_type !== 'contacts'), 'invoice_contact_missing')
  )
  await t.test('payment invoice absent', () =>
    expectKind(
      [
        ...baseRows,
        rawRow('run-a', 'payments', 'payment-a', {
          PaymentID: 'payment-a',
          Invoice: { InvoiceID: 'invoice-missing' },
          Amount: 10,
        }),
      ],
      'payment_invoice_missing'
    )
  )
})

test('missing foreign CurrencyRate remains explicitly incomplete and is never treated as 1', async () => {
  const rows = [
    rawRow('run-a', 'organisations', 'organisation-a', {
      OrganisationID: 'organisation-a',
      BaseCurrency: 'GBP',
    }),
    rawRow('run-a', 'contacts', 'contact-a', {
      ContactID: 'contact-a',
      Name: 'Contact A',
    }),
    rawRow('run-a', 'invoices', 'invoice-a', {
      InvoiceID: 'invoice-a',
      Contact: { ContactID: 'contact-a' },
      Type: 'ACCREC',
      Status: 'AUTHORISED',
      CurrencyCode: 'USD',
      Total: 100,
      AmountDue: 100,
      AmountPaid: 0,
      AmountCredited: 0,
    }),
  ]
  const database = createGenerationDatabase(rows)
  const { mapXeroGenerationToCanonical } = loadTypeScriptModule(GENERATION_MAPPER_PATH, {
    mocks: {
      '@/lib/supabase-admin': {
        createSupabaseAdminClient() {
          throw new Error('tests supply an explicit database client')
        },
      },
    },
  })

  const result = await mapXeroGenerationToCanonical({
    syncRunId: 'run-a',
    userId: 'generation-user',
    tenantId: 'generation-tenant',
    leaseOwner: 'owner-a',
    fencingToken: 7,
    supabaseAdmin: database,
  })
  const invoice = database.canonical.invoices[0]

  assert.equal(result.validation.incompleteFxInvoiceCount, 1)
  assert.equal(invoice.currency_conversion_status, 'incomplete')
  assert.equal(invoice.currency_conversion_failure_reason, 'missing_rate')
  assert.equal(invoice.xero_currency_rate, null)
  assert.equal(invoice.total_native, '100')
  assert.equal(invoice.total_base, null)
  assert.equal(invoice.amount_due_base, null)
})
