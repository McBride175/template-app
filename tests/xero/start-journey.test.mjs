import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const projectFile = (path) => new URL(`../../${path}`, import.meta.url)
const startJourney = loadTypeScriptModule(projectFile('lib/xero/start-journey.ts'), {
  mocks: { '@/lib/xero/account-status': {} },
})

function connection(tenantId, overrides = {}) {
  return {
    tenantId,
    tenantName: `Organisation ${tenantId}`,
    authState: 'active',
    syncState: 'active',
    syncMessage: 'Connected.',
    canSync: true,
    needsReauth: false,
    hasError: false,
    reauthRequiredAt: null,
    updatedAt: '2026-09-17T12:00:00Z',
    ...overrides,
  }
}

function status(connections, overrides = {}) {
  return {
    connected: connections.some((item) => item.authState === 'active'),
    tenantId: connections[0]?.tenantId ?? null,
    tenantName: connections[0]?.tenantName ?? null,
    lastSyncedAt: null,
    connections,
    syncState: connections[0]?.syncState ?? 'disconnected',
    ...overrides,
  }
}

test('new authenticated users move directly to Xero', () => {
  assert.deepEqual(startJourney.resolveStartJourney(status([]), null), { kind: 'connect' })
})

test('one active organisation continues without a selection screen', () => {
  assert.deepEqual(
    startJourney.resolveStartJourney(status([connection('tenant-1')]), null),
    { kind: 'continue', tenantId: 'tenant-1' }
  )
})

test('multiple active organisations require a choice instead of array-order selection', () => {
  const decision = startJourney.resolveStartJourney(
    status([connection('tenant-a'), connection('tenant-b')]),
    null
  )
  assert.equal(decision.kind, 'select_organisation')
  assert.deepEqual(decision.connections.map((item) => item.tenantId), ['tenant-a', 'tenant-b'])
})

test('foreign or stale tenant requests fail closed', () => {
  const decision = startJourney.resolveStartJourney(
    status([connection('tenant-owned')]),
    'tenant-foreign'
  )
  assert.equal(decision.kind, 'invalid_selection')
})

test('running preparation and active generations both continue into the existing workspace', () => {
  const running = connection('tenant-1', { syncState: 'sync_in_progress' })
  assert.equal(startJourney.resolveStartJourney(status([running]), null).kind, 'continue')
  assert.equal(
    startJourney.resolveStartJourney(
      status([connection('tenant-1')], {
        snapshot: { mode: 'generation', syncRunId: 'generation-1' },
      }),
      null
    ).kind,
    'continue'
  )
})

test('reconnect and permission states remain focused in the resolver', () => {
  const reconnect = connection('tenant-1', {
    authState: 'reauth_required',
    syncState: 'reconnect_required',
    canSync: false,
    needsReauth: true,
  })
  assert.equal(startJourney.resolveStartJourney(status([reconnect]), null).kind, 'reconnect')

  const permitted = connection('tenant-1')
  assert.equal(
    startJourney.resolveStartJourney(
      status([permitted], { syncState: 'permission_upgrade_required' }),
      null
    ).kind,
    'permission_upgrade'
  )
})

test('public and Auth entry surfaces use the first-value resolver without changing Pricing', async () => {
  const [home, nav, pricing, startAuth, startJourneySource] = await Promise.all([
    readFile(projectFile('app/page.tsx'), 'utf8'),
    readFile(projectFile('app/components/Nav.tsx'), 'utf8'),
    readFile(projectFile('app/pricing/page.tsx'), 'utf8'),
    readFile(projectFile('app/start/StartAuthClient.tsx'), 'utf8'),
    readFile(projectFile('app/start/StartJourneyClient.tsx'), 'utf8'),
  ])

  assert.match(home, /href="\/start"[\s\S]*Try Yuohme/)
  assert.doesNotMatch(home, /href="\/pricing"[\s\S]{0,180}Start prioritising/)
  assert.match(nav, /href="\/start"[\s\S]*Try Yuohme/)
  assert.match(pricing, /<PricingClient \/>/)
  assert.match(startAuth, /Continue with Google/)
  assert.match(startAuth, /Continue with email/)
  assert.match(startAuth, /\/login\?next=%2Fstart/)
  assert.doesNotMatch(startAuth, /\/pricing|checkout/i)
  assert.match(startJourneySource, /buildXeroConnectPath\('\/start'\)/)
  assert.match(startJourneySource, /\/dashboard\?tenantId=/)
})
