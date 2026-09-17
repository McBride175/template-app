import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const STATUS_ROUTE_PATH = new URL('../../app/api/xero/status/route.ts', import.meta.url)
const ACCOUNT_PAGE_PATH = new URL('../../app/account/page.tsx', import.meta.url)
const SYNC_LIB_PATH = new URL('../../lib/xero/sync.ts', import.meta.url)
const SYNC_STATUS_PATH = new URL('../../lib/xero/sync-status.ts', import.meta.url)

test('status route exposes safe syncState/syncMessage instead of raw refresh error text', async () => {
  const statusRoute = await readFile(STATUS_ROUTE_PATH, 'utf8')

  assert.match(statusRoute, /resolveXeroSyncState/)
  assert.match(statusRoute, /syncState/)
  assert.match(statusRoute, /syncMessage/)
  assert.match(statusRoute, /latestSyncAttempt/)
  assert.match(statusRoute, /grantClassification/)
  assert.doesNotMatch(statusRoute, /lastRefreshError:/)
})

test('status semantics distinguish permission, running, and failed-attempt-with-active-data states', () => {
  const { resolveXeroSyncState } = loadTypeScriptModule(SYNC_STATUS_PATH)

  assert.equal(resolveXeroSyncState({
    authState: 'active',
    grantClassification: 'permission_upgrade_required',
  }), 'permission_upgrade_required')
  assert.equal(resolveXeroSyncState({
    authState: 'active',
    grantClassification: 'granular_ready',
    latestAttemptState: 'running',
  }), 'sync_in_progress')
  assert.equal(resolveXeroSyncState({
    authState: 'active',
    grantClassification: 'granular_ready',
    latestAttemptState: 'failed',
  }), 'active')
})

test('account page renders safe sync message and does not render raw last refresh error', async () => {
  const accountPage = await readFile(ACCOUNT_PAGE_PATH, 'utf8')

  assert.match(accountPage, /syncState/)
  assert.match(accountPage, /syncMessage/)
  assert.match(accountPage, /latestSyncAttempt\?\.state === 'failed'/)
  assert.match(accountPage, /previously successful Xero snapshot remains active/)
  assert.doesNotMatch(accountPage, /Last temporary refresh issue:/)
  assert.doesNotMatch(accountPage, /Last token refresh error:/)
})

test('sync library stores safe refresh issue codes', async () => {
  const syncLib = await readFile(SYNC_LIB_PATH, 'utf8')

  assert.match(syncLib, /XERO_REFRESH_ISSUE_CODES/)
  assert.match(syncLib, /REFRESH_TOKEN_INVALID/)
  assert.match(syncLib, /REFRESH_IN_PROGRESS/)
})
