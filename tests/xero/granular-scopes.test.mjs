import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const SCOPES_PATH = new URL('../../lib/xero/scopes.ts', import.meta.url)
const SERVER_PATH = new URL('../../lib/xero/server.ts', import.meta.url)
const CALLBACK_PATH = new URL('../../app/api/xero/callback/route.ts', import.meta.url)
const ACCOUNTING_PATH = new URL('../../lib/xero/accounting.ts', import.meta.url)

const TARGET_SCOPES = [
  'offline_access',
  'accounting.settings.read',
  'accounting.contacts.read',
  'accounting.invoices.read',
  'accounting.payments.read',
]

const LEGACY_SCOPES = [
  'offline_access',
  'accounting.settings.read',
  'accounting.contacts.read',
  'accounting.transactions.read',
]

test('OAuth requests exactly the least-privilege granular read set', () => {
  const server = loadTypeScriptModule(SERVER_PATH)
  assert.deepEqual([...server.XERO_SCOPES], TARGET_SCOPES)
  assert.deepEqual([...server.XERO_SCOPES], [...server.XERO_SCOPES].filter(
    (scope) => scope !== 'accounting.reports.read' && scope !== 'accounting.transactions.read'
  ))
})

test('scope normalization is stable across whitespace, ordering, duplicates, and extras', () => {
  const scopes = loadTypeScriptModule(SCOPES_PATH)
  assert.deepEqual(
    scopes.normalizeXeroScopes([
      '  accounting.payments.read offline_access  ',
      'ACCOUNTING.INVOICES.READ',
      'offline_access',
      'custom.unknown.read',
    ]),
    [
      'accounting.invoices.read',
      'accounting.payments.read',
      'custom.unknown.read',
      'offline_access',
    ]
  )
})

test('target granular grant provides every capability and is launch-ready', () => {
  const scopes = loadTypeScriptModule(SCOPES_PATH)
  const assessment = scopes.deriveXeroCapabilities(TARGET_SCOPES)
  assert.deepEqual(assessment.capabilities, {
    offline: true,
    settings: true,
    contacts: true,
    invoices: true,
    payments: true,
  })
  assert.deepEqual(assessment.missing, [])
  assert.equal(scopes.classifyXeroGrant({ scopes: TARGET_SCOPES }), 'granular_ready')
})

test('legacy broad transaction grant is compatible but not granular launch-ready', () => {
  const scopes = loadTypeScriptModule(SCOPES_PATH)
  const assessment = scopes.deriveXeroCapabilities(LEGACY_SCOPES)
  assert.equal(assessment.sufficient, true)
  assert.equal(assessment.usesLegacyBroadTransactionsScope, true)
  assert.equal(scopes.classifyXeroGrant({ scopes: LEGACY_SCOPES }), 'legacy_broad_compatible')
})

test('missing each required capability is classified as a permission upgrade', async (t) => {
  const scopes = loadTypeScriptModule(SCOPES_PATH)
  for (const [missingScope, missingCapability] of [
    ['accounting.payments.read', 'payments'],
    ['accounting.invoices.read', 'invoices'],
    ['accounting.contacts.read', 'contacts'],
    ['accounting.settings.read', 'settings'],
    ['offline_access', 'offline'],
  ]) {
    await t.test(missingCapability, () => {
      const grant = TARGET_SCOPES.filter((scope) => scope !== missingScope)
      assert.deepEqual(scopes.deriveXeroCapabilities(grant).missing, [missingCapability])
      assert.equal(
        scopes.classifyXeroGrant({ scopes: grant, scopeMetadataKnown: true }),
        'permission_upgrade_required'
      )
    })
  }
})

test('mixed migration grants are capability-based and require granular coverage for launch readiness', () => {
  const scopes = loadTypeScriptModule(SCOPES_PATH)
  assert.equal(
    scopes.classifyXeroGrant({
      scopes: [...LEGACY_SCOPES, 'accounting.invoices.read'],
    }),
    'legacy_broad_compatible'
  )
  assert.equal(
    scopes.classifyXeroGrant({
      scopes: [...LEGACY_SCOPES, 'accounting.invoices.read', 'accounting.payments.read'],
    }),
    'granular_ready'
  )
})

test('unknown historical metadata stays runtime-compatible but is not claimed as granular', () => {
  const scopes = loadTypeScriptModule(SCOPES_PATH)
  assert.equal(
    scopes.classifyXeroGrant({ scopes: [], scopeMetadataKnown: false }),
    'scope_metadata_unknown'
  )
  assert.equal(
    scopes.classifyXeroGrant({ scopes: TARGET_SCOPES, authState: 'reauth_required' }),
    'reauth_required'
  )
})

test('capability classification remains connection/grant specific for one user', () => {
  const scopes = loadTypeScriptModule(SCOPES_PATH)
  const tenantGrants = new Map([
    ['tenant-a', TARGET_SCOPES],
    ['tenant-b', LEGACY_SCOPES],
    ['tenant-c', TARGET_SCOPES.filter((scope) => scope !== 'accounting.payments.read')],
  ])
  assert.deepEqual(
    Object.fromEntries([...tenantGrants].map(([tenantId, grant]) => [
      tenantId,
      scopes.classifyXeroGrant({ scopes: grant, scopeMetadataKnown: true }),
    ])),
    {
      'tenant-a': 'granular_ready',
      'tenant-b': 'legacy_broad_compatible',
      'tenant-c': 'permission_upgrade_required',
    }
  )
})

test('callback persists normalized authoritative grant scopes without exposing them publicly', async () => {
  const callback = await readFile(CALLBACK_PATH, 'utf8')
  assert.match(callback, /const scopes = normalizeXeroScopes\(tokenData\.scope\)/)
  assert.match(callback, /\.from\('xero_oauth_grants'\)[\s\S]*scopes,[\s\S]*access_token_encrypted:/)
  const publicMetadata = callback.match(/metadata: \{([\s\S]*?)\n\s*\},\n\s*\}\)\),/)
  assert.ok(publicMetadata, 'expected public connection metadata block')
  assert.doesNotMatch(publicMetadata[1], /\bscopes\b/)
  assert.match(callback, /reason: 'permission_upgrade_required'/)
})

test('refresh token response scopes are normalized when present and explicitly absent otherwise', async () => {
  const originalFetch = globalThis.fetch
  try {
    const accounting = loadTypeScriptModule(ACCOUNTING_PATH, {
      mocks: {
        '@/lib/xero/server': {
          getXeroConfig() {
            return { clientId: 'client', clientSecret: 'secret' }
          },
          getXeroTokenUrl() {
            return 'https://identity.xero.test/token'
          },
        },
      },
    })

    globalThis.fetch = async () => new Response(JSON.stringify({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 1800,
      scope: 'accounting.payments.read offline_access accounting.payments.read',
    }))
    const withScopes = await accounting.refreshXeroAccessToken('old-refresh')
    assert.deepEqual(withScopes.scopes, ['accounting.payments.read', 'offline_access'])

    globalThis.fetch = async () => new Response(JSON.stringify({
      access_token: 'access-2',
      refresh_token: 'refresh-2',
      expires_in: 1800,
    }))
    const withoutScopes = await accounting.refreshXeroAccessToken('refresh-1')
    assert.equal(withoutScopes.scopes, null)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('implemented migration documentation names target, compatibility, and reauthorisation boundaries', async () => {
  const design = await readFile(
    new URL('../../docs/xero-granular-scope-migration.md', import.meta.url),
    'utf8'
  )
  assert.match(design, /granular_ready/)
  assert.match(design, /legacy_broad_compatible/)
  assert.match(design, /scope_metadata_unknown/)
  assert.match(design, /Reauthorise the Test Xero connection/)
})
