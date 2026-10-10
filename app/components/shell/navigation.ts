import { isProtectedPagePath } from '@/lib/auth-flow'

// Presentation only: the existing proxy/pages still enforce authentication.
export const isWorkspacePath = isProtectedPagePath

export const workspaceLinks = [
  { label: 'Priorities', href: '/dashboard', prefixes: ['/dashboard', '/collections'] },
  { label: 'Customers', href: '/customers', prefixes: ['/customers'] },
  { label: 'Disputes', href: '/disputes', prefixes: ['/disputes'] },
] as const

export const accountLinks = [
  { label: 'Account', href: '/account', prefixes: ['/account'] },
  { label: 'Connections', href: '/settings/integrations', prefixes: ['/settings'] },
] as const

export function sectionMatches(pathname: string, prefixes: readonly string[]) {
  return prefixes.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

// Retain existing feature landmarks rather than nesting or rewriting them.
export function pageProvidesMain(pathname: string) {
  return pathname === '/disputes' || pathname === '/settings/integrations'
    || pathname.startsWith('/xero/') || /^\/customers\/[^/]+\/history(?:\/|$)/.test(pathname)
}
