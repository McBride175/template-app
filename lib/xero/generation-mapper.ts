import 'server-only'

import { normalizeCurrencyCode } from '@/lib/money/currency'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import {
  buildXeroCanonicalRows,
  type XeroCanonicalRows,
  type XeroRawResourceType,
  type XeroRawRow,
} from '@/lib/xero/canonical-mapper'
import {
  persistXeroGenerationCanonicalRows,
  type XeroPersistenceCounts,
} from '@/lib/xero/persistence'

const PAGE_SIZE = 1000

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>

interface XeroSyncRunRow {
  id: string
  status: string
  fencing_token: number
  lease_owner: string | null
  lease_expires_at: string | null
}

export type XeroGenerationMappingValidationErrorKind =
  | 'run_not_owned'
  | 'organisation_missing'
  | 'organisation_conflict'
  | 'organisation_invalid'
  | 'contact_invalid'
  | 'invoice_invalid'
  | 'invoice_contact_missing'
  | 'payment_invalid'
  | 'payment_invoice_missing'

export class XeroGenerationMappingValidationError extends Error {
  readonly kind: XeroGenerationMappingValidationErrorKind
  readonly resource: 'run' | 'organisations' | 'contacts' | 'invoices' | 'payments'

  constructor(params: {
    kind: XeroGenerationMappingValidationErrorKind
    resource: XeroGenerationMappingValidationError['resource']
    detail: string
  }) {
    super(`Xero generation ${params.resource} validation failed: ${params.detail}`)
    this.name = 'XeroGenerationMappingValidationError'
    this.kind = params.kind
    this.resource = params.resource
  }
}

export interface XeroGenerationMappingResult {
  counts: {
    organisations: number
    customers: number
    invoices: number
    payments: number
  }
  writes: Record<keyof XeroCanonicalRows, XeroPersistenceCounts>
  validation: {
    organisationBaseCurrencyCode: string
    incompleteFxInvoiceCount: number
    completeFxInvoiceCount: number
  }
}

function requireNonEmpty(value: string, label: string) {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label} is required`)
  return normalized
}

function requireIdentity(params: {
  syncRunId: string
  userId: string
  tenantId: string
  leaseOwner: string
  fencingToken: number
}) {
  const identity = {
    syncRunId: requireNonEmpty(params.syncRunId, 'syncRunId'),
    userId: requireNonEmpty(params.userId, 'userId'),
    tenantId: requireNonEmpty(params.tenantId, 'tenantId'),
    leaseOwner: requireNonEmpty(params.leaseOwner, 'leaseOwner'),
    fencingToken: params.fencingToken,
  }
  if (!Number.isSafeInteger(identity.fencingToken) || identity.fencingToken <= 0) {
    throw new Error('fencingToken must be a positive safe integer')
  }
  return identity
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readString(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

async function assertGenerationRunOwned(params: {
  supabaseAdmin: SupabaseAdminClient
  syncRunId: string
  userId: string
  tenantId: string
  leaseOwner: string
  fencingToken: number
}) {
  const { data, error } = await params.supabaseAdmin
    .from('xero_sync_runs')
    .select('id, status, fencing_token, lease_owner, lease_expires_at')
    .eq('id', params.syncRunId)
    .eq('user_id', params.userId)
    .eq('tenant_id', params.tenantId)
    .maybeSingle<XeroSyncRunRow>()

  const run = data as XeroSyncRunRow | null
  const leaseExpiresAt = run?.lease_expires_at ? Date.parse(run.lease_expires_at) : Number.NaN
  if (
    error ||
    !run ||
    run.status !== 'running' ||
    run.fencing_token !== params.fencingToken ||
    run.lease_owner !== params.leaseOwner ||
    !Number.isFinite(leaseExpiresAt) ||
    leaseExpiresAt <= Date.now()
  ) {
    throw new XeroGenerationMappingValidationError({
      kind: 'run_not_owned',
      resource: 'run',
      detail: 'run is not currently owned for generation mapping',
    })
  }
}

async function fetchGenerationRawRows(params: {
  supabaseAdmin: SupabaseAdminClient
  syncRunId: string
  userId: string
  tenantId: string
  resourceType: XeroRawResourceType
}) {
  const rows: XeroRawRow[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await params.supabaseAdmin
      .from('xero_raw')
      .select('tenant_id, source_id, raw_json, fetched_at')
      .eq('sync_run_id', params.syncRunId)
      .eq('user_id', params.userId)
      .eq('tenant_id', params.tenantId)
      .eq('resource_type', params.resourceType)
      .order('source_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      throw new Error(`Failed to load generation ${params.resourceType} raw rows`)
    }

    const batch = (data ?? []) as XeroRawRow[]
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }

  return rows
}

function validateGenerationRawData(params: {
  organisations: XeroRawRow[]
  contacts: XeroRawRow[]
  invoices: XeroRawRow[]
  payments: XeroRawRow[]
}) {
  if (params.organisations.length === 0) {
    throw new XeroGenerationMappingValidationError({
      kind: 'organisation_missing',
      resource: 'organisations',
      detail: 'exactly one organisation is required, received none',
    })
  }
  if (params.organisations.length !== 1) {
    throw new XeroGenerationMappingValidationError({
      kind: 'organisation_conflict',
      resource: 'organisations',
      detail: `exactly one organisation is required, received ${params.organisations.length}`,
    })
  }

  const organisation = asObject(params.organisations[0].raw_json)
  const organisationId = organisation ? readString(organisation.OrganisationID) : null
  const baseCurrencyCode = organisation
    ? normalizeCurrencyCode(organisation.BaseCurrency)
    : null
  if (
    !organisation ||
    !organisationId ||
    organisationId !== params.organisations[0].source_id ||
    !baseCurrencyCode
  ) {
    throw new XeroGenerationMappingValidationError({
      kind: 'organisation_invalid',
      resource: 'organisations',
      detail: 'organisation identity or base currency is invalid',
    })
  }

  const contactIds = new Set<string>()
  for (const rawRow of params.contacts) {
    const contact = asObject(rawRow.raw_json)
    const contactId = contact ? readString(contact.ContactID) : null
    if (!contactId || contactId !== rawRow.source_id) {
      throw new XeroGenerationMappingValidationError({
        kind: 'contact_invalid',
        resource: 'contacts',
        detail: 'a contact has an invalid or inconsistent ContactID',
      })
    }
    contactIds.add(contactId)
  }

  const invoiceIds = new Set<string>()
  for (const rawRow of params.invoices) {
    const invoice = asObject(rawRow.raw_json)
    const invoiceId = invoice ? readString(invoice.InvoiceID) : null
    const contact = invoice ? asObject(invoice.Contact) : null
    const contactId = contact ? readString(contact.ContactID) : null
    if (!invoiceId || invoiceId !== rawRow.source_id || !contactId) {
      throw new XeroGenerationMappingValidationError({
        kind: 'invoice_invalid',
        resource: 'invoices',
        detail: 'an invoice has an invalid InvoiceID or ContactID',
      })
    }
    if (!contactIds.has(contactId)) {
      throw new XeroGenerationMappingValidationError({
        kind: 'invoice_contact_missing',
        resource: 'invoices',
        detail: 'an invoice references a contact absent from this generation',
      })
    }
    invoiceIds.add(invoiceId)
  }

  for (const rawRow of params.payments) {
    const payment = asObject(rawRow.raw_json)
    const paymentId = payment ? readString(payment.PaymentID) : null
    const invoice = payment ? asObject(payment.Invoice) : null
    const invoiceId = invoice ? readString(invoice.InvoiceID) : null
    if (!paymentId || paymentId !== rawRow.source_id || !invoiceId) {
      throw new XeroGenerationMappingValidationError({
        kind: 'payment_invalid',
        resource: 'payments',
        detail: 'a payment has an invalid PaymentID or invoice reference',
      })
    }
    if (!invoiceIds.has(invoiceId)) {
      throw new XeroGenerationMappingValidationError({
        kind: 'payment_invoice_missing',
        resource: 'payments',
        detail: 'a payment references an invoice absent from this generation',
      })
    }
  }

  return { baseCurrencyCode }
}

export async function mapXeroGenerationToCanonical(params: {
  syncRunId: string
  userId: string
  tenantId: string
  leaseOwner: string
  fencingToken: number
  supabaseAdmin?: SupabaseAdminClient
}): Promise<XeroGenerationMappingResult> {
  const identity = requireIdentity(params)
  const supabaseAdmin = params.supabaseAdmin ?? createSupabaseAdminClient()
  await assertGenerationRunOwned({ supabaseAdmin, ...identity })

  const [organisations, organisationActions, contacts, invoices, payments] = await Promise.all([
    fetchGenerationRawRows({
      supabaseAdmin,
      ...identity,
      resourceType: 'organisations',
    }),
    fetchGenerationRawRows({
      supabaseAdmin,
      ...identity,
      resourceType: 'organisation_actions',
    }),
    fetchGenerationRawRows({ supabaseAdmin, ...identity, resourceType: 'contacts' }),
    fetchGenerationRawRows({ supabaseAdmin, ...identity, resourceType: 'invoices' }),
    fetchGenerationRawRows({ supabaseAdmin, ...identity, resourceType: 'payments' }),
  ])

  const validation = validateGenerationRawData({ organisations, contacts, invoices, payments })
  const rows = buildXeroCanonicalRows({
    userId: identity.userId,
    tenantId: identity.tenantId,
    organisationRows: organisations,
    organisationActionRows: organisationActions,
    contactRows: contacts,
    invoiceRows: invoices,
    paymentRows: payments,
    paymentSource: 'resource',
  })

  if (rows.organisations.length !== 1) {
    throw new XeroGenerationMappingValidationError({
      kind: 'organisation_invalid',
      resource: 'organisations',
      detail: 'organisation could not be mapped canonically',
    })
  }

  const sharedWriteParams = { supabaseAdmin, ...identity }
  const writes = {
    organisations: await persistXeroGenerationCanonicalRows({
      ...sharedWriteParams,
      resourceType: 'organisations',
      rows: rows.organisations,
    }),
    customers: await persistXeroGenerationCanonicalRows({
      ...sharedWriteParams,
      resourceType: 'customers',
      rows: rows.customers,
    }),
    invoices: await persistXeroGenerationCanonicalRows({
      ...sharedWriteParams,
      resourceType: 'invoices',
      rows: rows.invoices,
    }),
    payments: await persistXeroGenerationCanonicalRows({
      ...sharedWriteParams,
      resourceType: 'payments',
      rows: rows.payments,
    }),
  }

  const incompleteFxInvoiceCount = rows.invoices.filter(
    (invoice) => invoice.currency_conversion_status === 'incomplete'
  ).length

  return {
    counts: {
      organisations: rows.organisations.length,
      customers: rows.customers.length,
      invoices: rows.invoices.length,
      payments: rows.payments.length,
    },
    writes,
    validation: {
      organisationBaseCurrencyCode: validation.baseCurrencyCode,
      incompleteFxInvoiceCount,
      completeFxInvoiceCount: rows.invoices.length - incompleteFxInvoiceCount,
    },
  }
}
