import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptModule } from '../xero/test-helpers/ts-module-loader.mjs'

const {
  getAllIndexableSeoProblemPages,
  getAllSeoGuideCategories,
  getIndexableSeoProblemPagesByIntentFamily,
  getRelatedSeoProblemPages,
  getSeoGuideCategoryByIntentFamily,
  getSeoProblemPageBySlug,
  validateSeoGuideCategories,
  validateSeoProblemPages,
} = loadTypeScriptModule('lib/seo-pages.ts')

function governancePage(overrides = {}) {
  return {
    slug: 'example-guide',
    queryCluster: 'example-query-cluster',
    readerJob: 'Make one clear decision.',
    uniqueAngle: 'Explain the decision using evidence.',
    intentFamily: 'prioritisation',
    funnelStage: 'solution-aware',
    indexable: true,
    ...overrides,
  }
}

test('accepts distinct indexable query clusters', () => {
  assert.doesNotThrow(() =>
    validateSeoProblemPages([
      governancePage(),
      governancePage({
        slug: 'second-guide',
        queryCluster: 'second-query-cluster',
        readerJob: 'Make a different decision.',
        uniqueAngle: 'Explain a different decision using evidence.',
      }),
    ])
  )
})

test('rejects two indexable pages in the same query cluster', () => {
  assert.throws(
    () =>
      validateSeoProblemPages([
        governancePage(),
        governancePage({
          slug: 'overlapping-guide',
          readerJob: 'Make a different decision.',
          uniqueAngle: 'Explain a different decision using evidence.',
        }),
      ]),
    /Duplicate indexable SEO query cluster/
  )
})

test('rejects duplicate reader jobs or unique angles within one intent family', () => {
  assert.throws(
    () =>
      validateSeoProblemPages([
        governancePage(),
        governancePage({
          slug: 'same-job-guide',
          queryCluster: 'different-cluster',
          uniqueAngle: 'A genuinely different angle.',
        }),
      ]),
    /Duplicate indexable SEO reader job/
  )

  assert.throws(
    () =>
      validateSeoProblemPages([
        governancePage(),
        governancePage({
          slug: 'same-angle-guide',
          queryCluster: 'different-cluster',
          readerJob: 'Make a genuinely different decision.',
        }),
      ]),
    /Duplicate indexable SEO unique angle/
  )
})

test('rejects missing intent-governance fields', () => {
  assert.throws(
    () => validateSeoProblemPages([governancePage({ uniqueAngle: '  ' })]),
    /governance fields must not be empty/
  )

  assert.throws(
    () => validateSeoProblemPages([governancePage({ intentFamily: undefined })]),
    /governance fields must not be empty/
  )
  assert.throws(
    () => validateSeoProblemPages([governancePage({ funnelStage: undefined })]),
    /governance fields must not be empty/
  )
})

test('exposes the five credit-control topic hubs in the intended order', () => {
  const categories = getAllSeoGuideCategories()

  assert.deepEqual(
    categories.map((category) => category.slug),
    [
      'prioritising-overdue-invoices',
      'get-paid-faster',
      'late-paying-customers-and-risk',
      'credit-control-process',
      'xero-credit-control',
    ]
  )
})

test('assigns every indexable guide to one of the topic hubs', () => {
  const categories = getAllSeoGuideCategories()
  const categoryIntentFamilies = new Set(
    categories.map((category) => category.intentFamily)
  )
  const guides = getAllIndexableSeoProblemPages()

  for (const guide of guides) {
    assert.equal(categoryIntentFamilies.has(guide.intentFamily), true)
    assert.equal(getSeoGuideCategoryByIntentFamily(guide.intentFamily) !== null, true)
    assert.equal(
      getIndexableSeoProblemPagesByIntentFamily(guide.intentFamily).some(
        (familyGuide) => familyGuide.slug === guide.slug
      ),
      true
    )
    assert.equal(typeof guide.funnelStage, 'string')
  }
})

test('rejects duplicate or incomplete topic hubs', () => {
  const category = {
    intentFamily: 'prioritisation',
    slug: 'prioritising-overdue-invoices',
    title: 'Prioritising overdue invoices',
    shortDescription: 'Choose what to chase first.',
    description: 'Build a ranked order for overdue customer action.',
    topics: ['Customer-level ranking'],
  }

  assert.throws(
    () => validateSeoGuideCategories([category, category]),
    /Duplicate SEO guide category slug/
  )
  assert.throws(
    () => validateSeoGuideCategories([{ ...category, topics: [] }]),
    /category fields must not be empty/
  )
  assert.throws(
    () =>
      validateSeoGuideCategories([
        category,
        { ...category, slug: 'get-paid-faster' },
      ]),
    /Duplicate SEO guide intent family/
  )
})

test('keeps retained guide URLs stable and assigns all five governance fields', () => {
  const guides = getAllIndexableSeoProblemPages()

  assert.deepEqual(
    guides.map((guide) => guide.slug),
    [
      'how-to-prioritise-overdue-invoices',
      'which-customer-should-i-chase-first-for-payment',
      'how-to-get-cash-in-faster-from-overdue-customers',
    ]
  )

  for (const guide of guides) {
    assert.equal(
      [
        guide.queryCluster,
        guide.readerJob,
        guide.uniqueAngle,
        guide.intentFamily,
        guide.funnelStage,
      ].every((value) => typeof value === 'string' && value.trim().length > 0),
      true
    )
  }
})

test('separates the prioritisation method from the immediate next-chase decision', () => {
  const methodGuide = getSeoProblemPageBySlug('how-to-prioritise-overdue-invoices')
  const nextChaseGuide = getSeoProblemPageBySlug(
    'which-customer-should-i-chase-first-for-payment'
  )

  assert.ok(methodGuide)
  assert.ok(nextChaseGuide)
  assert.equal(methodGuide.intentFamily, 'prioritisation')
  assert.equal(nextChaseGuide.intentFamily, 'prioritisation')
  assert.equal(methodGuide.funnelStage, 'solution-aware')
  assert.equal(nextChaseGuide.funnelStage, 'problem-aware')
  assert.notEqual(methodGuide.queryCluster, nextChaseGuide.queryCluster)
  assert.notEqual(methodGuide.readerJob, nextChaseGuide.readerJob)
  assert.notEqual(methodGuide.uniqueAngle, nextChaseGuide.uniqueAngle)
  assert.equal(
    methodGuide.secondaryKeywords.includes(nextChaseGuide.primaryKeyword),
    false
  )
  assert.equal(
    getRelatedSeoProblemPages(methodGuide).some(
      (guide) => guide.slug === nextChaseGuide.slug
    ),
    true
  )
  assert.equal(
    getRelatedSeoProblemPages(nextChaseGuide).some(
      (guide) => guide.slug === methodGuide.slug
    ),
    true
  )
})

test('preserves curated related guides and falls back to at most two family siblings', () => {
  const prioritisationGuide = getAllIndexableSeoProblemPages().find(
    (guide) => guide.intentFamily === 'prioritisation'
  )

  assert.ok(prioritisationGuide)
  assert.deepEqual(
    getRelatedSeoProblemPages(prioritisationGuide).map((guide) => guide.slug),
    [
      'which-customer-should-i-chase-first-for-payment',
      'how-to-get-cash-in-faster-from-overdue-customers',
    ]
  )

  const pageWithoutCuration = {
    ...prioritisationGuide,
    slug: 'future-prioritisation-guide',
    relatedSlugs: [],
  }
  const fallbackGuides = getRelatedSeoProblemPages(pageWithoutCuration)

  assert.equal(fallbackGuides.length <= 2, true)
  assert.equal(
    fallbackGuides.every((guide) => guide.intentFamily === pageWithoutCuration.intentFamily),
    true
  )
})
