import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../../lib/sentry-config.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
const { scrubSentryBreadcrumb, scrubSentryEvent } = await import(moduleUrl)

test('Sentry event scrubbing removes request and user data before sending', () => {
  const event = scrubSentryEvent({
    user: { id: 'customer-123', email: 'customer@example.com' },
    request: {
      url: 'https://preview.example.com/api/xero/callback?code=sensitive#fragment',
      headers: { authorization: 'Bearer token' },
      cookies: { session: 'secret' },
      data: { invoice: 'customer accounting payload' },
      env: { XERO_CLIENT_SECRET: 'secret' },
      query_string: 'code=sensitive',
    },
  })

  assert.equal(event.user, undefined)
  assert.deepEqual(event.request, {
    url: 'https://preview.example.com/api/xero/callback',
    headers: undefined,
    cookies: undefined,
    data: undefined,
    env: undefined,
    query_string: undefined,
  })
})

test('Sentry event scrubbing filters common credential shapes and sensitive keys', () => {
  const stripeSecret = ['sk', 'live', 'abcdefghijklmnopqrstuvwxyz'].join('_')
  const webhookSecret = ['whsec', 'abcdefghijklmnopqrstuvwxyz'].join('_')
  const sentryToken = ['sntrys', 'header', 'payload/token=='].join('_')
  const event = scrubSentryEvent({
    exception: {
      values: [
        {
          value: `authorization=Bearer abc123 ${stripeSecret} ${webhookSecret} ${sentryToken}`,
        },
      ],
    },
    extra: {
      access_token: 'plain-token',
      nested: {
        note: 'Bearer abc123',
        jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature',
      },
    },
  })

  assert.equal(event.extra.access_token, '[Filtered]')
  assert.equal(event.extra.nested.note, 'Bearer [Filtered]')
  assert.equal(event.extra.nested.jwt, '[Filtered]')
  assert.doesNotMatch(event.exception.values[0].value, /abc123|sk_live_|whsec_|sntrys_/)
})

test('Sentry breadcrumbs drop console and click context and strip URL queries', () => {
  assert.equal(scrubSentryBreadcrumb({ category: 'console', message: 'secret' }), null)
  assert.equal(scrubSentryBreadcrumb({ category: 'ui.click', message: 'Customer Ltd' }), null)

  const breadcrumb = scrubSentryBreadcrumb({
    category: 'navigation',
    data: {
      from: '/invoices?customer=private',
      to: '/collections?tenant=private',
    },
  })

  assert.deepEqual(breadcrumb.data, {
    from: '/invoices',
    to: '/collections',
  })
})

test('Sentry span scrubbing removes URL queries and database descriptions', () => {
  const event = scrubSentryEvent({
    spans: [
      {
        description: 'https://example.com/api/items?customer=private',
        op: 'http.client',
        data: { authorization: 'Bearer abc123' },
      },
      {
        description: "select * from invoices where name = 'Customer Ltd'",
        op: 'db.query',
      },
    ],
  })

  assert.equal(event.spans[0].description, 'https://example.com/api/items')
  assert.equal(event.spans[0].data.authorization, '[Filtered]')
  assert.equal(event.spans[1].description, 'db.query')
})
