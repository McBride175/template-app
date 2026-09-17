import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const FEEDBACK_PATH = new URL('../../lib/xero/first-sync-feedback.ts', import.meta.url)
const AUTO_SYNC_PATH = new URL('../../lib/xero/auto-sync-client.ts', import.meta.url)

function status(overrides = {}) {
  return {
    connected: true,
    needsReauth: false,
    hasError: false,
    hasTemporaryIssue: false,
    syncState: 'active',
    syncMessage: 'Xero is connected.',
    canSync: true,
    authState: 'active',
    tenantId: 'tenant-1',
    tenantName: 'Test tenant',
    lastSyncedAt: null,
    snapshot: { mode: 'legacy', syncRunId: null },
    grantClassification: 'granular_ready',
    latestSyncAttempt: null,
    connections: [],
    ...overrides,
  }
}

const successfulAutoSync = {
  state: 'completed',
  triggered: true,
  syncSucceeded: true,
  reason: null,
  syncStatus: 200,
}

test('new tenant first sync observes promotion and returns the generation snapshot', async () => {
  const feedback = loadTypeScriptModule(FEEDBACK_PATH)
  const initial = status()
  assert.equal(feedback.shouldObserveFirstXeroSync(initial), true)

  let statusLoads = 0
  const result = await feedback.observeFirstXeroSyncCompletion({
    autoSyncResult: successfulAutoSync,
    signal: new AbortController().signal,
    async loadStatus() {
      statusLoads += 1
      return status({
        lastSyncedAt: '2026-09-17T10:00:00Z',
        snapshot: { mode: 'generation', syncRunId: 'generation-a' },
        latestSyncAttempt: { runId: 'generation-a', state: 'promoted' },
      })
    },
  })

  assert.equal(statusLoads, 1)
  assert.equal(result.state, 'ready')
  assert.deepEqual(result.status.snapshot, {
    mode: 'generation',
    syncRunId: 'generation-a',
  })
})

test('failed first sync terminates preparation with a recoverable failure state', async () => {
  const feedback = loadTypeScriptModule(FEEDBACK_PATH)
  const result = await feedback.observeFirstXeroSyncCompletion({
    autoSyncResult: {
      ...successfulAutoSync,
      syncSucceeded: false,
      syncStatus: 502,
    },
    signal: new AbortController().signal,
    async loadStatus() {
      return status({
        syncState: 'temporary_sync_issue',
        latestSyncAttempt: { runId: 'generation-failed', state: 'failed' },
      })
    },
  })

  assert.equal(result.state, 'failed')
})

test('reauthentication and permission upgrade have distinct first-sync outcomes', () => {
  const feedback = loadTypeScriptModule(FEEDBACK_PATH)

  assert.equal(
    feedback.resolveXeroFirstSyncFeedback({
      autoSyncResult: successfulAutoSync,
      status: status({
        connected: false,
        needsReauth: true,
        authState: 'reauth_required',
        syncState: 'reconnect_required',
      }),
    }),
    'reconnect_required'
  )
  assert.equal(
    feedback.resolveXeroFirstSyncFeedback({
      autoSyncResult: successfulAutoSync,
      status: status({
        connected: false,
        syncState: 'permission_upgrade_required',
        grantClassification: 'permission_upgrade_required',
      }),
    }),
    'permission_upgrade_required'
  )
})

test('an existing active generation preserves normal Dashboard behavior', () => {
  const feedback = loadTypeScriptModule(FEEDBACK_PATH)
  assert.equal(
    feedback.shouldObserveFirstXeroSync(
      status({
        lastSyncedAt: '2026-09-17T10:00:00Z',
        snapshot: { mode: 'generation', syncRunId: 'generation-a' },
      })
    ),
    false
  )
})

test('concurrent and repeated auto-sync triggers share one request and one result', async () => {
  const autoSync = loadTypeScriptModule(AUTO_SYNC_PATH)
  let requestCount = 0
  let resolveRequest
  const responsePromise = new Promise((resolve) => {
    resolveRequest = resolve
  })
  const fetcher = async () => {
    requestCount += 1
    return responsePromise
  }
  const params = { surface: 'dashboard', tenantId: 'tenant-dedupe', fetcher }

  const first = autoSync.triggerXeroAutoSyncOnEntry(params)
  const second = autoSync.triggerXeroAutoSyncOnEntry(params)
  assert.equal(first, second)
  assert.equal(requestCount, 1)

  resolveRequest({
    ok: true,
    status: 200,
    async json() {
      return { triggered: true, syncSucceeded: true, syncStatus: 200 }
    },
  })
  const [firstResult, secondResult] = await Promise.all([first, second])
  const repeatedResult = await autoSync.triggerXeroAutoSyncOnEntry(params)

  assert.deepEqual(firstResult, secondResult)
  assert.deepEqual(repeatedResult, firstResult)
  assert.equal(requestCount, 1)
})

test('component abort stops cross-tab status polling without another request loop', async () => {
  const feedback = loadTypeScriptModule(FEEDBACK_PATH)
  const controller = new AbortController()
  let statusLoads = 0
  let waits = 0

  const result = await feedback.observeFirstXeroSyncCompletion({
    autoSyncResult: {
      ...successfulAutoSync,
      triggered: false,
      syncSucceeded: null,
      reason: 'auto_sync_in_progress',
    },
    signal: controller.signal,
    async loadStatus() {
      statusLoads += 1
      return status({
        syncState: 'sync_in_progress',
        latestSyncAttempt: { runId: 'generation-running', state: 'running' },
      })
    },
    async wait() {
      waits += 1
      controller.abort()
    },
  })

  assert.equal(result.state, 'cancelled')
  assert.equal(statusLoads, 1)
  assert.equal(waits, 1)
})

test('cross-tab status polling is bounded and fails instead of preparing forever', async () => {
  const feedback = loadTypeScriptModule(FEEDBACK_PATH)
  let statusLoads = 0
  const result = await feedback.observeFirstXeroSyncCompletion({
    autoSyncResult: {
      ...successfulAutoSync,
      triggered: false,
      syncSucceeded: null,
      reason: 'auto_sync_in_progress',
    },
    signal: new AbortController().signal,
    maxStatusChecks: 3,
    async loadStatus() {
      statusLoads += 1
      return status({
        syncState: 'sync_in_progress',
        latestSyncAttempt: { runId: 'generation-running', state: 'running' },
      })
    },
    async wait() {},
  })

  assert.equal(result.state, 'failed')
  assert.equal(statusLoads, 3)
})
