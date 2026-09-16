import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const MODULE_PATH = new URL('../../lib/xero/generation-readiness.ts', import.meta.url)
const runId = '00000000-0000-4000-8000-000000000101'
const userId = '00000000-0000-4000-8000-000000000102'
const tenantId = '00000000-0000-4000-8000-000000000103'
const ownerId = '00000000-0000-4000-8000-000000000104'

function loadReadiness() {
  return loadTypeScriptModule(MODULE_PATH, {
    mocks: {
      '@/lib/supabase-admin': {
        createSupabaseAdminClient() {
          throw new Error('tests inject a client')
        },
      },
    },
  })
}

function evaluation(overrides = {}) {
  return {
    ready: true,
    result_code: 'ready',
    contract_version: 'collections_readiness_v2',
    base_currency_code: 'GBP',
    raw_organisation_count: 1,
    raw_contact_count: 10,
    raw_authorised_invoice_count: 4,
    raw_paid_invoice_count: 5,
    raw_payment_count: 7,
    canonical_organisation_count: 1,
    canonical_customer_count: 10,
    canonical_invoice_count: 9,
    canonical_payment_count: 7,
    incomplete_fx_invoice_count: 0,
    source_violation_count: 0,
    reconciliation_violation_count: 0,
    relationship_violation_count: 0,
    fx_violation_count: 0,
    ...overrides,
  }
}

test('read-only inspection returns versioned aggregate readiness without mutation', async () => {
  const readiness = loadReadiness()
  const calls = []
  const result = await readiness.inspectXeroGenerationReadiness({
    syncRunId: runId,
    userId,
    tenantId,
    supabaseAdmin: {
      async rpc(name, args) {
        calls.push({ name, args })
        return { data: [evaluation()], error: null }
      },
    },
  })
  assert.equal(result.ready, true)
  assert.equal(result.contractVersion, 'collections_readiness_v2')
  assert.equal(result.violations.incompleteFxInvoices, 0)
  assert.equal(calls[0].name, 'inspect_xero_sync_run_readiness')
})

test('recording and reacquisition require explicit current authority', async () => {
  const readiness = loadReadiness()
  const calls = []
  const client = {
    async rpc(name, args) {
      calls.push({ name, args })
      if (name === 'record_xero_sync_run_readiness') {
        return {
          data: [{
            validated: true,
            result_code: 'validated',
            validation_id: '00000000-0000-4000-8000-000000000105',
            validated_at: '2026-09-16T12:00:00Z',
            contract_version: 'collections_readiness_v2',
            fencing_token: 9,
            base_currency_code: 'GBP',
            incomplete_fx_invoice_count: 0,
            fx_violation_count: 0,
          }],
          error: null,
        }
      }
      return {
        data: [{
          acquired: true,
          result_code: 'reacquired',
          sync_run_id: runId,
          fencing_token: 9,
          lease_expires_at: '2026-09-16T12:05:00Z',
        }],
        error: null,
      }
    },
  }
  const reacquired = await readiness.reacquireXeroGenerationRunForPromotion({
    syncRunId: runId,
    userId,
    tenantId,
    leaseOwner: ownerId,
    leaseTtlSeconds: 300,
    supabaseAdmin: client,
  })
  const recorded = await readiness.recordXeroGenerationReadiness({
    syncRunId: runId,
    userId,
    tenantId,
    leaseOwner: ownerId,
    fencingToken: 9,
    supabaseAdmin: client,
  })
  assert.equal(reacquired.fencingToken, 9)
  assert.equal(recorded.validated, true)
  assert.equal(recorded.fencingToken, 9)
  assert.deepEqual(calls.map((call) => call.name), [
    'reacquire_xero_sync_run_for_promotion',
    'record_xero_sync_run_readiness',
  ])
})

test('malformed or unsupported database responses fail closed without sensitive details', async () => {
  const readiness = loadReadiness()
  await assert.rejects(
    readiness.inspectXeroGenerationReadiness({
      syncRunId: runId,
      userId,
      tenantId,
      supabaseAdmin: {
        async rpc() {
          return { data: [evaluation({ contract_version: 'legacy' })], error: null }
        },
      },
    }),
    /unsupported readiness contract version/
  )
  await assert.rejects(
    readiness.inspectXeroGenerationReadiness({
      syncRunId: runId,
      userId,
      tenantId,
      supabaseAdmin: {
        async rpc() {
          return { data: null, error: { code: 'XX000', message: 'token=secret' } }
        },
      },
    }),
    (error) => error.code === 'XX000' && !error.message.includes('secret')
  )
})
