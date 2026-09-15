import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { loadTypeScriptModule } from './test-helpers/ts-module-loader.mjs'

const SCOPES_PATH = new URL('../../lib/xero/scopes.ts', import.meta.url)
const SERVER_PATH = new URL('../../lib/xero/server.ts', import.meta.url)

test('generation importer target is the verified least-privilege granular read set', () => {
  const scopes = loadTypeScriptModule(SCOPES_PATH)
  assert.deepEqual([...scopes.XERO_GENERATION_IMPORT_TARGET_SCOPES], [
    'offline_access',
    'accounting.settings.read',
    'accounting.contacts.read',
    'accounting.invoices.read',
    'accounting.payments.read',
  ])
})

test('legacy broad and target granular grants are assessed by capability', () => {
  const scopes = loadTypeScriptModule(SCOPES_PATH)
  assert.deepEqual(
    scopes.assessXeroGenerationImportCapabilities([
      'offline_access',
      'accounting.settings.read',
      'accounting.contacts.read',
      'accounting.transactions.read',
    ]),
    {
      sufficient: true,
      missing: [],
      usesLegacyBroadTransactionsScope: true,
    }
  )
  assert.deepEqual(
    scopes.assessXeroGenerationImportCapabilities([
      'offline_access',
      'accounting.settings.read accounting.contacts.read',
      'accounting.invoices.read',
      'accounting.payments.read',
    ]),
    {
      sufficient: true,
      missing: [],
      usesLegacyBroadTransactionsScope: false,
    }
  )
  assert.deepEqual(
    scopes.assessXeroGenerationImportCapabilities([
      'offline_access',
      'accounting.settings.read',
      'accounting.contacts.read',
      'accounting.invoices.read',
    ]).missing,
    ['payments']
  )
})

test('Phase 4 does not activate the OAuth scope migration', async () => {
  const server = loadTypeScriptModule(SERVER_PATH)
  assert.deepEqual([...server.XERO_SCOPES], [
    'offline_access',
    'accounting.settings.read',
    'accounting.reports.read',
    'accounting.contacts.read',
    'accounting.transactions.read',
  ])

  const design = await readFile(
    new URL('../../docs/xero-granular-scope-migration.md', import.meta.url),
    'utf8'
  )
  assert.match(design, /accounting\.invoices\.read/)
  assert.match(design, /accounting\.payments\.read/)
  assert.match(design, /Remove scope before launch/)
})
