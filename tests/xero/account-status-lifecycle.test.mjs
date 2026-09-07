import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const ACCOUNT_STATUS_PATH = new URL('../../lib/xero/account-status.ts', import.meta.url)
const ACCOUNT_PAGE_PATH = new URL('../../app/account/page.tsx', import.meta.url)
const STATUS_ROUTE_PATH = new URL('../../app/api/xero/status/route.ts', import.meta.url)

const {
  XERO_STATUS_UNAVAILABLE_MESSAGE,
  fetchXeroConnectionStatus,
  resolveXeroAccountStatusView,
  shouldShowXeroConnectCta,
} = loadTypeScriptModule(ACCOUNT_STATUS_PATH)

function buildStatus(overrides = {}) {
  return {
    connected: true,
    needsReauth: false,
    hasError: false,
    hasTemporaryIssue: false,
    syncState: 'active',
    syncMessage: 'Connected and ready to sync.',
    canSync: true,
    authState: 'active',
    tenantId: 'tenant-active',
    tenantName: 'Demo Company',
    lastSyncedAt: '2026-08-30T16:31:43.919Z',
    connections: [],
    ...overrides,
  }
}

function mockResponse(status, payload = { error: 'Request failed' }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload
    },
  }
}

async function runLoad(fetcher, previousStatus = null) {
  const state = {
    loading: true,
    status: previousStatus,
    statusError: null,
  }

  try {
    state.status = await fetchXeroConnectionStatus(null, fetcher)
    state.statusError = null
  } catch {
    state.statusError = XERO_STATUS_UNAVAILABLE_MESSAGE
  } finally {
    state.loading = false
  }

  return {
    ...state,
    viewState: resolveXeroAccountStatusView(state),
  }
}

test('successful active status response resolves to connected UI', async () => {
  const status = buildStatus()
  const state = await runLoad(async () => mockResponse(200, status))

  assert.equal(state.viewState, 'connected')
  assert.equal(state.status.tenantId, 'tenant-active')
  assert.equal(state.statusError, null)
  assert.equal(shouldShowXeroConnectCta(state.viewState), false)
})

test('successful no-connection status is the only state that shows Connect Xero', async () => {
  const disconnected = buildStatus({
    connected: false,
    syncState: 'disconnected',
    syncMessage: 'Xero is not connected.',
    canSync: false,
    authState: 'disconnected',
    tenantId: null,
    tenantName: null,
    lastSyncedAt: null,
  })
  const state = await runLoad(async () => mockResponse(200, disconnected))

  assert.equal(state.viewState, 'disconnected')
  assert.equal(shouldShowXeroConnectCta(state.viewState), true)
})

for (const statusCode of [401, 500]) {
  test(`status ${statusCode} resolves to error UI and never Connect Xero`, async () => {
    const state = await runLoad(async () => mockResponse(statusCode))

    assert.equal(state.status, null)
    assert.equal(state.statusError, XERO_STATUS_UNAVAILABLE_MESSAGE)
    assert.equal(state.viewState, 'error')
    assert.equal(shouldShowXeroConnectCta(state.viewState), false)
  })
}

test('network failure resolves to error UI and never Connect Xero', async () => {
  const state = await runLoad(async () => {
    throw new TypeError('Network request failed')
  })

  assert.equal(state.status, null)
  assert.equal(state.viewState, 'error')
  assert.equal(shouldShowXeroConnectCta(state.viewState), false)
})

test('failed refresh preserves the previous valid connected status', async () => {
  const previousStatus = buildStatus()
  const state = await runLoad(async () => mockResponse(500), previousStatus)

  assert.equal(state.status, previousStatus)
  assert.equal(state.statusError, XERO_STATUS_UNAVAILABLE_MESSAGE)
  assert.equal(state.viewState, 'connected')
  assert.equal(shouldShowXeroConnectCta(state.viewState), false)
})

test('confirmed reconnect and temporary states remain distinct from disconnected', () => {
  const reconnectState = resolveXeroAccountStatusView({
    loading: false,
    status: buildStatus({ connected: false, needsReauth: true, syncState: 'reconnect_required' }),
    statusError: null,
  })
  const temporaryState = resolveXeroAccountStatusView({
    loading: false,
    status: buildStatus({ hasTemporaryIssue: true, syncState: 'temporary_sync_issue' }),
    statusError: null,
  })

  assert.equal(reconnectState, 'reconnect_required')
  assert.equal(temporaryState, 'temporary_issue')
  assert.equal(shouldShowXeroConnectCta(reconnectState), false)
  assert.equal(shouldShowXeroConnectCta(temporaryState), false)
})

test('retry after a failed status request recovers to connected UI', async () => {
  let attempt = 0
  const fetcher = async () => {
    attempt += 1
    return attempt === 1 ? mockResponse(500) : mockResponse(200, buildStatus())
  }

  const failedState = await runLoad(fetcher)
  assert.equal(failedState.viewState, 'error')

  const recoveredState = await runLoad(fetcher, failedState.status)
  assert.equal(recoveredState.viewState, 'connected')
  assert.equal(recoveredState.statusError, null)
  assert.equal(shouldShowXeroConnectCta(recoveredState.viewState), false)
})

test('Account page gates Connect Xero on confirmed disconnected state and exposes retry', async () => {
  const source = await readFile(ACCOUNT_PAGE_PATH, 'utf8')

  assert.match(source, /showXeroConnectCta && xeroStatus/)
  assert.match(source, /xeroStatusView === 'error'/)
  assert.match(source, /handleXeroStatusRetry/)
  assert.match(source, /XERO_STATUS_UNAVAILABLE_MESSAGE/)
  assert.doesNotMatch(source, /!xeroStatus\?\.connected/)
})

test('status failure diagnostics contain lifecycle context and no secret fields', async () => {
  const source = await readFile(STATUS_ROUTE_PATH, 'utf8')
  const loggingStart = source.indexOf('function logXeroStatusFailure')
  const loggingEnd = source.indexOf('function parseTenantId')
  const loggingSource = source.slice(loggingStart, loggingEnd)

  assert.match(loggingSource, /supabaseProjectRef/)
  assert.match(loggingSource, /authSucceeded/)
  assert.match(loggingSource, /connectionQuerySucceeded/)
  assert.match(loggingSource, /connectionRowCount/)
  assert.match(loggingSource, /selectedTenantId/)
  assert.match(loggingSource, /status: params\.status/)
  assert.doesNotMatch(loggingSource, /access.?token/i)
  assert.doesNotMatch(loggingSource, /refresh.?token/i)
  assert.doesNotMatch(loggingSource, /encryption.?key/i)
  assert.doesNotMatch(loggingSource, /authorization/i)
  assert.doesNotMatch(loggingSource, /cookie/i)
  assert.doesNotMatch(loggingSource, /oauth.?code/i)
})
