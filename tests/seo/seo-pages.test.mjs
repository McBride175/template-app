import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const { validateSeoProblemPages } = loadTypeScriptModule('lib/seo-pages.ts')

function governancePage(overrides = {}) {
  return {
    slug: 'example-guide',
    queryCluster: 'example-query-cluster',
    readerJob: 'Make one clear decision.',
    uniqueAngle: 'Explain the decision using evidence.',
    indexable: true,
    ...overrides,
  }
}

test('accepts distinct indexable query clusters', () => {
  assert.doesNotThrow(() =>
    validateSeoProblemPages([
      governancePage(),
      governancePage({ slug: 'second-guide', queryCluster: 'second-query-cluster' }),
    ])
  )
})

test('rejects two indexable pages in the same query cluster', () => {
  assert.throws(
    () =>
      validateSeoProblemPages([
        governancePage(),
        governancePage({ slug: 'overlapping-guide' }),
      ]),
    /Duplicate indexable SEO query cluster/
  )
})

test('rejects missing intent-governance fields', () => {
  assert.throws(
    () => validateSeoProblemPages([governancePage({ uniqueAngle: '  ' })]),
    /governance fields must not be empty/
  )
})
