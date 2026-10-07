import { loadTypeScriptModule as load } from './ts-module-loader.mjs'

/** Frozen domain/DTO fixtures retain their original access test doubles.
 * Only request preparation is adapted; financial/domain assertions are intact.
 * The real consolidated context is certified separately against PostgreSQL. */
export function loadTypeScriptModule(entry, options = {}) {
  const entitlement = options.mocks?.['@/lib/billing/entitlements']
  if (entitlement?.claimActionsEntitlementStatus && !options.mocks['@/lib/collections/access-context-server']) {
    options = { ...options, mocks: { ...options.mocks,
      '@/lib/collections/access-context-server': {
        claimCollectionAccess: async args => ({ context: null,
          entitlement: await entitlement.claimActionsEntitlementStatus({ ...args, preferredTenantId: args.tenantId }) }),
      },
    } }
  }
  return load(entry, options)
}
