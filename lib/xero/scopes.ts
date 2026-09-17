import 'server-only'

// Verified against Xero's official OAuth scope table and granular-scope FAQ:
// https://developer.xero.com/documentation/guides/oauth2/scopes/
// https://developer.xero.com/faq/granular-scopes
export const XERO_REQUIRED_OAUTH_SCOPES = [
  'offline_access',
  'accounting.settings.read',
  'accounting.contacts.read',
  'accounting.invoices.read',
  'accounting.payments.read',
] as const

// Kept as an explicit alias for the authoritative generation-import contract.
export const XERO_GENERATION_IMPORT_TARGET_SCOPES = XERO_REQUIRED_OAUTH_SCOPES

export type XeroRequiredCapability =
  | 'offline'
  | 'settings'
  | 'contacts'
  | 'invoices'
  | 'payments'

export type XeroGrantClassification =
  | 'granular_ready'
  | 'legacy_broad_compatible'
  | 'permission_upgrade_required'
  | 'reauth_required'
  | 'scope_metadata_unknown'

export type XeroGrantAuthState = 'active' | 'reauth_required' | 'disconnected' | 'error'

type XeroScopeInput = string | readonly string[] | null | undefined

const ACCEPTED_SCOPES: Record<XeroRequiredCapability, ReadonlySet<string>> = {
  offline: new Set(['offline_access']),
  settings: new Set(['accounting.settings', 'accounting.settings.read']),
  contacts: new Set(['accounting.contacts', 'accounting.contacts.read']),
  invoices: new Set([
    'accounting.invoices',
    'accounting.invoices.read',
    'accounting.transactions',
    'accounting.transactions.read',
  ]),
  payments: new Set([
    'accounting.payments',
    'accounting.payments.read',
    'accounting.transactions',
    'accounting.transactions.read',
  ]),
}

const GRANULAR_INVOICE_SCOPES = new Set(['accounting.invoices', 'accounting.invoices.read'])
const GRANULAR_PAYMENT_SCOPES = new Set(['accounting.payments', 'accounting.payments.read'])
const LEGACY_TRANSACTION_SCOPES = new Set([
  'accounting.transactions',
  'accounting.transactions.read',
])

export const XERO_REQUIRED_CAPABILITIES = [
  'offline',
  'settings',
  'contacts',
  'invoices',
  'payments',
] as const satisfies readonly XeroRequiredCapability[]

export const XERO_GENERATION_IMPORT_REQUIRED_CAPABILITIES = XERO_REQUIRED_CAPABILITIES

export function normalizeXeroScopes(scopes: XeroScopeInput) {
  const values = typeof scopes === 'string' ? [scopes] : scopes ?? []
  return [...new Set(
    values
      .flatMap((scope) => scope.split(/\s+/))
      .map((scope) => scope.trim().toLowerCase())
      .filter(Boolean)
  )].sort()
}

export function normalizeXeroGrantedScopes(scopes: XeroScopeInput) {
  return new Set(normalizeXeroScopes(scopes))
}

function hasAnyScope(scopes: ReadonlySet<string>, accepted: ReadonlySet<string>) {
  return [...accepted].some((scope) => scopes.has(scope))
}

export function deriveXeroCapabilities(scopes: XeroScopeInput) {
  const normalizedScopes = normalizeXeroScopes(scopes)
  const normalized = new Set(normalizedScopes)
  const capabilities = Object.fromEntries(
    XERO_REQUIRED_CAPABILITIES.map((capability) => [
      capability,
      hasAnyScope(normalized, ACCEPTED_SCOPES[capability]),
    ])
  ) as Record<XeroRequiredCapability, boolean>
  const missing = XERO_REQUIRED_CAPABILITIES.filter((capability) => !capabilities[capability])

  return {
    normalizedScopes,
    capabilities,
    missing,
    sufficient: missing.length === 0,
    hasGranularInvoiceScope: hasAnyScope(normalized, GRANULAR_INVOICE_SCOPES),
    hasGranularPaymentScope: hasAnyScope(normalized, GRANULAR_PAYMENT_SCOPES),
    usesLegacyBroadTransactionsScope: hasAnyScope(normalized, LEGACY_TRANSACTION_SCOPES),
  }
}

export function classifyXeroGrant(params: {
  scopes: XeroScopeInput
  authState?: XeroGrantAuthState | null
  scopeMetadataKnown?: boolean
}): XeroGrantClassification {
  if (params.authState === 'reauth_required' || params.authState === 'disconnected') {
    return 'reauth_required' satisfies XeroGrantClassification
  }

  const assessment = deriveXeroCapabilities(params.scopes)
  const metadataKnown = params.scopeMetadataKnown ?? assessment.normalizedScopes.length > 0
  if (!metadataKnown) return 'scope_metadata_unknown' satisfies XeroGrantClassification
  if (!assessment.sufficient) {
    return 'permission_upgrade_required' satisfies XeroGrantClassification
  }
  if (assessment.hasGranularInvoiceScope && assessment.hasGranularPaymentScope) {
    return 'granular_ready' satisfies XeroGrantClassification
  }
  return 'legacy_broad_compatible' satisfies XeroGrantClassification
}

export function assessXeroGenerationImportCapabilities(scopes: XeroScopeInput) {
  const assessment = deriveXeroCapabilities(scopes)
  return {
    sufficient: assessment.sufficient,
    missing: assessment.missing,
    usesLegacyBroadTransactionsScope: assessment.usesLegacyBroadTransactionsScope,
  }
}
