import {
  SEO_FUNNEL_STAGES,
  SEO_INTENT_FAMILIES,
  seoGuideCategories,
  seoProblemPages,
  type SeoGuideCategory,
  type SeoIntentFamily,
  type SeoProblemPage,
} from '@/content/seo-pages'

type SeoPageGovernance = Pick<
  SeoProblemPage,
  | 'slug'
  | 'queryCluster'
  | 'readerJob'
  | 'uniqueAngle'
  | 'intentFamily'
  | 'funnelStage'
  | 'indexable'
>

type SeoGuideCategoryGovernance = Pick<
  SeoGuideCategory,
  'intentFamily' | 'slug' | 'title' | 'shortDescription' | 'description' | 'topics'
>

const intentFamilies = new Set<string>(SEO_INTENT_FAMILIES)
const funnelStages = new Set<string>(SEO_FUNNEL_STAGES)
const MAX_RELATED_GUIDES = 2

export function validateSeoGuideCategories(
  categories: readonly SeoGuideCategoryGovernance[]
) {
  const slugs = new Set<string>()
  const categoryIntentFamilies = new Set<string>()

  for (const category of categories) {
    const slug = category.slug.trim()

    if (
      !slug ||
      !intentFamilies.has(category.intentFamily) ||
      !category.title.trim() ||
      !category.shortDescription.trim() ||
      !category.description.trim() ||
      category.topics.length === 0 ||
      category.topics.some((topic) => !topic.trim())
    ) {
      throw new Error(`SEO guide category fields must not be empty: ${category.slug}`)
    }

    if (slugs.has(slug)) {
      throw new Error(`Duplicate SEO guide category slug: ${slug}`)
    }

    if (categoryIntentFamilies.has(category.intentFamily)) {
      throw new Error(`Duplicate SEO guide intent family: ${category.intentFamily}`)
    }

    slugs.add(slug)
    categoryIntentFamilies.add(category.intentFamily)
  }
}

export function validateSeoProblemPages(pages: readonly SeoPageGovernance[]) {
  const slugs = new Set<string>()
  const indexableClusters = new Map<string, string>()
  const indexableReaderJobs = new Map<string, string>()
  const indexableUniqueAngles = new Map<string, string>()

  for (const page of pages) {
    const slug = page.slug.trim()
    const queryCluster = page.queryCluster.trim()

    if (
      !slug ||
      !queryCluster ||
      !page.readerJob.trim() ||
      !page.uniqueAngle.trim() ||
      !intentFamilies.has(page.intentFamily) ||
      !funnelStages.has(page.funnelStage)
    ) {
      throw new Error(`SEO problem page governance fields must not be empty: ${page.slug}`)
    }

    if (slugs.has(slug)) {
      throw new Error(`Duplicate SEO problem page slug: ${slug}`)
    }
    slugs.add(slug)

    if (!page.indexable) continue

    const normalizedCluster = queryCluster.toLowerCase()
    const existingSlug = indexableClusters.get(normalizedCluster)
    if (existingSlug) {
      throw new Error(
        `Duplicate indexable SEO query cluster "${queryCluster}": ${existingSlug}, ${slug}`
      )
    }

    indexableClusters.set(normalizedCluster, slug)

    const normalizedReaderJob = `${page.intentFamily}:${page.readerJob.trim().toLowerCase()}`
    const existingReaderJobSlug = indexableReaderJobs.get(normalizedReaderJob)
    if (existingReaderJobSlug) {
      throw new Error(
        `Duplicate indexable SEO reader job in "${page.intentFamily}": ${existingReaderJobSlug}, ${slug}`
      )
    }
    indexableReaderJobs.set(normalizedReaderJob, slug)

    const normalizedUniqueAngle = `${page.intentFamily}:${page.uniqueAngle.trim().toLowerCase()}`
    const existingUniqueAngleSlug = indexableUniqueAngles.get(normalizedUniqueAngle)
    if (existingUniqueAngleSlug) {
      throw new Error(
        `Duplicate indexable SEO unique angle in "${page.intentFamily}": ${existingUniqueAngleSlug}, ${slug}`
      )
    }
    indexableUniqueAngles.set(normalizedUniqueAngle, slug)
  }
}

validateSeoProblemPages(seoProblemPages)
validateSeoGuideCategories(seoGuideCategories)

const seoProblemPagesBySlug = new Map<string, SeoProblemPage>()
const seoGuideCategoriesByIntentFamily = new Map<SeoIntentFamily, SeoGuideCategory>()

for (const category of seoGuideCategories) {
  seoGuideCategoriesByIntentFamily.set(category.intentFamily, category)
}

for (const page of seoProblemPages) {
  if (!seoGuideCategoriesByIntentFamily.has(page.intentFamily)) {
    throw new Error(`Unknown SEO guide intent family "${page.intentFamily}": ${page.slug}`)
  }

  const relatedSlugs = new Set<string>()
  for (const relatedSlug of page.relatedSlugs) {
    if (relatedSlug === page.slug) {
      throw new Error(`SEO problem page cannot relate to itself: ${page.slug}`)
    }
    if (relatedSlugs.has(relatedSlug)) {
      throw new Error(`Duplicate related SEO problem page slug "${relatedSlug}": ${page.slug}`)
    }
    relatedSlugs.add(relatedSlug)
  }

  seoProblemPagesBySlug.set(page.slug, page)
}

for (const page of seoProblemPages) {
  for (const relatedSlug of page.relatedSlugs) {
    if (!seoProblemPagesBySlug.has(relatedSlug)) {
      throw new Error(`Unknown related SEO problem page slug "${relatedSlug}": ${page.slug}`)
    }
  }
}

export function getAllSeoGuideCategories() {
  return [...seoGuideCategories]
}

export function getSeoGuideCategoryByIntentFamily(intentFamily: SeoIntentFamily) {
  return seoGuideCategoriesByIntentFamily.get(intentFamily) ?? null
}

export function getIndexableSeoProblemPagesByIntentFamily(intentFamily: SeoIntentFamily) {
  return seoProblemPages.filter(
    (page) => page.indexable && page.intentFamily === intentFamily
  )
}

export function getAllSeoProblemPages() {
  return [...seoProblemPages]
}

export function getAllIndexableSeoProblemPages() {
  return seoProblemPages.filter((page) => page.indexable)
}

export function getSeoProblemPageBySlug(slug: string) {
  return seoProblemPagesBySlug.get(slug) ?? null
}

export function getRelatedSeoProblemPages(
  page: Pick<SeoProblemPage, 'slug' | 'intentFamily' | 'relatedSlugs'>
) {
  const seenSlugs = new Set([page.slug])
  const relatedPages: SeoProblemPage[] = []

  for (const slug of page.relatedSlugs) {
    if (seenSlugs.has(slug)) continue

    const relatedPage = getSeoProblemPageBySlug(slug)
    if (!relatedPage) continue

    seenSlugs.add(slug)
    relatedPages.push(relatedPage)
  }

  if (relatedPages.length > 0) {
    return relatedPages
  }

  for (const familyPage of getIndexableSeoProblemPagesByIntentFamily(page.intentFamily)) {
    if (seenSlugs.has(familyPage.slug)) continue

    seenSlugs.add(familyPage.slug)
    relatedPages.push(familyPage)

    if (relatedPages.length === MAX_RELATED_GUIDES) break
  }

  return relatedPages
}
