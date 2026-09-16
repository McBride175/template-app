import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
import {
  contact,
  createGenerationImportHarness,
  invoice,
  organisationResult,
  payment,
} from './test-helpers/xero-generation-import-harness.mjs'

const CLIENT_PATH = new URL('../../lib/xero/accounting-api-client.ts', import.meta.url)
const IMPORTER_PATH = new URL('../../lib/xero/generation-importer.ts', import.meta.url)

function loadImporter() {
  const accountingClient = loadTypeScriptModule(CLIENT_PATH)
  const importer = loadTypeScriptModule(IMPORTER_PATH, {
    mocks: {
      '@/lib/xero/accounting-api-client': accountingClient,
      '@/lib/supabase-admin': {
        createSupabaseAdminClient() {
          throw new Error('tests supply an explicit database client')
        },
      },
      '@/lib/xero/sync': {
        async getValidXeroAccessTokenForTenant() {
          throw new Error('tests supply an explicit token loader')
        },
      },
    },
  })
  return { importer, accountingClient }
}

test('complete generation reaches ready-for-promotion with ordered trusted manifest steps', async () => {
  const { importer } = loadImporter()
  const harness = createGenerationImportHarness()

  const result = await importer.importXeroGeneration(harness.params)

  assert.equal(result.status, 'ready_for_promotion')
  assert.equal(result.runId, 'run-tenant-a')
  assert.deepEqual(result.counts, {
    organisation: 1,
    contacts: 1,
    authorisedInvoices: 1,
    paidInvoices: 1,
    payments: 1,
    canonical: { organisations: 1, customers: 1, invoices: 2, payments: 1 },
  })
  assert.deepEqual(
    harness.events.filter((event) => event.startsWith('step:')),
    [
      'step:organisation',
      'step:contacts',
      'step:authorised_accrec_invoices',
      'step:paid_accrec_invoices',
      'step:authorised_accrec_payments',
      'step:canonical_mapping',
      'step:validation',
    ]
  )
  assert.ok(harness.events.indexOf('map') > harness.events.indexOf('persist:payments'))
  assert.ok(harness.events.indexOf('manifest') > harness.events.indexOf('step:canonical_mapping'))
  assert.ok(harness.events.indexOf('readiness:record') > harness.events.indexOf('manifest'))
  assert.ok(harness.events.indexOf('step:validation') > harness.events.indexOf('readiness:record'))
  assert.equal(result.readiness.contractVersion, 'collections_readiness_v2')
  assert.equal(harness.readinessRecords, 1)
  assert.equal(harness.failures.length, 0)
  assert.equal(harness.heartbeatCount, 1)
  assert.equal(harness.cancelledDeadlineTimers.length, 1)
})

test('legitimately empty provider streams still produce a complete generation', async () => {
  const { importer } = loadImporter()
  const harness = createGenerationImportHarness({
    contacts: [],
    authorisedInvoices: [],
    paidInvoices: [],
    payments: [],
  })

  const result = await importer.importXeroGeneration(harness.params)

  assert.equal(result.status, 'ready_for_promotion')
  assert.equal(result.counts.contacts, 0)
  assert.equal(result.counts.canonical.organisations, 1)
  assert.equal(result.counts.canonical.customers, 0)
  assert.equal(harness.steps.get('contacts').recordCount, 0)
  assert.equal(harness.steps.get('validation').recordCount, 1)
})

test('real provider pagination is used for every stream with at most two concurrent requests', async () => {
  const { importer, accountingClient } = loadImporter()
  const tenantId = '00000000-0000-4000-8000-0000000000a1'
  const harness = createGenerationImportHarness({ tenantId })
  const calls = []
  let activeRequests = 0
  let maximumActiveRequests = 0

  const pages = {
    contacts: [[contact('contact-a')], [contact('contact-b')], []],
    authorised: [[invoice('invoice-a', 'contact-a', 'AUTHORISED')], []],
    paid: [[invoice('invoice-b', 'contact-b', 'PAID')], []],
    payments: [[payment('payment-a', 'invoice-b')], []],
  }

  harness.dependencies.requestDependencies = {
    random: () => 0.5,
    now: () => Date.parse('2026-09-15T10:00:00.000Z'),
    async sleep() {},
    scheduleTimeout() {
      return {}
    },
    cancelTimeout() {},
    async fetch(input, init) {
      activeRequests += 1
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests)
      await Promise.resolve()
      const url = new URL(String(input))
      const page = Number(url.searchParams.get('page') ?? 1)
      const isCatchUp = new Headers(init.headers).has('if-modified-since')
      calls.push({ url, headers: new Headers(init.headers) })
      activeRequests -= 1

      if (url.pathname.endsWith('/Organisation')) {
        return new Response(JSON.stringify({ Organisations: organisationResult(tenantId).records }))
      }
      if (isCatchUp) {
        const responseKey = url.pathname.endsWith('/Contacts')
          ? 'Contacts'
          : url.pathname.endsWith('/Invoices')
            ? 'Invoices'
            : 'Payments'
        return new Response(JSON.stringify({ [responseKey]: [] }))
      }
      if (url.pathname.endsWith('/Contacts')) {
        return new Response(JSON.stringify({ Contacts: pages.contacts[page - 1] }))
      }
      if (url.pathname.endsWith('/Invoices')) {
        const stream = url.searchParams.get('Statuses') === 'AUTHORISED'
          ? pages.authorised
          : pages.paid
        return new Response(JSON.stringify({ Invoices: stream[page - 1] }))
      }
      return new Response(JSON.stringify({ Payments: pages.payments[page - 1] }))
    },
  }
  harness.dependencies.fetchOrganisation = accountingClient.fetchXeroOrganisation
  harness.dependencies.fetchCollection = accountingClient.fetchXeroPaginatedCollection

  const result = await importer.importXeroGeneration(harness.params)

  assert.equal(result.status, 'ready_for_promotion')
  assert.equal(result.diagnostics.resources.contacts.populatedPages, 2)
  assert.equal(result.diagnostics.resources.contacts.pageRequests, 3)
  assert.equal(result.diagnostics.resources.authorisedInvoices.pageRequests, 2)
  assert.equal(result.diagnostics.resources.paidInvoices.pageRequests, 2)
  assert.equal(result.diagnostics.resources.payments.pageRequests, 2)
  assert.ok(maximumActiveRequests <= 2)
  assert.ok(calls.some((call) => call.headers.has('if-modified-since')))
  assert.ok(calls.every((call) => call.url.pathname.endsWith('/Organisation') || call.url.searchParams.has('page')))
})

test('catch-up deterministically reconciles status changes, tombstones, new records, and archives', async () => {
  const { importer } = loadImporter()
  const harness = createGenerationImportHarness({
    contacts: [contact('contact-a', '2026-09-15T09:00:00Z')],
    authorisedInvoices: [
      invoice('invoice-paid-later', 'contact-a', 'AUTHORISED', '2026-09-15T09:00:00Z'),
      invoice('invoice-voided', 'contact-a', 'AUTHORISED', '2026-09-15T09:00:00Z'),
    ],
    paidInvoices: [],
    payments: [payment('payment-deleted', 'invoice-paid-later', 'AUTHORISED', '2026-09-15T09:00:00Z')],
    catchUpContacts: [contact('contact-a', '2026-09-15T10:01:00Z', { ContactStatus: 'ARCHIVED' })],
    catchUpInvoices: [
      invoice('invoice-paid-later', 'contact-a', 'PAID', '2026-09-15T10:01:00Z'),
      invoice('invoice-voided', 'contact-a', 'VOIDED', '2026-09-15T10:02:00Z'),
      invoice('invoice-new', 'contact-a', 'AUTHORISED', '2026-09-15T10:03:00Z'),
    ],
    catchUpPayments: [
      payment('payment-deleted', 'invoice-paid-later', 'DELETED', '2026-09-15T10:04:00Z'),
      payment('payment-new', 'invoice-paid-later', 'AUTHORISED', '2026-09-15T10:05:00Z'),
    ],
  })

  const result = await importer.importXeroGeneration(harness.params)

  assert.equal(result.status, 'ready_for_promotion')
  assert.equal(harness.persisted.get('contacts')[0].ContactStatus, 'ARCHIVED')
  assert.deepEqual(
    harness.persisted.get('invoices').map((record) => `${record.InvoiceID}:${record.Status}`),
    ['invoice-new:AUTHORISED', 'invoice-paid-later:PAID']
  )
  assert.deepEqual(
    harness.persisted.get('payments').map((record) => record.PaymentID),
    ['payment-new']
  )
  assert.equal(result.counts.authorisedInvoices, 1)
  assert.equal(result.counts.paidInvoices, 1)
})

test('conflicting cross-stream versions without usable freshness fail closed', async () => {
  const { importer } = loadImporter()
  const harness = createGenerationImportHarness({
    authorisedInvoices: [invoice('invoice-x', 'contact-a', 'AUTHORISED', 'invalid')],
    paidInvoices: [invoice('invoice-x', 'contact-a', 'PAID', 'invalid')],
    payments: [],
  })

  await assert.rejects(
    importer.importXeroGeneration(harness.params),
    (error) => error.code === 'provider_data_invalid' && error.resource === 'invoices'
  )
  assert.equal(harness.persisted.has('contacts'), false)
  assert.equal(harness.steps.get('contacts').status, 'pending')
  assert.equal(harness.failures[0].errorCode, 'provider_data_invalid')
})

test('a provider failure before full traversal never completes or persists that stream', async () => {
  const { importer } = loadImporter()
  const harness = createGenerationImportHarness({
    fetchCollection({ name, pageResult, records }) {
      if (name === 'invoices:paid') {
        throw new importer.XeroGenerationImportError({
          code: 'provider_unavailable',
          resource: 'invoices',
        })
      }
      return pageResult(records)
    },
  })

  await assert.rejects(
    importer.importXeroGeneration(harness.params),
    (error) => error.code === 'provider_unavailable'
  )
  assert.equal(harness.steps.get('organisation').status, 'succeeded')
  assert.equal(harness.steps.get('contacts').status, 'pending')
  assert.equal(harness.persisted.has('contacts'), false)
  assert.equal(harness.persisted.has('invoices'), false)
  assert.equal(harness.failures[0].errorCode, 'provider_unavailable')
})

test('a failed generation batch remains inactive and its resource step stays pending', async () => {
  const { importer } = loadImporter()
  const harness = createGenerationImportHarness()
  const persistRaw = harness.dependencies.persistRaw
  harness.dependencies.persistRaw = async (request) => {
    if (request.resourceType === 'invoices') {
      throw new importer.XeroGenerationImportError({
        code: 'persistence_failed',
        resource: 'invoices',
      })
    }
    return persistRaw(request)
  }

  await assert.rejects(
    importer.importXeroGeneration(harness.params),
    (error) => error.code === 'persistence_failed'
  )
  assert.equal(harness.steps.get('contacts').status, 'succeeded')
  assert.equal(harness.steps.get('authorised_accrec_invoices').status, 'pending')
  assert.equal(harness.steps.get('canonical_mapping').status, 'pending')
  assert.equal(harness.failures[0].errorCode, 'persistence_failed')
})

test('401 forces one secure token refresh and retries only the affected operation', async () => {
  const { importer, accountingClient } = loadImporter()
  let organisationCalls = 0
  const harness = createGenerationImportHarness({
    fetchOrganisation() {
      organisationCalls += 1
      if (organisationCalls === 1) {
        throw new accountingClient.XeroAccountingRequestError({
          kind: 'authentication',
          resource: 'organisation',
          retryable: false,
          attemptCount: 1,
          status: 401,
        })
      }
      return organisationResult('tenant-a')
    },
  })

  const result = await importer.importXeroGeneration(harness.params)

  assert.equal(result.status, 'ready_for_promotion')
  assert.equal(organisationCalls, 2)
  assert.equal(harness.tokenLoads, 2)
  assert.deepEqual(harness.events.filter((event) => event.startsWith('token:')), [
    'token:load',
    'token:refresh',
  ])
})

test('persistent 401 and provider 403 have distinct sanitized failure classifications', async (t) => {
  const { importer, accountingClient } = loadImporter()

  await t.test('persistent 401', async () => {
    const harness = createGenerationImportHarness({
      fetchOrganisation() {
        throw new accountingClient.XeroAccountingRequestError({
          kind: 'authentication',
          resource: 'organisation',
          retryable: false,
          attemptCount: 1,
          status: 401,
        })
      },
    })
    await assert.rejects(
      importer.importXeroGeneration(harness.params),
      (error) => error.code === 'xero_reauth_required'
    )
    assert.equal(harness.tokenLoads, 2)
    assert.equal(harness.failures[0].errorCode, 'xero_reauth_required')
  })

  await t.test('permission failure', async () => {
    const harness = createGenerationImportHarness({
      fetchOrganisation() {
        throw new accountingClient.XeroAccountingRequestError({
          kind: 'permission',
          resource: 'organisation',
          retryable: false,
          attemptCount: 1,
          status: 403,
        })
      },
    })
    await assert.rejects(
      importer.importXeroGeneration(harness.params),
      (error) => error.code === 'xero_permission_required'
    )
    assert.equal(harness.tokenLoads, 1)
  })
})

test('rate-limit, timeout, malformed data, and duplicate pagination classifications fail the run', async (t) => {
  const { importer, accountingClient } = loadImporter()
  const cases = [
    ['rate_limit', 'xero_rate_limited'],
    ['daily_rate_limit', 'xero_daily_limit'],
    ['timeout', 'provider_timeout'],
    ['malformed_response', 'provider_data_invalid'],
  ]
  for (const [kind, expected] of cases) {
    await t.test(kind, async () => {
      const harness = createGenerationImportHarness({
        fetchOrganisation() {
          throw new accountingClient.XeroAccountingRequestError({
            kind,
            resource: 'organisation',
            retryable: false,
            attemptCount: 3,
            status: kind.includes('rate') ? 429 : null,
          })
        },
      })
      await assert.rejects(
        importer.importXeroGeneration(harness.params),
        (error) => error.code === expected
      )
      assert.equal(harness.failures[0].errorCode, expected)
    })
  }

  await t.test('duplicate pagination', async () => {
    const harness = createGenerationImportHarness({
      fetchCollection({ name, pageResult, records }) {
        if (name === 'contacts') {
          throw new accountingClient.XeroPaginationError({
            kind: 'duplicate_record',
            resource: 'contacts',
            page: 2,
            duplicateKind: 'conflicting',
            detail: 'conflicting duplicate source ID',
          })
        }
        return pageResult(records)
      },
    })
    await assert.rejects(
      importer.importXeroGeneration(harness.params),
      (error) => error.code === 'provider_data_invalid'
    )
  })
})

test('missing capability, invalid organisation, mapping failure, and final validation failure are bounded', async (t) => {
  const { importer } = loadImporter()

  await t.test('missing capability', async () => {
    const harness = createGenerationImportHarness({
      tokenResult: () => ({
        ok: true,
        accessToken: 'token',
        tenantId: 'tenant-a',
        grantId: 'grant-a',
        scopes: [
          'offline_access',
          'accounting.settings.read',
          'accounting.contacts.read',
          'accounting.invoices.read',
        ],
      }),
    })
    await assert.rejects(
      importer.importXeroGeneration(harness.params),
      (error) => error.code === 'xero_permission_required' && error.resource === 'payments'
    )
  })

  await t.test('missing organisation', async () => {
    const harness = createGenerationImportHarness({
      fetchOrganisation: () => ({ ...organisationResult('tenant-a'), records: [] }),
    })
    await assert.rejects(
      importer.importXeroGeneration(harness.params),
      (error) => error.code === 'provider_data_invalid' && error.resource === 'organisation'
    )
  })

  await t.test('invalid organisation base currency', async () => {
    const harness = createGenerationImportHarness({
      fetchOrganisation: () => organisationResult('tenant-a', { BaseCurrency: 'invalid' }),
    })
    await assert.rejects(
      importer.importXeroGeneration(harness.params),
      (error) => error.code === 'provider_data_invalid' && error.resource === 'organisation'
    )
  })

  await t.test('mapping failure', async () => {
    const mappingError = new Error('sensitive missing contact detail')
    mappingError.name = 'XeroGenerationMappingValidationError'
    mappingError.resource = 'contacts'
    const harness = createGenerationImportHarness({ mappingError })
    await assert.rejects(
      importer.importXeroGeneration(harness.params),
      (error) => error.code === 'generation_validation_failed' && !error.message.includes('sensitive')
    )
    assert.equal(harness.steps.get('canonical_mapping').status, 'pending')
  })

  await t.test('count mismatch', async () => {
    const harness = createGenerationImportHarness({
      mappingResult: {
        counts: { organisations: 1, customers: 0, invoices: 2, payments: 1 },
        writes: {},
        validation: {
          organisationBaseCurrencyCode: 'GBP',
          incompleteFxInvoiceCount: 0,
          completeFxInvoiceCount: 2,
        },
      },
    })
    await assert.rejects(
      importer.importXeroGeneration(harness.params),
      (error) => error.code === 'generation_validation_failed'
    )
    assert.equal(harness.steps.get('validation').status, 'pending')
  })

  for (const [label, incompleteFxInvoiceCount, completeFxInvoiceCount] of [
    ['one incomplete invoice in a mixed generation', 1, 1],
    ['all invoices incomplete', 2, 0],
  ]) {
    await t.test(label, async () => {
      const harness = createGenerationImportHarness({
        mappingResult: {
          counts: { organisations: 1, customers: 1, invoices: 2, payments: 1 },
          writes: {},
          validation: {
            organisationBaseCurrencyCode: 'GBP',
            incompleteFxInvoiceCount,
            completeFxInvoiceCount,
          },
        },
      })
      await assert.rejects(
        importer.importXeroGeneration(harness.params),
        (error) => error.code === 'generation_validation_failed'
      )
      assert.equal(harness.readinessRecords, 0)
      assert.equal(harness.steps.get('validation').status, 'pending')
      assert.equal(harness.failures[0].errorCode, 'generation_validation_failed')
    })
  }

  await t.test('authoritative readiness rejection', async () => {
    const harness = createGenerationImportHarness({
      readinessResult: () => ({
        validated: false,
        resultCode: 'fx_incomplete',
        validationId: null,
        validatedAt: null,
        contractVersion: 'collections_readiness_v2',
        fencingToken: 1,
        baseCurrencyCode: 'GBP',
        incompleteFxInvoiceCount: 1,
        fxViolationCount: 1,
      }),
    })
    await assert.rejects(
      importer.importXeroGeneration(harness.params),
      (error) => error.code === 'generation_validation_failed' && error.resource === 'fx_incomplete'
    )
    assert.equal(harness.readinessRecords, 1)
    assert.equal(harness.steps.get('validation').status, 'pending')
    assert.equal(harness.failures[0].errorCode, 'generation_validation_failed')
  })

  await t.test('incomplete trusted manifest', async () => {
    const harness = createGenerationImportHarness()
    const loadManifest = harness.dependencies.loadManifest
    harness.dependencies.loadManifest = async () => {
      const manifest = await loadManifest()
      return manifest.map((step) => step.stepKey === 'contacts'
        ? { ...step, status: 'pending', recordCount: null }
        : step)
    }
    await assert.rejects(
      importer.importXeroGeneration(harness.params),
      (error) => error.code === 'generation_validation_failed' && error.resource === 'contacts'
    )
    assert.equal(harness.steps.get('validation').status, 'pending')
  })
})

test('deadline, lease loss, and step fencing stop further authoritative work', async (t) => {
  const { importer } = loadImporter()

  await t.test('deadline before provider work', async () => {
    let nowCalls = 0
    const harness = createGenerationImportHarness({
      now: () => {
        nowCalls += 1
        return nowCalls === 1 ? 1_000 : 2_000
      },
    })
    await assert.rejects(
      importer.importXeroGeneration({ ...harness.params, deadlineMs: 100 }),
      (error) => error.code === 'run_deadline'
    )
    assert.equal(harness.events.includes('fetch:organisation'), false)
    assert.equal(harness.failures[0].errorCode, 'run_deadline')
  })

  await t.test('heartbeat reports takeover during fetch', async () => {
    const harness = createGenerationImportHarness({
      heartbeatResult: { renewed: false, resultCode: 'superseded', leaseExpiresAt: null },
      fetchOrganisation(request) {
        return new Promise((_resolve, reject) => {
          request.signal.addEventListener('abort', () => {
            reject(new importer.XeroGenerationImportError({ code: 'run_cancelled' }))
          })
        })
      },
    })
    const running = importer.importXeroGeneration(harness.params)
    await Promise.resolve()
    await Promise.resolve()
    harness.leaseTimers[0].callback()
    await assert.rejects(running, (error) => error.code === 'lease_lost')
    assert.equal(harness.persisted.size, 0)
    assert.ok(harness.cancelledDeadlineTimers.length === 1)
  })

  await t.test('stale step completion', async () => {
    const harness = createGenerationImportHarness({ rejectStep: 'contacts' })
    await assert.rejects(
      importer.importXeroGeneration(harness.params),
      (error) => error.code === 'lease_lost'
    )
    assert.equal(harness.steps.get('canonical_mapping').status, 'pending')
  })
})

test('same-owner duplicate invocation does not start duplicate work and other owners see contention', async () => {
  const { importer } = loadImporter()
  for (const [resultCode, expectedStatus] of [
    ['already_owned', 'already_running'],
    ['lease_held', 'lease_held'],
    ['connection_not_available', 'connection_not_available'],
  ]) {
    const harness = createGenerationImportHarness({
      acquisition: {
        acquired: resultCode === 'already_owned',
        resultCode,
        syncRunId: resultCode === 'already_owned' ? 'run-existing' : null,
        fencingToken: resultCode === 'already_owned' ? 7 : null,
        leaseExpiresAt: '2026-09-15T10:05:00.000Z',
      },
    })
    const result = await importer.importXeroGeneration(harness.params)
    assert.equal(result.status, expectedStatus)
    assert.equal(harness.tokenLoads, 0)
    assert.equal(harness.persisted.size, 0)
  }
})

test('two tenants for one user import independently without shared locks or state', async () => {
  const { importer } = loadImporter()
  const tenantA = createGenerationImportHarness({ userId: 'shared-user', tenantId: 'tenant-a' })
  const tenantB = createGenerationImportHarness({
    userId: 'shared-user',
    tenantId: 'tenant-b',
    grantId: 'grant-b',
    leaseOwner: 'owner-b',
  })

  const [resultA, resultB] = await Promise.all([
    importer.importXeroGeneration(tenantA.params),
    importer.importXeroGeneration(tenantB.params),
  ])

  assert.equal(resultA.status, 'ready_for_promotion')
  assert.equal(resultB.status, 'ready_for_promotion')
  assert.notEqual(resultA.runId, resultB.runId)
  assert.equal(tenantA.failures.length, 0)
  assert.equal(tenantB.failures.length, 0)
  assert.equal(tenantA.persisted.get('organisations')[0].OrganisationID, 'tenant-a')
  assert.equal(tenantB.persisted.get('organisations')[0].OrganisationID, 'tenant-b')
})

test('one tenant failure does not fail or mutate another tenant run', async () => {
  const { importer } = loadImporter()
  const tenantA = createGenerationImportHarness({
    userId: 'shared-user',
    tenantId: 'tenant-a',
    grantId: 'shared-grant',
    fetchCollection({ name, pageResult, records }) {
      if (name === 'contacts') {
        throw new importer.XeroGenerationImportError({
          code: 'provider_unavailable',
          resource: 'contacts',
        })
      }
      return pageResult(records)
    },
  })
  const tenantB = createGenerationImportHarness({
    userId: 'shared-user',
    tenantId: 'tenant-b',
    grantId: 'shared-grant',
    leaseOwner: 'owner-b',
  })

  const [resultA, resultB] = await Promise.allSettled([
    importer.importXeroGeneration(tenantA.params),
    importer.importXeroGeneration(tenantB.params),
  ])

  assert.equal(resultA.status, 'rejected')
  assert.equal(resultA.reason.code, 'provider_unavailable')
  assert.equal(resultB.status, 'fulfilled')
  assert.equal(resultB.value.status, 'ready_for_promotion')
  assert.equal(tenantA.failures.length, 1)
  assert.equal(tenantB.failures.length, 0)
  assert.equal(tenantB.steps.get('validation').status, 'succeeded')
})

test('inactive importer has no route activation or promotion call', async () => {
  const source = await readFile(IMPORTER_PATH, 'utf8')
  const liveSync = await readFile(new URL('../../lib/xero/sync.ts', import.meta.url), 'utf8')
  const routes = await Promise.all([
    '../../app/api/xero/sync/route.ts',
    '../../app/api/xero/sync/auto/route.ts',
    '../../app/api/internal/xero/sync/route.ts',
    '../../app/api/internal/xero/scheduled-sync/route.ts',
  ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')))

  assert.doesNotMatch(source, /promote_xero_sync_run|promoteXero/)
  assert.doesNotMatch(liveSync, /importXeroGeneration/)
  assert.ok(routes.every((route) => !route.includes('importXeroGeneration')))
})
