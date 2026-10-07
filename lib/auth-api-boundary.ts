/** Exact routes audited to authenticate through route getUser() or their
 * domain's server helper. Other APIs retain proxy behaviour until audited.
 * This list is not authorization: the route still verifies every request. */
export const ROUTE_AUTHENTICATED_API_PATHS = [
  '/api/dashboard/bootstrap',
  '/api/collections/actions',
  '/api/collections/customer-detail',
  '/api/collections/customers',
  '/api/collections/override',
  '/api/collections/action-history',
  '/api/collections/invoice-promises',
  '/api/collections/invoice-disputes',
] as const

export function usesRouteAuthentication(pathname: string) {
  return ROUTE_AUTHENTICATED_API_PATHS.some(path => path === pathname)
}
