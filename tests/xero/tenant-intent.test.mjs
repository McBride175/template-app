import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const projectFile = (path) => new URL(`../../${path}`, import.meta.url)
const tenantIntent = loadTypeScriptModule(projectFile('lib/xero/tenant-intent.ts'))

function token(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`
}

test('Xero authentication event id is read only from a well-formed access token claim', () => {
  assert.equal(
    tenantIntent.getXeroAuthenticationEventId(token({ authentication_event_id: 'event-1' })),
    'event-1'
  )
  assert.equal(tenantIntent.getXeroAuthenticationEventId('not-a-jwt'), null)
  assert.equal(tenantIntent.getXeroAuthenticationEventId(token({ sub: 'user' })), null)
})

test('one usable Xero organisation is inferred automatically', () => {
  assert.equal(
    tenantIntent.resolveXeroIntendedTenantId({
      connections: [{ tenantId: 'tenant-only', authEventId: 'event-1' }],
      authenticationEventId: null,
      explicitReturnTenantId: null,
    }),
    'tenant-only'
  )
})

test('a unique current Xero authorization event is a reliable intent signal', () => {
  assert.equal(
    tenantIntent.resolveXeroIntendedTenantId({
      connections: [
        { tenantId: 'tenant-old', authEventId: 'event-old' },
        { tenantId: 'tenant-new', authEventId: 'event-current' },
      ],
      authenticationEventId: 'event-current',
      explicitReturnTenantId: null,
    }),
    'tenant-new'
  )
})

test('multiple organisations in the current event remain ambiguous', () => {
  assert.equal(
    tenantIntent.resolveXeroIntendedTenantId({
      connections: [
        { tenantId: 'tenant-a', authEventId: 'event-current' },
        { tenantId: 'tenant-b', authEventId: 'event-current' },
      ],
      authenticationEventId: 'event-current',
      explicitReturnTenantId: null,
    }),
    null
  )
})

test('an explicit Yuohme reconnect target wins only when Xero returned that tenant', () => {
  const connections = [
    { tenantId: 'tenant-a', authEventId: 'event-current' },
    { tenantId: 'tenant-b', authEventId: 'event-current' },
  ]
  assert.equal(
    tenantIntent.resolveXeroIntendedTenantId({
      connections,
      authenticationEventId: 'event-current',
      explicitReturnTenantId: 'tenant-b',
    }),
    'tenant-b'
  )
  assert.equal(
    tenantIntent.resolveXeroIntendedTenantId({
      connections,
      authenticationEventId: 'event-current',
      explicitReturnTenantId: 'foreign-tenant',
    }),
    null
  )
})
