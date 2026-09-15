import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'
import {
  buildBaseSyncState,
  createSyncHarness,
} from './test-helpers/xero-sync-harness.mjs'

const CLIENT_PATH = new URL('../../lib/xero/accounting-api-client.ts', import.meta.url)
const SYNC_PATH = new URL('../../lib/xero/sync.ts', import.meta.url)

const client = loadTypeScriptModule(CLIENT_PATH)

function jsonResponse(payload, options = {}) {
  return new Response(JSON.stringify(payload), {
    status: options.status ?? 200,
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
}

function createDependencies(fetchImplementation, options = {}) {
  const delays = []
  const scheduledTimeouts = []
  const cancelledTimeouts = []

  return {
    delays,
    scheduledTimeouts,
    cancelledTimeouts,
    value: {
      fetch: fetchImplementation,
      async sleep(milliseconds) {
        delays.push(milliseconds)
      },
      random: options.random ?? (() => 0.5),
      now: options.now ?? (() => Date.parse('2026-09-14T12:00:00.000Z')),
      scheduleTimeout(callback, milliseconds) {
        const handle = { callback, milliseconds }
        scheduledTimeouts.push(handle)
        if (options.fireTimeouts) queueMicrotask(callback)
        return handle
      },
      cancelTimeout(handle) {
        cancelledTimeouts.push(handle)
      },
    },
  }
}

function sequenceFetcher(sequence, calls = []) {
  let index = 0
  return async (input, init) => {
    calls.push({ url: new URL(String(input)), init })
    const item = sequence[index]
    index += 1
    if (item instanceof Error) throw item
    if (typeof item === 'function') return item(input, init)
    if (!item) throw new Error(`Unexpected request ${index}`)
    return item
  }
}

function contact(id, extra = {}) {
  return { ContactID: id, ...extra }
}

function paginatedOptions(fetchImplementation, overrides = {}) {
  const dependencies = createDependencies(fetchImplementation)
  return {
    dependencies,
    options: {
      accessToken: 'secret-access-token',
      tenantId: 'tenant-1',
      config: client.createXeroContactsCollectionConfig(),
      dependencies: dependencies.value,
      ...overrides,
    },
  }
}

function requestOptions(fetchImplementation, overrides = {}) {
  const dependencies = createDependencies(fetchImplementation)
  return {
    dependencies,
    options: {
      accessToken: 'secret-access-token',
      tenantId: 'tenant-1',
      resource: 'contacts',
      path: '/Contacts',
      responseKey: 'Contacts',
      page: 1,
      query: { page: 1, pageSize: 1000, order: 'ContactID' },
      dependencies: dependencies.value,
      ...overrides,
    },
  }
}

test('pagination returns an explicitly fetched empty collection', async () => {
  const calls = []
  const { options } = paginatedOptions(
    sequenceFetcher([jsonResponse({ Contacts: [] })], calls)
  )

  const result = await client.fetchXeroPaginatedCollection(options)

  assert.deepEqual(result.records, [])
  assert.equal(result.recordCount, 0)
  assert.equal(result.populatedPageCount, 0)
  assert.equal(result.pageRequestCount, 1)
  assert.equal(result.httpAttemptCount, 1)
  assert.equal(calls[0].url.searchParams.get('page'), '1')
})

test('one record is followed by the required empty page', async () => {
  const calls = []
  const { options } = paginatedOptions(
    sequenceFetcher(
      [jsonResponse({ Contacts: [contact('c-1')] }), jsonResponse({ Contacts: [] })],
      calls
    )
  )

  const result = await client.fetchXeroPaginatedCollection(options)

  assert.deepEqual(result.records, [contact('c-1')])
  assert.equal(result.populatedPageCount, 1)
  assert.equal(result.pageRequestCount, 2)
  assert.deepEqual(calls.map((call) => call.url.searchParams.get('page')), ['1', '2'])
})

test('a short page never terminates traversal before an empty page', async () => {
  const calls = []
  const { options } = paginatedOptions(
    sequenceFetcher(
      [jsonResponse({ Contacts: [contact('c-1')] }), jsonResponse({ Contacts: [] })],
      calls
    ),
    { pageSize: 3 }
  )

  const result = await client.fetchXeroPaginatedCollection(options)

  assert.equal(result.recordCount, 1)
  assert.equal(result.pageRequestCount, 2)
  assert.deepEqual(calls.map((call) => call.url.searchParams.get('pageSize')), ['3', '3'])
})

test('exactly one full page is followed by an empty page', async () => {
  const calls = []
  const { options } = paginatedOptions(
    sequenceFetcher(
      [
        jsonResponse({ Contacts: [contact('c-1'), contact('c-2')] }),
        jsonResponse({ Contacts: [] }),
      ],
      calls
    ),
    { pageSize: 2 }
  )

  const result = await client.fetchXeroPaginatedCollection(options)

  assert.equal(result.recordCount, 2)
  assert.equal(result.populatedPageCount, 1)
  assert.equal(result.pageRequestCount, 2)
})

test('page size plus one traverses two populated pages and a final empty page', async () => {
  const calls = []
  const { options } = paginatedOptions(
    sequenceFetcher(
      [
        jsonResponse({ Contacts: [contact('c-1'), contact('c-2')] }),
        jsonResponse({ Contacts: [contact('c-3')] }),
        jsonResponse({ Contacts: [] }),
      ],
      calls
    ),
    { pageSize: 2 }
  )

  const result = await client.fetchXeroPaginatedCollection(options)

  assert.deepEqual(result.records.map((record) => record.ContactID), ['c-1', 'c-2', 'c-3'])
  assert.equal(result.populatedPageCount, 2)
  assert.equal(result.pageRequestCount, 3)
  assert.deepEqual(calls.map((call) => call.url.searchParams.get('page')), ['1', '2', '3'])
})

test('several populated pages preserve query parameters, page size, and stable order', async () => {
  const calls = []
  const config = client.createXeroContactsCollectionConfig({
    includeArchived: true,
    where: 'Name=="Example"',
    query: { SearchTerm: 'example' },
  })
  const { options } = paginatedOptions(
    sequenceFetcher(
      [
        jsonResponse({ Contacts: [contact('c-1')] }),
        jsonResponse({ Contacts: [contact('c-2')] }),
        jsonResponse({ Contacts: [contact('c-3')] }),
        jsonResponse({ Contacts: [] }),
      ],
      calls
    ),
    { config, pageSize: 1 }
  )

  const result = await client.fetchXeroPaginatedCollection(options)

  assert.equal(result.populatedPageCount, 3)
  assert.equal(result.pageRequestCount, 4)
  for (const [index, call] of calls.entries()) {
    assert.equal(call.url.searchParams.get('page'), String(index + 1))
    assert.equal(call.url.searchParams.get('pageSize'), '1')
    assert.equal(call.url.searchParams.get('order'), 'ContactID')
    assert.equal(call.url.searchParams.get('includeArchived'), 'true')
    assert.equal(call.url.searchParams.get('where'), 'Name=="Example"')
    assert.equal(call.url.searchParams.get('SearchTerm'), 'example')
  }
})

test('missing or invalid response envelopes fail without another page request', async () => {
  const cases = [
    { payload: null, message: /envelope was not an object/ },
    { payload: {}, message: /missing Contacts/ },
    { payload: { Contacts: {} }, message: /Contacts was not an array/ },
  ]

  for (const testCase of cases) {
    let calls = 0
    const { options } = requestOptions(async () => {
      calls += 1
      return jsonResponse(testCase.payload)
    })

    await assert.rejects(
      client.requestXeroAccountingCollectionPage(options),
      (error) => {
        assert.equal(error.kind, 'malformed_response')
        assert.match(error.message, testCase.message)
        return true
      }
    )
    assert.equal(calls, 1)
  }
})

test('invalid JSON is a non-retryable malformed payload', async () => {
  let calls = 0
  const { options } = requestOptions(async () => {
    calls += 1
    return new Response('{', { status: 200, headers: { 'content-type': 'application/json' } })
  })

  await assert.rejects(client.requestXeroAccountingCollectionPage(options), (error) => {
    assert.equal(error.kind, 'malformed_response')
    assert.equal(error.retryable, false)
    return true
  })
  assert.equal(calls, 1)
})

test('non-object records and records without source IDs fail pagination', async () => {
  for (const [record, expectedKind] of [
    [null, 'invalid_record'],
    [{ Name: 'No ID' }, 'missing_source_id'],
  ]) {
    const { options } = paginatedOptions(async () => jsonResponse({ Contacts: [record] }))
    await assert.rejects(client.fetchXeroPaginatedCollection(options), (error) => {
      assert.equal(error.kind, expectedKind)
      assert.equal(error.page, 1)
      return true
    })
  }
})

test('an identical duplicate source ID is a classified unstable traversal error', async () => {
  const duplicate = contact('c-1', { Name: 'Same' })
  const { options } = paginatedOptions(
    sequenceFetcher([
      jsonResponse({ Contacts: [duplicate] }),
      jsonResponse({ Contacts: [{ ...duplicate }] }),
    ]),
    { pageSize: 1 }
  )

  await assert.rejects(client.fetchXeroPaginatedCollection(options), (error) => {
    assert.equal(error.kind, 'duplicate_record')
    assert.equal(error.duplicateKind, 'identical')
    assert.doesNotMatch(error.message, /c-1/)
    return true
  })
})

test('a conflicting duplicate source ID fails explicitly', async () => {
  const { options } = paginatedOptions(
    sequenceFetcher([
      jsonResponse({ Contacts: [contact('c-1', { Name: 'Before' })] }),
      jsonResponse({ Contacts: [contact('c-1', { Name: 'After' })] }),
    ]),
    { pageSize: 1 }
  )

  await assert.rejects(client.fetchXeroPaginatedCollection(options), (error) => {
    assert.equal(error.kind, 'duplicate_record')
    assert.equal(error.duplicateKind, 'conflicting')
    return true
  })
})

test('distinct source IDs do not trigger duplicate detection', async () => {
  const { options } = paginatedOptions(
    sequenceFetcher([
      jsonResponse({ Contacts: [contact('c-1')] }),
      jsonResponse({ Contacts: [contact('c-2')] }),
      jsonResponse({ Contacts: [] }),
    ]),
    { pageSize: 1 }
  )

  const result = await client.fetchXeroPaginatedCollection(options)
  assert.deepEqual(result.records.map((record) => record.ContactID), ['c-1', 'c-2'])
})

test('page ceiling fails instead of returning a truncated collection', async () => {
  const { options } = paginatedOptions(
    sequenceFetcher([
      jsonResponse({ Contacts: [contact('c-1')] }),
      jsonResponse({ Contacts: [contact('c-2')] }),
    ]),
    { pageSize: 1, maxPages: 2 }
  )

  await assert.rejects(client.fetchXeroPaginatedCollection(options), (error) => {
    assert.equal(error.kind, 'page_limit_exceeded')
    assert.equal(error.page, 2)
    return true
  })
})

test('request timeout is simulated and exhausts after three attempts without real waiting', async () => {
  let calls = 0
  const dependencies = createDependencies(
    async (_input, init) => {
      calls += 1
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    },
    { fireTimeouts: true }
  )

  await assert.rejects(
    client.requestXeroAccountingCollectionPage({
      accessToken: 'secret-access-token',
      tenantId: 'tenant-1',
      resource: 'contacts',
      path: '/Contacts',
      responseKey: 'Contacts',
      page: 1,
      timeoutMs: 30_000,
      dependencies: dependencies.value,
    }),
    (error) => {
      assert.equal(error.kind, 'timeout')
      assert.equal(error.attemptCount, 3)
      assert.equal(error.retryable, true)
      assert.doesNotMatch(error.message, /secret-access-token/)
      return true
    }
  )

  assert.equal(calls, 3)
  assert.deepEqual(dependencies.scheduledTimeouts.map((timer) => timer.milliseconds), [
    30_000,
    30_000,
    30_000,
  ])
  assert.deepEqual(dependencies.delays, [500, 1000])
})

test('a transient network error retries and then succeeds', async () => {
  const { dependencies, options } = requestOptions(
    sequenceFetcher([
      new TypeError('network unavailable'),
      jsonResponse({ Contacts: [contact('c-1')] }),
    ])
  )

  const result = await client.requestXeroAccountingCollectionPage(options)

  assert.equal(result.attemptCount, 2)
  assert.deepEqual(dependencies.delays, [500])
})

test('the transient network retry budget is bounded at three attempts', async () => {
  let calls = 0
  const { dependencies, options } = requestOptions(async () => {
    calls += 1
    throw new TypeError('network unavailable')
  })

  await assert.rejects(client.requestXeroAccountingCollectionPage(options), (error) => {
    assert.equal(error.kind, 'network')
    assert.equal(error.attemptCount, 3)
    return true
  })
  assert.equal(calls, 3)
  assert.deepEqual(dependencies.delays, [500, 1000])
})

test('HTTP 500 retries once and can recover', async () => {
  const { dependencies, options } = requestOptions(
    sequenceFetcher([
      jsonResponse({ error: 'sensitive provider detail' }, { status: 500 }),
      jsonResponse({ Contacts: [] }),
    ])
  )

  const result = await client.requestXeroAccountingCollectionPage(options)

  assert.equal(result.attemptCount, 2)
  assert.deepEqual(dependencies.delays, [500])
})

test('HTTP 408 participates in the bounded transient retry policy', async () => {
  const { dependencies, options } = requestOptions(
    sequenceFetcher([
      jsonResponse({}, { status: 408 }),
      jsonResponse({ Contacts: [] }),
    ])
  )

  const result = await client.requestXeroAccountingCollectionPage(options)

  assert.equal(result.attemptCount, 2)
  assert.deepEqual(dependencies.delays, [500])
})

for (const status of [502, 504]) {
  test(`HTTP ${status} participates in the bounded transient retry policy`, async () => {
    const { dependencies, options } = requestOptions(
      sequenceFetcher([
        jsonResponse({}, { status }),
        jsonResponse({ Contacts: [] }),
      ])
    )

    const result = await client.requestXeroAccountingCollectionPage(options)

    assert.equal(result.attemptCount, 2)
    assert.deepEqual(dependencies.delays, [500])
  })
}

test('repeated HTTP 503 exhausts after three attempts', async () => {
  const { dependencies, options } = requestOptions(
    sequenceFetcher([
      jsonResponse({}, { status: 503 }),
      jsonResponse({}, { status: 503 }),
      jsonResponse({}, { status: 503 }),
    ])
  )

  await assert.rejects(client.requestXeroAccountingCollectionPage(options), (error) => {
    assert.equal(error.kind, 'http')
    assert.equal(error.status, 503)
    assert.equal(error.attemptCount, 3)
    assert.equal(error.retryable, true)
    return true
  })
  assert.deepEqual(dependencies.delays, [500, 1000])
})

for (const status of [400, 404]) {
  test(`HTTP ${status} is not retried`, async () => {
    let calls = 0
    const { options } = requestOptions(async () => {
      calls += 1
      return jsonResponse({ detail: 'must not appear in the error' }, { status })
    })

    await assert.rejects(client.requestXeroAccountingCollectionPage(options), (error) => {
      assert.equal(error.kind, 'http')
      assert.equal(error.status, status)
      assert.equal(error.retryable, false)
      assert.doesNotMatch(error.message, /must not appear/)
      return true
    })
    assert.equal(calls, 1)
  })
}

test('HTTP 429 honours Retry-After and captures rate-limit metadata', async () => {
  const calls = []
  const { dependencies, options } = requestOptions(
    sequenceFetcher(
      [
        jsonResponse({}, {
          status: 429,
          headers: {
            'retry-after': '2',
            'x-minlimit-remaining': '0',
            'x-daylimit-remaining': '4521',
            'x-appminlimit-remaining': '9900',
            'x-rate-limit-problem': 'minute',
            'xero-correlation-id': 'correlation-retry',
          },
        }),
        jsonResponse(
          { Contacts: [] },
          {
            headers: {
              'x-minlimit-remaining': '59',
              'x-daylimit-remaining': '4520',
              'x-appminlimit-remaining': '9899',
              'xero-correlation-id': 'correlation-success',
            },
          }
        ),
      ],
      calls
    )
  )

  const result = await client.requestXeroAccountingCollectionPage(options)

  assert.equal(result.attemptCount, 2)
  assert.deepEqual(dependencies.delays, [2000])
  assert.equal(result.metadata.minimumMinuteRemaining, 0)
  assert.equal(result.metadata.latestMinuteRemaining, 59)
  assert.equal(result.metadata.minimumDayRemaining, 4520)
  assert.equal(result.metadata.maximumRetryAfterSeconds, 2)
  assert.deepEqual(result.metadata.rateLimitProblems, ['minute'])
  assert.deepEqual(result.metadata.correlationIds, [
    'correlation-retry',
    'correlation-success',
  ])
  assert.equal(calls.length, 2)
})

test('repeated HTTP 429 stops after two retries', async () => {
  const { dependencies, options } = requestOptions(
    sequenceFetcher([
      jsonResponse({}, { status: 429, headers: { 'retry-after': '1' } }),
      jsonResponse({}, { status: 429, headers: { 'retry-after': '1' } }),
      jsonResponse({}, { status: 429, headers: { 'retry-after': '1' } }),
    ])
  )

  await assert.rejects(client.requestXeroAccountingCollectionPage(options), (error) => {
    assert.equal(error.kind, 'rate_limit')
    assert.equal(error.attemptCount, 3)
    return true
  })
  assert.deepEqual(dependencies.delays, [1000, 1000])
})

test('a daily allowance 429 is classified and never retried', async () => {
  let calls = 0
  const { dependencies, options } = requestOptions(async () => {
    calls += 1
    return jsonResponse({}, {
      status: 429,
      headers: {
        'retry-after': '3600',
        'x-rate-limit-problem': 'day',
      },
    })
  })

  await assert.rejects(client.requestXeroAccountingCollectionPage(options), (error) => {
    assert.equal(error.kind, 'daily_rate_limit')
    assert.equal(error.retryable, false)
    assert.equal(error.metadata.maximumRetryAfterSeconds, 3600)
    return true
  })
  assert.equal(calls, 1)
  assert.deepEqual(dependencies.delays, [])
})

test('pagination aggregates response metadata and HTTP attempt counts', async () => {
  const { options } = paginatedOptions(
    sequenceFetcher([
      jsonResponse({ Contacts: [contact('c-1')] }, {
        headers: {
          'x-minlimit-remaining': '50',
          'xero-correlation-id': 'page-1',
        },
      }),
      jsonResponse({ Contacts: [] }, {
        headers: {
          'x-minlimit-remaining': '49',
          'xero-correlation-id': 'page-2',
        },
      }),
    ])
  )

  const result = await client.fetchXeroPaginatedCollection(options)

  assert.equal(result.httpAttemptCount, 2)
  assert.equal(result.metadata.minimumMinuteRemaining, 49)
  assert.equal(result.metadata.latestMinuteRemaining, 49)
  assert.deepEqual(result.metadata.correlationIds, ['page-1', 'page-2'])
})

test('401 and 403 are surfaced without internal retries or response-body leakage', async () => {
  for (const [status, expectedKind] of [
    [401, 'authentication'],
    [403, 'permission'],
  ]) {
    let calls = 0
    const { options } = requestOptions(async () => {
      calls += 1
      return jsonResponse({ token: 'sensitive-provider-body' }, { status })
    })

    await assert.rejects(client.requestXeroAccountingCollectionPage(options), (error) => {
      assert.equal(error.kind, expectedKind)
      assert.equal(error.attemptCount, 1)
      assert.doesNotMatch(error.message, /sensitive-provider-body|secret-access-token/)
      return true
    })
    assert.equal(calls, 1)
  }
})

test('Contacts adapter uses explicit pagination, ContactID order, and contacts capability', async () => {
  const calls = []
  const dependencies = createDependencies(
    sequenceFetcher([jsonResponse({ Contacts: [] })], calls)
  )

  await client.fetchXeroContacts({
    accessToken: 'token',
    tenantId: 'tenant',
    endpoint: { includeArchived: true, where: 'Name=="Example"' },
    dependencies: dependencies.value,
  })

  const requestUrl = calls[0].url
  assert.equal(requestUrl.pathname, '/api.xro/2.0/Contacts')
  assert.equal(requestUrl.searchParams.get('page'), '1')
  assert.equal(requestUrl.searchParams.get('pageSize'), '1000')
  assert.equal(requestUrl.searchParams.get('order'), 'ContactID')
  assert.equal(requestUrl.searchParams.get('includeArchived'), 'true')
  assert.equal(requestUrl.searchParams.get('where'), 'Name=="Example"')
  assert.equal(client.createXeroContactsCollectionConfig().granularCapability, 'accounting.contacts')
})

test('AUTHORISED and PAID ACCREC invoice adapters preserve exact Xero query syntax', () => {
  const authorised = client.createXeroAuthorisedAccrecInvoicesConfig({ summaryOnly: true })
  const paid = client.createXeroPaidAccrecInvoicesConfig()

  assert.equal(authorised.path, '/Invoices')
  assert.equal(authorised.responseKey, 'Invoices')
  assert.equal(authorised.order, 'InvoiceID')
  assert.deepEqual(authorised.query.Statuses, ['AUTHORISED'])
  assert.equal(authorised.query.where, 'Type=="ACCREC"')
  assert.equal(authorised.query.summaryOnly, true)
  assert.equal(authorised.granularCapability, 'accounting.invoices')
  assert.deepEqual(paid.query.Statuses, ['PAID'])
  assert.equal(paid.query.where, 'Type=="ACCREC"')
})

test('Payments adapter supports the authorised ACCREC payment query and PaymentID order', async () => {
  const calls = []
  const dependencies = createDependencies(
    sequenceFetcher([jsonResponse({ Payments: [] })], calls)
  )
  const config = client.createXeroAuthorisedAccrecPaymentsConfig()

  await client.fetchXeroPaginatedCollection({
    accessToken: 'token',
    tenantId: 'tenant',
    config,
    dependencies: dependencies.value,
  })

  const requestUrl = calls[0].url
  assert.equal(requestUrl.pathname, '/api.xro/2.0/Payments')
  assert.equal(requestUrl.searchParams.get('where'), 'PaymentType=="ACCRECPAYMENT" AND Status=="AUTHORISED"')
  assert.equal(requestUrl.searchParams.get('order'), 'PaymentID')
  assert.equal(config.granularCapability, 'accounting.payments')
})

test('Invoices convenience adapter fetches the actual endpoint with preserved filters', async () => {
  const calls = []
  const dependencies = createDependencies(
    sequenceFetcher([jsonResponse({ Invoices: [] })], calls)
  )

  await client.fetchXeroInvoices({
    accessToken: 'token',
    tenantId: 'tenant',
    endpoint: {
      statuses: ['AUTHORISED', 'PAID'],
      where: 'Type=="ACCREC"',
      summaryOnly: true,
    },
    dependencies: dependencies.value,
  })

  assert.equal(calls[0].url.searchParams.get('Statuses'), 'AUTHORISED,PAID')
  assert.equal(calls[0].url.searchParams.get('where'), 'Type=="ACCREC"')
  assert.equal(calls[0].url.searchParams.get('summaryOnly'), 'true')
  assert.equal(calls[0].url.searchParams.get('order'), 'InvoiceID')
})

function buildAuthRegressionState() {
  const state = buildBaseSyncState()
  state.connections.push({
    user_id: 'user-auth',
    tenant_id: 'tenant-auth',
    grant_id: 'grant-auth',
    auth_state: 'active',
    last_refresh_error: null,
    reauth_required_at: null,
  })
  state.grants.push({
    id: 'grant-auth',
    user_id: 'user-auth',
    xero_user_id: 'xero-user-auth',
    scopes: ['accounting.transactions.read'],
    access_token_encrypted: 'old-access-token',
    refresh_token_encrypted: 'refresh-token',
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    refresh_lock_id: null,
    refresh_lock_expires_at: null,
  })
  return state
}

test('legacy live sync still performs at most one forced refresh after a 401', async () => {
  const state = buildAuthRegressionState()
  let AccountingError
  const harness = createSyncHarness({
    syncModuleSpecifier: SYNC_PATH,
    state,
    async refreshBehavior() {
      return {
        accessToken: 'refreshed-access-token',
        refreshToken: 'rotated-refresh-token',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }
    },
    async fetchBehavior({ resourceType, accessToken }) {
      if (accessToken === 'old-access-token') {
        throw new AccountingError({ status: 401, resourceType })
      }
      return [{ id: `${resourceType}-1` }]
    },
  })
  AccountingError = harness.XeroAccountingApiError

  const response = await harness.syncXeroTenantForUser({
    userId: 'user-auth',
    tenantId: 'tenant-auth',
  })

  assert.equal(response.status, 200)
  assert.equal(harness.refreshCalls.length, 1)
  assert.equal(
    harness.fetchCalls.some((call) => call.accessToken === 'refreshed-access-token'),
    true
  )
})

test('legacy live sync does not loop when forced token refresh fails', async () => {
  const state = buildAuthRegressionState()
  let AccountingError
  let RefreshError
  const harness = createSyncHarness({
    syncModuleSpecifier: SYNC_PATH,
    state,
    async refreshBehavior() {
      throw new RefreshError({
        status: 400,
        code: 'invalid_grant',
        description: 'refresh token revoked',
        requiresReauth: true,
      })
    },
    async fetchBehavior({ resourceType }) {
      throw new AccountingError({ status: 401, resourceType })
    },
  })
  AccountingError = harness.XeroAccountingApiError
  RefreshError = harness.XeroTokenRefreshError

  const response = await harness.syncXeroTenantForUser({
    userId: 'user-auth',
    tenantId: 'tenant-auth',
  })
  const payload = await response.json()

  assert.equal(response.status, 409)
  assert.equal(payload.code, 'XERO_REAUTH_REQUIRED')
  assert.equal(harness.refreshCalls.length, 1)
})

test('persistent permission failure after forced refresh is surfaced without another refresh', async () => {
  const state = buildAuthRegressionState()
  let AccountingError
  const harness = createSyncHarness({
    syncModuleSpecifier: SYNC_PATH,
    state,
    async refreshBehavior() {
      return {
        accessToken: 'refreshed-access-token',
        refreshToken: 'rotated-refresh-token',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }
    },
    async fetchBehavior({ resourceType, accessToken }) {
      throw new AccountingError({
        status: accessToken === 'old-access-token' ? 401 : 403,
        resourceType,
      })
    },
  })
  AccountingError = harness.XeroAccountingApiError

  const response = await harness.syncXeroTenantForUser({
    userId: 'user-auth',
    tenantId: 'tenant-auth',
  })
  const payload = await response.json()

  assert.equal(response.status, 409)
  assert.equal(payload.code, 'XERO_REAUTH_REQUIRED')
  assert.equal(harness.refreshCalls.length, 1)
})
