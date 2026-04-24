export const CANONICAL_EMPTY_STATE_MESSAGE =
  'No tenant selected. Connect Xero and choose an organisation first.'

export const CANONICAL_ACTION_LINK_CLASS =
  'inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50'

export type CanonicalEntity = 'customers' | 'invoices' | 'payments'

const CANONICAL_ROUTES: Record<CanonicalEntity, { path: string; label: string }> = {
  customers: {
    path: '/xero/canonical/customers',
    label: 'Customers',
  },
  invoices: {
    path: '/xero/canonical/invoices',
    label: 'Invoices',
  },
  payments: {
    path: '/xero/canonical/payments',
    label: 'Payments',
  },
}

interface CanonicalNavLink {
  href: string
  label: string
}

export function getCanonicalNavLinks(
  current: CanonicalEntity,
  tenantQuery: string
): CanonicalNavLink[] {
  const links: CanonicalNavLink[] = [
    { href: '/admin', label: 'Admin' },
    { href: `/xero/raw${tenantQuery}`, label: 'Xero raw' },
  ]

  for (const [entity, route] of Object.entries(CANONICAL_ROUTES) as Array<
    [CanonicalEntity, { path: string; label: string }]
  >) {
    if (entity === current) continue
    links.push({
      href: `${route.path}${tenantQuery}`,
      label: route.label,
    })
  }

  return links
}
