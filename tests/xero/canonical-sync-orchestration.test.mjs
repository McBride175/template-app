import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBaseSyncState,
  createSyncHarness,
} from './test-helpers/xero-sync-harness.mjs'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const SYNC_LIB_PATH = new URL('../../lib/xero/sync.ts', import.meta.url)
const ACCOUNTING_LIB_PATH = new URL('../../lib/xero/accounting.ts', import.meta.url)
const CANONICAL_MAPPER_PATH = new URL('../../lib/xero/canonical-mapper.ts', import.meta.url)
const MAP_CANONICAL_ROUTE_PATH = new URL(
  '../../app/api/xero/map-canonical/route.ts',
  import.meta.url
)

function buildReadySyncState() {
  const state = buildBaseSyncState()
  const userId = 'user-sync'
  const tenantId = 'tenant-sync'
  const grantId = 'grant-sync'

  state.connections.push({
    user_id: userId,
    tenant_id: tenantId,
    grant_id: grantId,
    auth_state: 'active',
    last_refresh_error: null,
    reauth_required_at: null,
  })
  state.grants.push({
    id: grantId,
    user_id: userId,
    xero_user_id: 'xero-user-sync',
    scopes: ['accounting.transactions'],
    access_token_encrypted: 'current-access-token',
    refresh_token_encrypted: 'current-refresh-token',
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    refresh_lock_id: null,
    refresh_lock_expires_at: null,
  })

  return { state, userId, tenantId }
}

test('Xero organisation metadata uses the Organisation and Organisation/Actions resources', () => {
  const { XERO_RESOURCE_CONFIG } = loadTypeScriptModule(ACCOUNTING_LIB_PATH, {
    mocks: {
      'server-only': {},
      '@/lib/xero/server': {
        getXeroConfig() {
          throw new Error('not used by this contract test')
        },
        getXeroTokenUrl() {
          throw new Error('not used by this contract test')
        },
      },
    },
  })

  assert.deepEqual(XERO_RESOURCE_CONFIG.organisations, {
    endpoint: '/Organisation',
    responseKey: 'Organisations',
    sourceIdKey: 'OrganisationID',
  })
  assert.deepEqual(XERO_RESOURCE_CONFIG.organisation_actions, {
    endpoint: '/Organisation/Actions',
    responseKey: 'Actions',
    sourceIdKey: 'Name',
  })
})

test('successful Xero sync persists raw resources and maps the same user and tenant', async () => {
  const { state, userId, tenantId } = buildReadySyncState()
  const harness = createSyncHarness({
    syncModuleSpecifier: SYNC_LIB_PATH,
    state,
    async refreshBehavior() {
      throw new Error('refresh should not run for a current access token')
    },
    async mappingBehavior() {
      return { organisations: 1, customers: 54, invoices: 97, payments: 3 }
    },
  })

  const response = await harness.syncXeroTenantForUser({ userId, tenantId })
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.raw.fetched, {
    accounts: 1,
    contacts: 1,
    invoices: 1,
    organisations: 1,
    organisation_actions: 1,
  })
  assert.deepEqual(payload.raw.persisted, {
    accounts: 1,
    contacts: 1,
    invoices: 1,
    organisations: 1,
    organisation_actions: 1,
  })
  assert.deepEqual(payload.canonical, {
    ready: true,
    mapped: { organisations: 1, customers: 54, invoices: 97, payments: 3 },
  })
  assert.equal(state.rawRows.length, 5)
  assert.deepEqual(
    harness.fetchCalls.map((call) => call.resourceType).sort(),
    ['accounts', 'contacts', 'invoices', 'organisation_actions', 'organisations']
  )
  assert.equal(harness.mappingCalls.length, 1)
  assert.equal(harness.mappingCalls[0].userId, userId)
  assert.equal(harness.mappingCalls[0].tenantId, tenantId)
})

test('normal sync repairs the raw-populated canonical-empty regression state', async () => {
  const { state, userId, tenantId } = buildReadySyncState()
  const harness = createSyncHarness({
    syncModuleSpecifier: SYNC_LIB_PATH,
    state,
    useActualCanonicalMapper: true,
    async refreshBehavior() {
      throw new Error('refresh should not run for a current access token')
    },
    async fetchBehavior({ resourceType }) {
      if (resourceType === 'accounts') {
        return [{ id: 'account-1', AccountID: 'account-1', Name: 'Sales' }]
      }
      if (resourceType === 'contacts') {
        return [
          {
            id: 'contact-1',
            ContactID: 'contact-1',
            Name: 'Regression Customer',
            EmailAddress: 'billing@example.test',
            IsCustomer: true,
            ContactStatus: 'ACTIVE',
          },
        ]
      }
      if (resourceType === 'organisations') {
        return [
          {
            id: 'organisation-1',
            OrganisationID: 'organisation-1',
            Name: 'Regression Organisation',
            BaseCurrency: 'GBP',
            CountryCode: 'GB',
            Timezone: 'GMTSTANDARDTIME',
            Version: 'UK',
          },
        ]
      }
      if (resourceType === 'organisation_actions') {
        return [{ id: 'UseMulticurrency', Name: 'UseMulticurrency', Status: 'ALLOWED' }]
      }
      return [
        {
          id: 'invoice-1',
          InvoiceID: 'invoice-1',
          Contact: { ContactID: 'contact-1' },
          Type: 'ACCREC',
          Status: 'AUTHORISED',
          DateString: '2026-06-01',
          DueDateString: '2026-06-30',
          CurrencyCode: 'GBP',
          Total: 500,
          AmountDue: 500,
          AmountPaid: 0,
        },
      ]
    },
  })

  assert.equal(state.rawRows.length, 0)
  assert.equal(state.canonicalCustomers.length, 0)
  assert.equal(state.canonicalInvoices.length, 0)

  const firstResponse = await harness.syncXeroTenantForUser({ userId, tenantId })
  const firstPayload = await firstResponse.json()

  assert.equal(firstResponse.status, 200)
  assert.deepEqual(firstPayload.canonical.mapped, {
    organisations: 1,
    customers: 1,
    invoices: 1,
    payments: 0,
  })
  assert.equal(state.rawRows.length, 5)
  assert.equal(state.canonicalOrganisations.length, 1)
  assert.equal(state.canonicalCustomers.length, 1)
  assert.equal(state.canonicalInvoices.length, 1)
  assert.equal(state.canonicalPayments.length, 0)

  const secondResponse = await harness.syncXeroTenantForUser({ userId, tenantId })
  assert.equal(secondResponse.status, 200)
  assert.equal(state.canonicalCustomers.length, 1)
  assert.equal(state.canonicalInvoices.length, 1)
})

test('canonical mapping failure makes sync incomplete while retaining persisted raw rows', async () => {
  const { state, userId, tenantId } = buildReadySyncState()
  const harness = createSyncHarness({
    syncModuleSpecifier: SYNC_LIB_PATH,
    state,
    async refreshBehavior() {
      throw new Error('refresh should not run for a current access token')
    },
    async mappingBehavior() {
      throw new Error('canonical invoice upsert failed')
    },
  })

  const response = await harness.syncXeroTenantForUser({ userId, tenantId })
  const payload = await response.json()

  assert.equal(response.status, 500)
  assert.equal(payload.ok, undefined)
  assert.equal(payload.code, 'XERO_CANONICAL_MAPPING_FAILED')
  assert.deepEqual(payload.canonical, { ready: false })
  assert.deepEqual(payload.raw.persisted, {
    accounts: 1,
    contacts: 1,
    invoices: 1,
    organisations: 1,
    organisation_actions: 1,
  })
  assert.equal(state.rawRows.length, 5, 'raw snapshot should remain available for repair')
  assert.equal(harness.mappingCalls.length, 1)
})

function createCanonicalMapperDatabase(rawRows) {
  const canonical = {
    canonical_organisations: [],
    canonical_customers: [],
    canonical_invoices: [],
    canonical_payments: [],
  }

  function canonicalKey(row) {
    return `${row.user_id}|${row.tenant_id}|${row.source_system}|${
      row.source_id ?? row.source_organisation_id
    }`
  }

  return {
    canonical,
    from(table) {
      if (table === 'xero_raw') {
        const filters = []
        let rangeFrom = 0
        let rangeTo = 999
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
            rangeFrom = from
            rangeTo = to
            const rows = rawRows
              .filter((row) => filters.every((filter) => filter(row)))
              .sort((a, b) => a.source_id.localeCompare(b.source_id))
              .slice(rangeFrom, rangeTo + 1)
              .map(({ tenant_id, source_id, raw_json, fetched_at }) => ({
                tenant_id,
                source_id,
                raw_json,
                fetched_at,
              }))
            return Promise.resolve({ data: rows, error: null })
          },
        }
        return query
      }

      if (!Object.hasOwn(canonical, table)) {
        throw new Error(`Unsupported canonical table: ${table}`)
      }

      return {
        async upsert(rows) {
          for (const row of rows) {
            const key = canonicalKey(row)
            const existingIndex = canonical[table].findIndex(
              (candidate) => canonicalKey(candidate) === key
            )
            if (existingIndex >= 0) {
              canonical[table][existingIndex] = { ...canonical[table][existingIndex], ...row }
            } else {
              canonical[table].push({ ...row })
            }
          }
          return { error: null }
        },
      }
    },
  }
}

test('shared canonical mapping is idempotent on the same raw Xero snapshot', async () => {
  const userId = 'user-map'
  const tenantId = 'tenant-map'
  const rawRows = [
    {
      user_id: userId,
      tenant_id: tenantId,
      resource_type: 'organisations',
      source_id: 'organisation-1',
      fetched_at: '2026-09-11T08:00:00.000Z',
      raw_json: {
        OrganisationID: 'organisation-1',
        Name: 'International Receivables Ltd',
        BaseCurrency: ' gbp ',
        CountryCode: ' gb ',
        Timezone: 'GMTSTANDARDTIME',
        Version: 'UK',
      },
    },
    {
      user_id: userId,
      tenant_id: tenantId,
      resource_type: 'organisation_actions',
      source_id: 'UseMulticurrency',
      fetched_at: '2026-09-11T08:00:00.000Z',
      raw_json: { Name: 'UseMulticurrency', Status: 'ALLOWED' },
    },
    {
      user_id: userId,
      tenant_id: tenantId,
      resource_type: 'contacts',
      source_id: 'contact-1',
      fetched_at: '2026-09-11T08:00:00.000Z',
      raw_json: {
        ContactID: 'contact-1',
        Name: 'Overdue Customer',
        EmailAddress: 'billing@example.test',
        IsCustomer: true,
        IsSupplier: false,
        ContactStatus: 'ACTIVE',
      },
    },
    {
      user_id: userId,
      tenant_id: tenantId,
      resource_type: 'invoices',
      source_id: 'invoice-partial',
      fetched_at: '2026-09-11T08:00:00.000Z',
      raw_json: {
        InvoiceID: 'invoice-partial',
        Contact: { ContactID: 'contact-1' },
        Type: 'ACCREC',
        Status: 'AUTHORISED',
        InvoiceNumber: 'INV-001',
        DateString: '2026-06-01',
        DueDateString: '2026-06-30',
        CurrencyCode: ' usd ',
        CurrencyRate: '1.25',
        Total: '250.00',
        AmountDue: '125.00',
        AmountPaid: '125.00',
        AmountCredited: '0.00',
        Payments: [
          {
            PaymentID: 'payment-1',
            Amount: 125,
            Date: '2026-06-15',
            CurrencyRate: 1.2,
          },
        ],
      },
    },
    {
      user_id: userId,
      tenant_id: tenantId,
      resource_type: 'invoices',
      source_id: 'invoice-credit',
      fetched_at: '2026-09-11T08:00:00.000Z',
      raw_json: {
        InvoiceID: 'invoice-credit',
        Contact: { ContactID: 'contact-1' },
        Type: 'ACCREC',
        Status: 'AUTHORISED',
        CurrencyCode: 'EUR',
        CurrencyRate: '1.10',
        Total: '132.00',
        AmountDue: '110.00',
        AmountPaid: '0.00',
        AmountCredited: '22.00',
      },
    },
    {
      user_id: userId,
      tenant_id: tenantId,
      resource_type: 'invoices',
      source_id: 'invoice-paid',
      fetched_at: '2026-09-11T08:00:00.000Z',
      raw_json: {
        InvoiceID: 'invoice-paid',
        Contact: { ContactID: 'contact-1' },
        Type: 'ACCREC',
        Status: 'PAID',
        FullyPaidOnDate: '2026-08-01',
        CurrencyCode: 'EUR',
        CurrencyRate: '1.10',
        Total: '110.00',
        AmountDue: '0.00',
        AmountPaid: '110.00',
        AmountCredited: '0.00',
      },
    },
    {
      user_id: 'different-user',
      tenant_id: tenantId,
      resource_type: 'contacts',
      source_id: 'contact-out-of-scope',
      raw_json: { ContactID: 'contact-out-of-scope', Name: 'Wrong user' },
    },
  ]
  const database = createCanonicalMapperDatabase(rawRows)
  const { mapXeroRawToCanonical } = loadTypeScriptModule(CANONICAL_MAPPER_PATH, {
    mocks: {
      'server-only': {},
      '@/lib/supabase-admin': {
        createSupabaseAdminClient() {
          throw new Error('explicit test client should be used')
        },
      },
    },
  })

  const first = await mapXeroRawToCanonical({ userId, tenantId, supabaseAdmin: database })
  const second = await mapXeroRawToCanonical({ userId, tenantId, supabaseAdmin: database })

  assert.deepEqual(first, { organisations: 1, customers: 1, invoices: 3, payments: 1 })
  assert.deepEqual(second, first)
  assert.equal(database.canonical.canonical_organisations.length, 1)
  assert.equal(database.canonical.canonical_customers.length, 1)
  assert.equal(database.canonical.canonical_invoices.length, 3)
  assert.equal(database.canonical.canonical_payments.length, 1)
  assert.deepEqual(database.canonical.canonical_organisations[0], {
    user_id: userId,
    tenant_id: tenantId,
    source_system: 'xero',
    source_organisation_id: 'organisation-1',
    organisation_name: 'International Receivables Ltd',
    base_currency_code: 'GBP',
    country_code: 'GB',
    source_timezone: 'GMTSTANDARDTIME',
    xero_version: 'UK',
    use_multicurrency: true,
    source_retrieved_at: '2026-09-11T08:00:00.000Z',
  })

  const partialInvoice = database.canonical.canonical_invoices.find(
    (invoice) => invoice.source_id === 'invoice-partial'
  )
  assert.equal(partialInvoice.currency_code, 'usd')
  assert.equal(partialInvoice.transaction_currency_code, 'USD')
  assert.equal(partialInvoice.organisation_base_currency_code, 'GBP')
  assert.equal(partialInvoice.xero_currency_rate, '1.25')
  assert.equal(partialInvoice.total_native, '250')
  assert.equal(partialInvoice.total_base, '200.00000000')
  assert.equal(partialInvoice.amount_due_native, '125')
  assert.equal(partialInvoice.amount_due_base, '100.00000000')
  assert.equal(partialInvoice.amount_paid_base, '100.00000000')
  assert.equal(partialInvoice.currency_conversion_status, 'converted')
  assert.equal(partialInvoice.currency_conversion_failure_reason, null)

  const creditedInvoice = database.canonical.canonical_invoices.find(
    (invoice) => invoice.source_id === 'invoice-credit'
  )
  assert.equal(creditedInvoice.amount_due_base, '100.00000000')
  assert.equal(creditedInvoice.amount_credited_native, '22')
  assert.equal(creditedInvoice.amount_credited_base, '20.00000000')

  const paidInvoice = database.canonical.canonical_invoices.find(
    (invoice) => invoice.source_id === 'invoice-paid'
  )
  assert.equal(paidInvoice.currency_conversion_status, 'converted')
  assert.equal(paidInvoice.amount_due_native, '0')
  assert.equal(paidInvoice.amount_due_base, '0.00000000')
  assert.equal(paidInvoice.amount_paid_base, '100.00000000')

  assert.equal(database.canonical.canonical_payments[0].currency_rate, 1.2)
  assert.equal(database.canonical.canonical_customers[0].user_id, userId)
  assert.equal(database.canonical.canonical_customers[0].tenant_id, tenantId)
})

test('canonical repair endpoint delegates to the shared scoped mapper', async () => {
  const mappingCalls = []
  const { POST } = loadTypeScriptModule(MAP_CANONICAL_ROUTE_PATH, {
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
                return {
                  data: { user: { id: 'repair-user', email: 'ops@example.test' } },
                  error: null,
                }
              },
            },
          }
        },
      },
      '@/lib/xero/internal-access': {
        canAccessInternalXeroTools() {
          return true
        },
      },
      '@/lib/billing/entitlements': {
        async claimActionsEntitlementStatus({ preferredTenantId }) {
          return {
            hasActionsAccess: true,
            isPaid: false,
            tenantId: preferredTenantId,
            usageDaysConsumed: 1,
            freeUsageDaysLimit: 5,
            usageDate: '2026-01-01',
            usageDateConsumed: true,
          }
        },
      },
      '@/lib/xero/canonical-mapper': {
        async mapXeroRawToCanonical(params) {
          mappingCalls.push(params)
          return { organisations: 1, customers: 4, invoices: 7, payments: 0 }
        },
      },
    },
  })

  const response = await POST(
    new Request('http://localhost/api/xero/map-canonical', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: 'repair-tenant' }),
    })
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(payload.mapped, { organisations: 1, customers: 4, invoices: 7, payments: 0 })
  assert.deepEqual(mappingCalls, [{ userId: 'repair-user', tenantId: 'repair-tenant' }])
})
