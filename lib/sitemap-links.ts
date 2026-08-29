export interface SitemapPageLink {
  href: string
  label: string
  includeInXml: boolean
}

export const SITEMAP_PAGE_LINKS: SitemapPageLink[] = [
  { href: '/', label: 'Home', includeInXml: true },
  { href: '/blog', label: 'Credit control guides', includeInXml: true },
  { href: '/pricing', label: 'Pricing', includeInXml: true },
  { href: '/contact', label: 'Contact', includeInXml: true },
  { href: '/disputes', label: 'Disputes', includeInXml: true },
  { href: '/legal/terms', label: 'Terms of Service', includeInXml: true },
  { href: '/legal/privacy', label: 'Privacy Policy', includeInXml: true },
  { href: '/legal/cookies', label: 'Cookie Policy', includeInXml: true },
  { href: '/sitemap', label: 'Sitemap', includeInXml: true },
  { href: '/sitemap.xml', label: 'XML Sitemap', includeInXml: false },
]
