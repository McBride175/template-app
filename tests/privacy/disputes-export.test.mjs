import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'
import { getSafeAuthUser } from '../../lib/privacy-utils.mjs'

test('privacy export preserves owned dispute notes and state without internal revision metadata', async () => {
  const records = [
    { id: 'owned', user_id: 'user-a', tenant_id: 'tenant-a', invoice_source_id: 'invoice-a',
      note: 'Customer-provided dispute context', is_active: true, revision: 9 },
    { id: 'foreign', user_id: 'user-b', tenant_id: 'tenant-b', note: 'Private to another user', revision: 2 },
  ]
  const admin = {
    auth: { admin: { getUserById: async (id) => ({ data: { user: { id, email: 'fixture@example.test' } }, error: null }) } },
    from(table) {
      let columns = [], owner
      const result = () => ({ data: table === 'invoice_disputes'
        ? records.filter((row) => row.user_id === owner).map((row) => Object.fromEntries(
          columns.filter((column) => column in row).map((column) => [column, row[column]]))) : [], error: null })
      return {
        select(value) { columns = value.split(',').map((column) => column.trim()); return this },
        eq(column, value) { assert.equal(column, 'user_id'); owner = value; return this },
        order() { return this },
        maybeSingle() { return Promise.resolve({ data: null, error: null }) },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject) },
      }
    },
  }
  const { buildUserExportBundle } = loadTypeScriptModule('lib/privacy-export.ts', { mocks: {
    '@/lib/supabase-admin': { createSupabaseAdminClient: () => admin },
    '@/lib/privacy-utils.mjs': { getSafeAuthUser },
  } })
  const bundle = await buildUserExportBundle('user-a')
  assert.equal(bundle.data.invoice_disputes.length, 1)
  assert.equal(bundle.data.invoice_disputes[0].id, 'owned')
  assert.equal(bundle.data.invoice_disputes[0].note, records[0].note)
  assert.equal(bundle.data.invoice_disputes[0].is_active, true)
  assert.equal('revision' in bundle.data.invoice_disputes[0], false)
  assert.ok(bundle.metadata.includes.includes('invoice_disputes'))
})
