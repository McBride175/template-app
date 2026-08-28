import { seoProblemPages, type SeoProblemPage } from '@/content/seo-pages'

type SeoPageGovernance = Pick<
  SeoProblemPage,
  'slug' | 'queryCluster' | 'readerJob' | 'uniqueAngle' | 'indexable'
>

export function validateSeoProblemPages(pages: readonly SeoPageGovernance[]) {
  const slugs = new Set<string>()
  const indexableClusters = new Map<string, string>()

  for (const page of pages) {
    const slug = page.slug.trim()
    const queryCluster = page.queryCluster.trim()

    if (!slug || !queryCluster || !page.readerJob.trim() || !page.uniqueAngle.trim()) {
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
  }
}

validateSeoProblemPages(seoProblemPages)

const seoProblemPagesBySlug = new Map<string, SeoProblemPage>()

for (const page of seoProblemPages) {
  seoProblemPagesBySlug.set(page.slug, page)
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
  page: Pick<SeoProblemPage, 'slug' | 'relatedSlugs'>
) {
  const seenSlugs = new Set([page.slug])

  return page.relatedSlugs.flatMap((slug) => {
    if (seenSlugs.has(slug)) return []

    const relatedPage = getSeoProblemPageBySlug(slug)
    if (!relatedPage) return []

    seenSlugs.add(slug)
    return [relatedPage]
  })
}
