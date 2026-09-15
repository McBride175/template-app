import 'server-only'

// Xero granular Accounting API scopes verified against the official scope table:
// https://developer.xero.com/documentation/guides/oauth2/scopes/
// These are capability metadata only. lib/xero/server.ts deliberately continues
// requesting the current broad-scope set until the separately reviewed cutover.
export const XERO_GENERATION_IMPORT_TARGET_SCOPES = [
  'offline_access',
  'accounting.settings.read',
  'accounting.contacts.read',
  'accounting.invoices.read',
  'accounting.payments.read',
] as const

export type XeroGenerationImportCapability =
  | 'offline'
  | 'settings'
  | 'contacts'
  | 'invoices'
  | 'payments'

const ACCEPTED_SCOPES: Record<XeroGenerationImportCapability, ReadonlySet<string>> = {
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

export const XERO_GENERATION_IMPORT_REQUIRED_CAPABILITIES = [
  'offline',
  'settings',
  'contacts',
  'invoices',
  'payments',
] as const satisfies readonly XeroGenerationImportCapability[]

export function normalizeXeroGrantedScopes(scopes: readonly string[]) {
  return new Set(
    scopes
      .flatMap((scope) => scope.split(/\s+/))
      .map((scope) => scope.trim().toLowerCase())
      .filter(Boolean)
  )
}

export function assessXeroGenerationImportCapabilities(scopes: readonly string[]) {
  const normalized = normalizeXeroGrantedScopes(scopes)
  const missing = XERO_GENERATION_IMPORT_REQUIRED_CAPABILITIES.filter(
    (capability) => ![...ACCEPTED_SCOPES[capability]].some((scope) => normalized.has(scope))
  )

  return {
    sufficient: missing.length === 0,
    missing,
    usesLegacyBroadTransactionsScope:
      normalized.has('accounting.transactions') ||
      normalized.has('accounting.transactions.read'),
  }
}
