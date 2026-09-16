import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const MODULE_PATH = new URL('../../lib/xero/generation-revalidation-operator.ts', import.meta.url)
const BASE_OPERATOR_PATH = new URL('../../lib/xero/generation-operator.ts', import.meta.url)
const SCRIPT_PATH = new URL('../../scripts/xero-generation-revalidate.ts', import.meta.url)
const TEST_REF = 'rbmxegyiwntomhpbepnu'
const PRODUCTION_REF = 'sswyxbugbdoadktyaows'
const userId = '81c01b0b-8864-4b72-aa17-236f74ba38d1'
const tenantId = 'a61ccfea-548c-49f1-ae5a-11c3e1035ce3'
const grantId = '32022401-fcf9-41ef-ab4e-92821edce5ac'
const runId = 'c0b3a576-651f-45d7-b1a9-640d09ed86db'

function loadOperator() {
  const scopes = loadTypeScriptModule(new URL('../../lib/xero/scopes.ts', import.meta.url))
  const baseOperator = loadTypeScriptModule(BASE_OPERATOR_PATH, {
    mocks: {
      '@/lib/supabase-admin': { createSupabaseAdminClient() { return {} } },
      '@/lib/xero/generation-importer': {
        XeroGenerationImportError: class extends Error {},
        async importXeroGeneration() { throw new Error('not used') },
      },
      '@/lib/xero/generation-run': {
        async loadXeroGenerationRunManifest() { throw new Error('not used') },
      },
      '@/lib/xero/scopes': scopes,
    },
  })
  return loadTypeScriptModule(MODULE_PATH, {
    mocks: {
      '@/lib/supabase-admin': { createSupabaseAdminClient() { return {} } },
      '@/lib/xero/generation-operator': baseOperator,
      '@/lib/xero/generation-readiness': {
        XERO_GENERATION_READINESS_CONTRACT_VERSION: 'collections_readiness_v2',
        async inspectXeroGenerationReadiness() { throw new Error('inject inspect') },
        async reacquireXeroGenerationRunForPromotion() { throw new Error('inject reacquire') },
        async recordXeroGenerationReadiness() { throw new Error('inject record') },
      },
      '@/lib/xero/scopes': scopes,
    },
  })
}

function input(overrides = {}) {
  return { projectRef: TEST_REF, userId, tenantId, grantId, syncRunId: runId, dryRun: true, ...overrides }
}

function environment(overrides = {}) {
  return {
    NEXT_PUBLIC_SUPABASE_URL: `https://${TEST_REF}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: 'unit-test-key',
    ...overrides,
  }
}

function granularScopes() {
  return [
    'offline_access',
    'accounting.settings.read',
    'accounting.contacts.read',
    'accounting.invoices.read',
    'accounting.payments.read',
  ]
}

function state(overrides = {}) {
  return {
    userExists: true,
    connection: { user_id: userId, tenant_id: tenantId, grant_id: grantId, auth_state: 'active' },
    grant: { id: grantId, user_id: userId, scopes: granularScopes() },
    activeRun: null,
    run: {
      id: runId,
      user_id: userId,
      tenant_id: tenantId,
      status: 'running',
      fencing_token: 1,
      lease_owner: '00000000-0000-4000-8000-000000000001',
      lease_expires_at: '2026-09-16T09:00:00Z',
      previous_active_sync_run_id: null,
    },
    tenantState: {
      active_sync_run_id: null,
      latest_sync_run_id: runId,
      current_fencing_token: 1,
      last_successful_sync_at: null,
    },
    ...overrides,
  }
}

function readiness(overrides = {}) {
  return {
    ready: true,
    resultCode: 'ready',
    contractVersion: 'collections_readiness_v2',
    baseCurrencyCode: 'GBP',
    counts: {
      rawOrganisations: 1,
      rawContacts: 78,
      rawAuthorisedInvoices: 26,
      rawPaidInvoices: 9,
      rawPayments: 20,
      canonicalOrganisations: 1,
      canonicalCustomers: 78,
      canonicalInvoices: 35,
      canonicalPayments: 20,
    },
    violations: { incompleteFxInvoices: 0, source: 0, reconciliation: 0, relationships: 0, fx: 0 },
    ...overrides,
  }
}

function dependencies(overrides = {}) {
  return {
    createSupabaseAdminClient: () => ({}),
    loadPreflightState: async () => state(),
    inspectReadiness: async () => readiness(),
    reacquire: async () => ({
      acquired: true,
      resultCode: 'reacquired',
      syncRunId: runId,
      fencingToken: 2,
      leaseExpiresAt: '2026-09-16T12:05:00Z',
    }),
    recordReadiness: async () => ({
      validated: true,
      resultCode: 'validated',
      validationId: '00000000-0000-4000-8000-000000000099',
      validatedAt: '2026-09-16T12:00:00Z',
      contractVersion: 'collections_readiness_v2',
      fencingToken: 2,
      baseCurrencyCode: 'GBP',
      incompleteFxInvoiceCount: 0,
      fxViolationCount: 0,
    }),
    now: () => Date.parse('2026-09-16T12:00:00Z'),
    randomUUID: () => '00000000-0000-4000-8000-000000000002',
    ...overrides,
  }
}

async function rejectCode(operator, params, code) {
  await assert.rejects(operator.runXeroGenerationRevalidationOperator(params), (error) => {
    assert.equal(error.code, code)
    return true
  })
}

test('dry-run performs current read-only validation without reacquisition or evidence writes', async () => {
  const operator = loadOperator()
  const calls = []
  const output = await operator.runXeroGenerationRevalidationOperator({
    input: input(),
    environment: environment(),
    dependencies: dependencies({
      inspectReadiness: async () => { calls.push('inspect'); return readiness() },
      reacquire: async () => { calls.push('reacquire'); throw new Error('forbidden') },
      recordReadiness: async () => { calls.push('record'); throw new Error('forbidden') },
    }),
  })
  assert.equal(output.result, 'ready_to_reacquire')
  assert.equal(output.preflight.currentFencingToken, 1)
  assert.equal(output.preflight.readiness.violations.incompleteFxInvoices, 0)
  assert.equal(output.reacquisitionCalls, 0)
  assert.deepEqual(calls, ['inspect'])
})

test('execute reacquires once, records once, and stops without promotion', async () => {
  const operator = loadOperator()
  let reacquisitions = 0
  let recordings = 0
  const output = await operator.runXeroGenerationRevalidationOperator({
    input: input({ dryRun: false }),
    environment: environment(),
    dependencies: dependencies({
      reacquire: async () => {
        reacquisitions += 1
        return dependencies().reacquire()
      },
      recordReadiness: async () => {
        recordings += 1
        return dependencies().recordReadiness()
      },
    }),
  })
  assert.equal(reacquisitions, 1)
  assert.equal(recordings, 1)
  assert.equal(output.result, 'reacquired_and_revalidated')
  assert.equal(output.run.previousFencingToken, 1)
  assert.equal(output.run.fencingToken, 2)
  assert.equal(output.promotionCapability, 'unavailable')
})

test('Production, unknown target, target mismatch, and malformed run ID fail before mutation', async () => {
  const operator = loadOperator()
  await rejectCode(operator, {
    input: input({ projectRef: PRODUCTION_REF }),
    environment: environment(),
    dependencies: dependencies(),
  }, 'production_target_rejected')
  await rejectCode(operator, {
    input: input({ projectRef: 'abcdefghijklmnopqrst' }),
    environment: environment(),
    dependencies: dependencies(),
  }, 'unknown_target_rejected')
  await rejectCode(operator, {
    input: input(),
    environment: environment({ NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` }),
    dependencies: dependencies(),
  }, 'configured_target_mismatch')
  await rejectCode(operator, {
    input: input({ syncRunId: 'invalid' }),
    environment: environment(),
    dependencies: dependencies(),
  }, 'invalid_arguments')
})

test('identity, grant, active pointer, live lease, and current readiness failures fail closed', async (t) => {
  const operator = loadOperator()
  const cases = [
    ['wrong run identity', state({ run: { ...state().run, user_id: '00000000-0000-4000-8000-000000000111' } }), 'identity_mismatch'],
    ['non granular grant', state({ grant: { ...state().grant, scopes: ['offline_access'] } }), 'permission_upgrade_required'],
    ['failed run', state({ run: { ...state().run, status: 'failed' } }), 'importer_not_ready'],
    ['active pointer drift', state({ tenantState: { ...state().tenantState, active_sync_run_id: '00000000-0000-4000-8000-000000000112' } }), 'importer_not_ready'],
    ['live lease', state({ run: { ...state().run, lease_expires_at: '2026-09-16T13:00:00Z' } }), 'active_run_exists'],
  ]
  for (const [label, stateValue, code] of cases) {
    await t.test(label, () => rejectCode(operator, {
      input: input(),
      environment: environment(),
      dependencies: dependencies({ loadPreflightState: async () => stateValue }),
    }, code))
  }
  await t.test('readiness rejection', () => rejectCode(operator, {
    input: input(),
    environment: environment(),
    dependencies: dependencies({ inspectReadiness: async () => readiness({ ready: false, resultCode: 'fx_incomplete' }) }),
  }, 'importer_not_ready'))
})

test('reacquisition failure does not retry or write evidence', async () => {
  const operator = loadOperator()
  let reacquisitions = 0
  let recordings = 0
  await rejectCode(operator, {
    input: input({ dryRun: false }),
    environment: environment(),
    dependencies: dependencies({
      reacquire: async () => {
        reacquisitions += 1
        return { acquired: false, resultCode: 'lease_held', syncRunId: runId, fencingToken: null, leaseExpiresAt: null }
      },
      recordReadiness: async () => { recordings += 1; throw new Error('forbidden') },
    }),
  }, 'active_run_exists')
  assert.equal(reacquisitions, 1)
  assert.equal(recordings, 0)
})

test('operator and CLI expose no promotion, pointer mutation, Xero, importer, or HTTP route', async () => {
  const sources = await Promise.all([
    readFile(MODULE_PATH, 'utf8'),
    readFile(SCRIPT_PATH, 'utf8'),
  ])
  for (const source of sources) {
    assert.doesNotMatch(source, /promote_xero_sync_run|active_sync_run_id\s*=|last_successful_sync_at\s*=/)
    assert.doesNotMatch(source, /importXeroGeneration|fetchXero|api\.xero\.com/)
  }
  const routes = await Promise.all([
    '../../app/api/xero/sync/route.ts',
    '../../app/api/xero/sync/auto/route.ts',
    '../../app/api/internal/xero/sync/route.ts',
    '../../app/api/internal/xero/scheduled-sync/route.ts',
  ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')))
  assert.ok(routes.every((route) => !route.includes('runXeroGenerationRevalidationOperator')))
})
