import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { promisify } from 'node:util'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const execFileAsync = promisify(execFile)
const OPERATOR_PATH = new URL('../../lib/xero/generation-operator.ts', import.meta.url)
const SCRIPT_PATH = new URL('../../scripts/xero-generation-operator.ts', import.meta.url)
const TEST_REF = 'rbmxegyiwntomhpbepnu'
const PRODUCTION_REF = 'sswyxbugbdoadktyaows'
const userId = '81c01b0b-8864-4b72-aa17-236f74ba38d1'
const tenantId = 'a61ccfea-548c-49f1-ae5a-11c3e1035ce3'
const grantId = '32022401-fcf9-41ef-ab4e-92821edce5ac'

class MockImportError extends Error {
  constructor(code, resource = null, runId = null) {
    super('mock importer failure')
    this.code = code
    this.resource = resource
    this.runId = runId
  }
}

function loadOperator() {
  const scopes = loadTypeScriptModule(new URL('../../lib/xero/scopes.ts', import.meta.url))
  return loadTypeScriptModule(OPERATOR_PATH, {
    mocks: {
      '@/lib/supabase-admin': {
        createSupabaseAdminClient() {
          return { kind: 'default-client' }
        },
      },
      '@/lib/xero/generation-importer': {
        XeroGenerationImportError: MockImportError,
        async importXeroGeneration() {
          throw new Error('tests must inject the importer')
        },
      },
      '@/lib/xero/generation-run': {
        async loadXeroGenerationRunManifest() {
          throw new Error('tests must inject the manifest loader')
        },
      },
      '@/lib/xero/scopes': scopes,
    },
  })
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

function validState(overrides = {}) {
  return {
    userExists: true,
    connection: {
      user_id: userId,
      tenant_id: tenantId,
      grant_id: grantId,
      auth_state: 'active',
    },
    grant: {
      id: grantId,
      user_id: userId,
      scopes: granularScopes(),
    },
    activeRun: null,
    ...overrides,
  }
}

function input(overrides = {}) {
  return {
    projectRef: TEST_REF,
    userId,
    tenantId,
    grantId,
    dryRun: true,
    ...overrides,
  }
}

function environment(overrides = {}) {
  return {
    NEXT_PUBLIC_SUPABASE_URL: `https://${TEST_REF}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-not-a-secret',
    ...overrides,
  }
}

function readyResult() {
  const metadata = {
    minimumMinuteRemaining: 59,
    minimumDayRemaining: 4999,
    minimumAppMinuteRemaining: null,
    latestMinuteRemaining: 59,
    latestDayRemaining: 4999,
    latestAppMinuteRemaining: null,
    maximumRetryAfterSeconds: null,
    rateLimitProblems: [],
    correlationIds: ['safe-correlation-id'],
  }
  const resource = {
    records: 1,
    populatedPages: 1,
    pageRequests: 2,
    httpAttempts: 2,
    metadata,
  }
  return {
    status: 'ready_for_promotion',
    runId: '00000000-0000-4000-8000-000000000101',
    fencingToken: 1,
    leaseExpiresAt: '2026-09-16T12:05:00.000Z',
    counts: {
      organisation: 1,
      contacts: 1,
      authorisedInvoices: 1,
      paidInvoices: 1,
      payments: 1,
      canonical: { organisations: 1, customers: 1, invoices: 2, payments: 1 },
    },
    validation: {
      organisationBaseCurrencyCode: 'GBP',
      incompleteFxInvoiceCount: 0,
      completeFxInvoiceCount: 2,
    },
    readiness: {
      validated: true,
      resultCode: 'validated',
      validationId: '00000000-0000-4000-8000-000000000102',
      validatedAt: '2026-09-16T12:01:00.000Z',
      contractVersion: 'collections_readiness_v2',
      fencingToken: 1,
      baseCurrencyCode: 'GBP',
      incompleteFxInvoiceCount: 0,
      fxViolationCount: 0,
    },
    diagnostics: {
      runStartedAt: '2026-09-16T12:00:00.000Z',
      catchUpSince: '2026-09-16T11:59:55.000Z',
      organisation: { records: 1, httpAttempts: 1, metadata },
      resources: {
        contacts: resource,
        authorisedInvoices: resource,
        paidInvoices: resource,
        payments: resource,
        catchUpContacts: { ...resource, records: 0 },
        catchUpInvoices: { ...resource, records: 0 },
        catchUpPayments: { ...resource, records: 0 },
      },
    },
  }
}

function dependencies(params = {}) {
  return {
    createSupabaseAdminClient: () => ({ kind: 'test-client' }),
    loadPreflightState: async () => params.state ?? validState(),
    importGeneration: params.importGeneration ?? (async () => readyResult()),
    loadManifest: params.loadManifest ?? (async () => [{
      stepKey: 'validation',
      status: 'succeeded',
      recordCount: 1,
      completedAt: '2026-09-16T12:01:00.000Z',
    }]),
    now: params.now ?? (() => Date.parse('2026-09-16T12:00:00.000Z')),
    randomUUID: () => '00000000-0000-4000-8000-000000000099',
  }
}

async function assertOperatorRejects(operator, params, code) {
  await assert.rejects(
    operator.runXeroGenerationOperator(params),
    (error) => {
      assert.equal(error.code, code)
      return true
    }
  )
}

test('Test project and matching configured Supabase project pass dry-run preflight', async () => {
  const operator = loadOperator()
  let importerCalls = 0
  const output = await operator.runXeroGenerationOperator({
    input: input(),
    environment: environment(),
    dependencies: dependencies({
      importGeneration: async () => {
        importerCalls += 1
        return readyResult()
      },
    }),
  })

  assert.equal(output.result, 'safe_to_invoke')
  assert.equal(output.preflight.targetProject, TEST_REF)
  assert.equal(output.preflight.configuredProject, TEST_REF)
  assert.equal(output.preflight.grantClassification, 'granular_ready')
  assert.equal(output.preflight.promotionCapability, 'unavailable')
  assert.equal(output.importerCalls, 0)
  assert.equal(importerCalls, 0)
})

test('Production, unknown, missing, and malformed project refs fail before client creation', async () => {
  const operator = loadOperator()
  const cases = [
    [PRODUCTION_REF, 'production_target_rejected'],
    ['abcdefghijklmnopqrst', 'unknown_target_rejected'],
    ['', 'invalid_arguments'],
    ['not-a-project-ref', 'invalid_arguments'],
  ]
  for (const [projectRef, expectedCode] of cases) {
    let clients = 0
    await assertOperatorRejects(operator, {
      input: input({ projectRef }),
      environment: environment(),
      dependencies: dependencies({
        createSupabaseAdminClient: () => {
          clients += 1
          return {}
        },
      }),
    }, expectedCode)
    assert.equal(clients, 0)
  }
})

test('CLI project and configured Supabase project mismatch fails before client creation', async () => {
  const operator = loadOperator()
  let clients = 0
  await assertOperatorRejects(operator, {
    input: input(),
    environment: environment({
      NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
    }),
    dependencies: dependencies({
      createSupabaseAdminClient: () => {
        clients += 1
        return {}
      },
    }),
  }, 'configured_target_mismatch')
  assert.equal(clients, 0)
})

test('missing and malformed user, tenant, and grant IDs fail before preflight queries', async () => {
  const operator = loadOperator()
  for (const field of ['userId', 'tenantId', 'grantId']) {
    for (const value of ['', 'malformed']) {
      let preflights = 0
      await assertOperatorRejects(operator, {
        input: input({ [field]: value }),
        environment: environment(),
        dependencies: dependencies({
          loadPreflightState: async () => {
            preflights += 1
            return validState()
          },
        }),
      }, 'invalid_arguments')
      assert.equal(preflights, 0)
    }
  }
})

test('wrong user, tenant, or grant relationship is rejected', async () => {
  const operator = loadOperator()
  const mismatches = [
    { connection: { ...validState().connection, user_id: '00000000-0000-4000-8000-000000000001' } },
    { connection: { ...validState().connection, tenant_id: '00000000-0000-4000-8000-000000000002' } },
    { connection: { ...validState().connection, grant_id: '00000000-0000-4000-8000-000000000003' } },
    { grant: { ...validState().grant, user_id: '00000000-0000-4000-8000-000000000004' } },
  ]
  for (const mismatch of mismatches) {
    await assertOperatorRejects(operator, {
      input: input(),
      environment: environment(),
      dependencies: dependencies({ state: validState(mismatch) }),
    }, 'identity_mismatch')
  }
})

test('disconnected connection and non-granular-ready grant are rejected', async () => {
  const operator = loadOperator()
  await assertOperatorRejects(operator, {
    input: input(),
    environment: environment(),
    dependencies: dependencies({
      state: validState({
        connection: { ...validState().connection, auth_state: 'disconnected' },
      }),
    }),
  }, 'connection_inactive')

  await assertOperatorRejects(operator, {
    input: input(),
    environment: environment(),
    dependencies: dependencies({
      state: validState({
        grant: {
          ...validState().grant,
          scopes: ['offline_access', 'accounting.settings.read', 'accounting.contacts.read'],
        },
      }),
    }),
  }, 'permission_upgrade_required')

  await assertOperatorRejects(operator, {
    input: input(),
    environment: environment(),
    dependencies: dependencies({
      state: validState({
        grant: {
          ...validState().grant,
          scopes: [
            'offline_access',
            'accounting.settings.read',
            'accounting.contacts.read',
            'accounting.transactions.read',
          ],
        },
      }),
    }),
  }, 'permission_upgrade_required')
})

test('dry-run performs no importer, Xero, lease, run, or manifest operation', async () => {
  const operator = loadOperator()
  const forbidden = []
  const output = await operator.runXeroGenerationOperator({
    input: input({ dryRun: true }),
    environment: environment(),
    dependencies: dependencies({
      importGeneration: async () => {
        forbidden.push('import')
        return readyResult()
      },
      loadManifest: async () => {
        forbidden.push('manifest')
        return []
      },
    }),
  })
  assert.equal(output.result, 'safe_to_invoke')
  assert.deepEqual(forbidden, [])
})

test('one execution invokes importer exactly once and emits only aggregate diagnostics', async () => {
  const operator = loadOperator()
  let importerCalls = 0
  let clockCalls = 0
  const times = [
    Date.parse('2026-09-16T12:00:00.000Z'),
    Date.parse('2026-09-16T12:00:01.000Z'),
    Date.parse('2026-09-16T12:00:04.000Z'),
  ]
  const output = await operator.runXeroGenerationOperator({
    input: input({ dryRun: false }),
    environment: environment(),
    dependencies: dependencies({
      now: () => times[Math.min(clockCalls++, times.length - 1)],
      importGeneration: async () => {
        importerCalls += 1
        return readyResult()
      },
    }),
  })

  assert.equal(importerCalls, 1)
  assert.equal(output.importerCalls, 1)
  assert.equal(output.result, 'ready_for_promotion')
  assert.equal(output.promotionCapability, 'unavailable')
  assert.equal(output.run.durationMs, 3_000)
  assert.equal(output.diagnostics.providerRequestCount, 15)
  assert.equal(output.diagnostics.retryAttemptCount, 0)
  assert.doesNotMatch(JSON.stringify(output), /access[_-]?token|refresh[_-]?token|service[_-]?role/i)
})

test('importer failure is never retried and output omits the sensitive cause', async () => {
  const operator = loadOperator()
  let importerCalls = 0
  let caught
  try {
    await operator.runXeroGenerationOperator({
      input: input({ dryRun: false }),
      environment: environment(),
      dependencies: dependencies({
        importGeneration: async () => {
          importerCalls += 1
          throw new Error('access-token=super-secret')
        },
      }),
    })
  } catch (error) {
    caught = error
  }
  assert.equal(importerCalls, 1)
  const failure = operator.formatXeroGenerationOperatorFailure(caught)
  const serialized = JSON.stringify(failure.output)
  assert.equal(failure.output.code, 'importer_failed')
  assert.doesNotMatch(serialized, /super-secret|access-token/i)
})

test('active non-expired tenant run fails closed before importer invocation', async () => {
  const operator = loadOperator()
  let importerCalls = 0
  await assertOperatorRejects(operator, {
    input: input({ dryRun: false }),
    environment: environment(),
    dependencies: dependencies({
      state: validState({
        activeRun: {
          id: '00000000-0000-4000-8000-000000000088',
          lease_expires_at: '2026-09-16T12:05:00.000Z',
        },
      }),
      importGeneration: async () => {
        importerCalls += 1
        return readyResult()
      },
    }),
  }, 'active_run_exists')
  assert.equal(importerCalls, 0)
})

test('operator has no promotion/pointer mutation and is absent from HTTP routes', async () => {
  const operatorSource = await readFile(OPERATOR_PATH, 'utf8')
  const cliSource = await readFile(SCRIPT_PATH, 'utf8')
  const routes = await Promise.all([
    '../../app/api/xero/sync/route.ts',
    '../../app/api/xero/sync/auto/route.ts',
    '../../app/api/internal/xero/sync/route.ts',
    '../../app/api/internal/xero/scheduled-sync/route.ts',
  ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')))

  for (const source of [operatorSource, cliSource]) {
    assert.doesNotMatch(source, /promote_xero_sync_run|active_sync_run_id|last_successful_sync_at/)
    assert.doesNotMatch(source, /\.update\(|\.insert\(|\.upsert\(/)
  }
  assert.ok(routes.every((route) => !route.includes('runXeroGenerationOperator')))
  assert.ok(routes.every((route) => !route.includes('importXeroGeneration')))
})

test('CLI help is inert and documents the Test-only no-promotion contract', async () => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [
      '--conditions=react-server',
      '--import',
      'tsx',
      decodeURIComponent(SCRIPT_PATH.pathname),
      '--help',
    ],
    { env: {}, timeout: 10_000 }
  )
  assert.equal(stderr, '')
  assert.match(stdout, new RegExp(TEST_REF))
  assert.match(stdout, /no generation-promotion capability/i)
})

test('actual CLI rejects missing and Production targets before networking', async () => {
  const common = [
    '--conditions=react-server',
    '--import',
    'tsx',
    decodeURIComponent(SCRIPT_PATH.pathname),
  ]
  const cliEnvironment = {
    NEXT_PUBLIC_SUPABASE_URL: `https://${TEST_REF}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: 'not-used',
  }

  await assert.rejects(
    execFileAsync(process.execPath, [
      ...common,
      '--user-id', userId,
      '--tenant-id', tenantId,
      '--grant-id', grantId,
      '--dry-run',
    ], { env: cliEnvironment, timeout: 10_000 }),
    (error) => {
      assert.equal(error.code, 64)
      assert.match(error.stderr, /"code": "invalid_arguments"/)
      return true
    }
  )

  await assert.rejects(
    execFileAsync(process.execPath, [
      ...common,
      '--project-ref', PRODUCTION_REF,
      '--user-id', userId,
      '--tenant-id', tenantId,
      '--grant-id', grantId,
      '--dry-run',
    ], { env: cliEnvironment, timeout: 10_000 }),
    (error) => {
      assert.equal(error.code, 64)
      assert.match(error.stderr, /"code": "production_target_rejected"/)
      return true
    }
  )
})
