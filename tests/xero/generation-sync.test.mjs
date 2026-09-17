import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const MODULE_PATH = new URL('../../lib/xero/generation-sync.ts', import.meta.url)

class ImportError extends Error {
  constructor({ code, resource = null, runId = null }) {
    super(code)
    this.code = code
    this.resource = resource
    this.runId = runId
  }
}

function nextServerMock() {
  return {
    NextResponse: {
      json(body, init = {}) {
        return new Response(JSON.stringify(body), {
          status: init.status ?? 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    },
  }
}

function loadSyncModule() {
  return loadTypeScriptModule(MODULE_PATH, {
    mocks: {
      'next/server': nextServerMock(),
      '@/lib/supabase-admin': { createSupabaseAdminClient() { return {} } },
      '@/lib/xero/generation-importer': {
        XERO_GENERATION_IMPORT_DEFAULT_LEASE_TTL_SECONDS: 300,
        XeroGenerationImportError: ImportError,
        async importXeroGeneration() { throw new Error('inject importGeneration') },
      },
      '@/lib/xero/generation-readiness': {
        XERO_GENERATION_READINESS_CONTRACT_VERSION: 'collections_readiness_v2',
        async inspectXeroGenerationReadiness() { throw new Error('inject inspectReadiness') },
      },
      '@/lib/xero/generation-run': {
        async failXeroGenerationRun() { throw new Error('inject failRun') },
        async heartbeatXeroGenerationRun() { throw new Error('inject heartbeatRun') },
        async promoteXeroGenerationRun() { throw new Error('inject promoteRun') },
      },
    },
  })
}

const userId = '00000000-0000-4000-8000-000000000001'
const tenantId = '00000000-0000-4000-8000-000000000002'
const grantId = '00000000-0000-4000-8000-000000000003'
const runId = '00000000-0000-4000-8000-000000000004'
const leaseOwner = '00000000-0000-4000-8000-000000000005'

function granularScopes() {
  return [
    'offline_access',
    'accounting.settings.read',
    'accounting.contacts.read',
    'accounting.invoices.read',
    'accounting.payments.read',
  ]
}

function createSupabase(overrides = {}) {
  const rows = {
    xero_connections_public: {
      user_id: userId,
      tenant_id: tenantId,
      grant_id: grantId,
      auth_state: 'active',
      ...overrides.connection,
    },
    xero_oauth_grants: {
      id: grantId,
      user_id: userId,
      scopes: granularScopes(),
      ...overrides.grant,
    },
  }
  return {
    from(table) {
      const query = {
        select() { return query },
        eq() { return query },
        async maybeSingle() {
          return { data: rows[table] ?? null, error: overrides.errors?.[table] ?? null }
        },
      }
      return query
    },
  }
}

function readyResult(overrides = {}) {
  return {
    status: 'ready_for_promotion',
    runId,
    fencingToken: 7,
    leaseExpiresAt: '2026-09-16T15:05:00Z',
    counts: {
      organisation: 1,
      contacts: 3,
      authorisedInvoices: 2,
      paidInvoices: 1,
      payments: 2,
      canonical: { organisations: 1, customers: 3, invoices: 3, payments: 2 },
    },
    validation: { organisationBaseCurrencyCode: 'GBP', incompleteFxInvoiceCount: 0 },
    readiness: {
      validated: true,
      resultCode: 'validated',
      validationId: '00000000-0000-4000-8000-000000000006',
      validatedAt: '2026-09-16T15:00:00Z',
      contractVersion: 'collections_readiness_v2',
      fencingToken: 7,
      baseCurrencyCode: 'GBP',
      incompleteFxInvoiceCount: 0,
      fxViolationCount: 0,
    },
    diagnostics: { runStartedAt: '2026-09-16T14:58:00Z' },
    ...overrides,
  }
}

function inspectedReadiness(overrides = {}) {
  return {
    ready: true,
    resultCode: 'ready',
    contractVersion: 'collections_readiness_v2',
    baseCurrencyCode: 'GBP',
    counts: {
      rawOrganisations: 1,
      rawContacts: 3,
      rawAuthorisedInvoices: 2,
      rawPaidInvoices: 1,
      rawPayments: 2,
      canonicalOrganisations: 1,
      canonicalCustomers: 3,
      canonicalInvoices: 3,
      canonicalPayments: 2,
    },
    violations: { incompleteFxInvoices: 0, source: 0, reconciliation: 0, relationships: 0, fx: 0 },
    ...overrides,
  }
}

function dependencies(overrides = {}) {
  return {
    createSupabaseAdminClient: () => createSupabase(),
    randomUUID: () => leaseOwner,
    importGeneration: async () => readyResult(),
    heartbeatRun: async () => ({ renewed: true, resultCode: 'renewed', leaseExpiresAt: '2026-09-16T15:10:00Z' }),
    inspectReadiness: async () => inspectedReadiness(),
    promoteRun: async () => ({ promoted: true, resultCode: 'promoted', promotedAt: '2026-09-16T15:01:00Z' }),
    failRun: async () => ({ failed: true, resultCode: 'failed' }),
    ...overrides,
  }
}

test('normal sync promotes exactly once under the importer fence and reports success only afterward', async () => {
  const sync = loadSyncModule()
  const events = []
  let importCalls = 0
  let promoteCalls = 0
  const response = await sync.syncXeroAuthoritatively({
    userId,
    tenantId,
    dependencies: dependencies({
      importGeneration: async (params) => {
        importCalls += 1
        events.push(['import', params.leaseOwner])
        return readyResult()
      },
      heartbeatRun: async (params) => {
        events.push(['heartbeat', params.fencingToken, params.leaseOwner])
        return { renewed: true, resultCode: 'renewed', leaseExpiresAt: '2026-09-16T15:10:00Z' }
      },
      inspectReadiness: async () => {
        events.push(['inspect'])
        return inspectedReadiness()
      },
      promoteRun: async (params) => {
        promoteCalls += 1
        events.push(['promote', params.fencingToken, params.leaseOwner])
        assert.equal(params.snapshotAsOf, '2026-09-16T14:58:00Z')
        return { promoted: true, resultCode: 'promoted', promotedAt: '2026-09-16T15:01:00Z' }
      },
    }),
  })
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.code, 'XERO_GENERATION_PROMOTED')
  assert.equal(payload.runId, runId)
  assert.equal(importCalls, 1)
  assert.equal(promoteCalls, 1)
  assert.deepEqual(events, [
    ['import', leaseOwner],
    ['heartbeat', 7, leaseOwner],
    ['inspect'],
    ['promote', 7, leaseOwner],
  ])
})

test('capability preflight fails before acquiring/importing a generation', async () => {
  const sync = loadSyncModule()
  let importCalls = 0
  const response = await sync.syncXeroAuthoritatively({
    userId,
    tenantId,
    dependencies: dependencies({
      createSupabaseAdminClient: () => createSupabase({
        grant: { scopes: granularScopes().filter((scope) => scope !== 'accounting.payments.read') },
      }),
      importGeneration: async () => {
        importCalls += 1
        return readyResult()
      },
    }),
  })

  assert.equal(response.status, 403)
  assert.equal((await response.json()).code, 'XERO_PERMISSION_UPGRADE_REQUIRED')
  assert.equal(importCalls, 0)
})

test('a held generation lease fails safely without promotion', async () => {
  const sync = loadSyncModule()
  let promoteCalls = 0
  const response = await sync.syncXeroAuthoritatively({
    userId,
    tenantId,
    dependencies: dependencies({
      importGeneration: async () => ({
        status: 'lease_held', runId: null, fencingToken: null, leaseExpiresAt: '2026-09-16T15:05:00Z',
      }),
      promoteRun: async () => {
        promoteCalls += 1
        throw new Error('must not promote')
      },
    }),
  })

  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'XERO_GENERATION_SYNC_IN_PROGRESS')
  assert.equal(promoteCalls, 0)
})

test('provider/import failure is not retried and cannot promote', async () => {
  const sync = loadSyncModule()
  let importCalls = 0
  let promoteCalls = 0
  const response = await sync.syncXeroAuthoritatively({
    userId,
    tenantId,
    dependencies: dependencies({
      importGeneration: async () => {
        importCalls += 1
        throw new ImportError({ code: 'provider_unavailable', resource: 'contacts', runId })
      },
      promoteRun: async () => {
        promoteCalls += 1
        throw new Error('must not promote')
      },
    }),
  })

  assert.equal(response.status, 503)
  assert.equal((await response.json()).code, 'XERO_PROVIDER_UNAVAILABLE')
  assert.equal(importCalls, 1)
  assert.equal(promoteCalls, 0)
})

test('incomplete FX evidence fails closed before heartbeat and promotion', async () => {
  const sync = loadSyncModule()
  let heartbeatCalls = 0
  let promoteCalls = 0
  let failCalls = 0
  const result = readyResult({
    readiness: { ...readyResult().readiness, incompleteFxInvoiceCount: 1, fxViolationCount: 1 },
  })
  const response = await sync.syncXeroAuthoritatively({
    userId,
    tenantId,
    dependencies: dependencies({
      importGeneration: async () => result,
      heartbeatRun: async () => { heartbeatCalls += 1 },
      promoteRun: async () => { promoteCalls += 1 },
      failRun: async () => { failCalls += 1; return { failed: true, resultCode: 'failed' } },
    }),
  })

  assert.equal(response.status, 422)
  assert.equal((await response.json()).code, 'XERO_GENERATION_VALIDATION_FAILED')
  assert.equal(heartbeatCalls, 0)
  assert.equal(promoteCalls, 0)
  assert.equal(failCalls, 1)
})

test('lease loss before promotion preserves the active generation', async () => {
  const sync = loadSyncModule()
  const state = { activeRunId: 'generation-a' }
  let promoteCalls = 0
  const response = await sync.syncXeroAuthoritatively({
    userId,
    tenantId,
    dependencies: dependencies({
      heartbeatRun: async () => ({ renewed: false, resultCode: 'superseded', leaseExpiresAt: null }),
      promoteRun: async () => {
        promoteCalls += 1
        state.activeRunId = runId
        return { promoted: true, resultCode: 'promoted', promotedAt: 'now' }
      },
    }),
  })

  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'XERO_GENERATION_LEASE_LOST')
  assert.equal(promoteCalls, 0)
  assert.equal(state.activeRunId, 'generation-a')
})

for (const scenario of [
  {
    name: 'readiness recheck failure',
    dependencies: { inspectReadiness: async () => inspectedReadiness({ ready: false, resultCode: 'fx_incomplete' }) },
    expectedStatus: 422,
    expectedCode: 'XERO_GENERATION_VALIDATION_FAILED',
  },
  {
    name: 'promotion race rejection',
    dependencies: { promoteRun: async () => ({ promoted: false, resultCode: 'active_generation_changed', promotedAt: null }) },
    expectedStatus: 409,
    expectedCode: 'XERO_GENERATION_PROMOTION_REJECTED',
  },
]) {
  test(`${scenario.name} leaves the prior active generation authoritative`, async () => {
    const sync = loadSyncModule()
    const state = { activeRunId: 'generation-a' }
    let importCalls = 0
    const response = await sync.syncXeroAuthoritatively({
      userId,
      tenantId,
      dependencies: dependencies({
        importGeneration: async () => { importCalls += 1; return readyResult() },
        ...scenario.dependencies,
      }),
    })

    const payload = await response.json()
    assert.equal(response.status, scenario.expectedStatus)
    assert.equal(payload.code, scenario.expectedCode)
    assert.equal(importCalls, 1)
    assert.equal(state.activeRunId, 'generation-a')
  })
}

test('first successful generation becomes active while a failed first generation fabricates no snapshot', async () => {
  const sync = loadSyncModule()
  const successfulState = { activeRunId: null }
  const successfulResponse = await sync.syncXeroAuthoritatively({
    userId,
    tenantId,
    dependencies: dependencies({
      promoteRun: async () => {
        successfulState.activeRunId = runId
        return { promoted: true, resultCode: 'promoted', promotedAt: '2026-09-16T15:01:00Z' }
      },
    }),
  })
  assert.equal(successfulResponse.status, 200)
  assert.equal(successfulState.activeRunId, runId)

  const failedState = { activeRunId: null }
  const failedResponse = await sync.syncXeroAuthoritatively({
    userId,
    tenantId,
    dependencies: dependencies({
      importGeneration: async () => {
        throw new ImportError({ code: 'provider_data_invalid', runId })
      },
    }),
  })
  assert.equal(failedResponse.status, 502)
  assert.equal(failedState.activeRunId, null)
})

test('normal sync code has no legacy persistence or recovery reacquisition path', async () => {
  const source = await readFile(MODULE_PATH, 'utf8')
  assert.doesNotMatch(source, /syncXeroTenantForUser|upsert_xero_legacy|sync_run_id\s+is\s+null/i)
  assert.doesNotMatch(source, /reacquireXeroGenerationRunForPromotion|reacquire_xero_sync_run_for_promotion/)
  assert.match(source, /importGeneration/)
  assert.match(source, /inspectReadiness/)
  assert.match(source, /promoteRun/)
})
