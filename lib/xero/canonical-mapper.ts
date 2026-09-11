import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import {
  convertCurrencyAmounts,
  normalizeCurrencyCode,
  type CurrencyConversionFailureReason,
  type CurrencyConversionStatus,
} from '@/lib/money/currency'
import { parseXeroDate, parseXeroDateTime, safeNumber } from '@/lib/xero/canonical-mapping'

type XeroRawResourceType = 'contacts' | 'invoices' | 'organisations' | 'organisation_actions'

interface XeroRawRow {
  tenant_id: string
  source_id: string
  raw_json: unknown
  fetched_at: string
}

interface CanonicalOrganisationUpsert {
  user_id: string
  tenant_id: string
  source_system: 'xero'
  source_organisation_id: string
  organisation_name: string | null
  base_currency_code: string | null
  country_code: string | null
  source_timezone: string | null
  xero_version: string | null
  use_multicurrency: boolean | null
  source_retrieved_at: string
}

interface CanonicalCustomerUpsert {
  user_id: string
  tenant_id: string
  source_system: 'xero'
  source_id: string
  name: string
  email: string | null
  is_customer: boolean | null
  is_supplier: boolean | null
  status: string | null
  raw_updated_at: string | null
}

interface CanonicalInvoiceUpsert {
  user_id: string
  tenant_id: string
  source_system: 'xero'
  source_id: string
  customer_source_id: string | null
  type: string | null
  invoice_number: string | null
  reference: string | null
  status: string | null
  issue_date: string | null
  due_date: string | null
  fully_paid_date: string | null
  currency_code: string | null
  total: number | null
  amount_due: number | null
  amount_paid: number | null
  amount_credited: number | null
  transaction_currency_code: string | null
  organisation_base_currency_code: string | null
  xero_currency_rate: string | null
  total_native: string | null
  amount_due_native: string | null
  amount_paid_native: string | null
  amount_credited_native: string | null
  total_base: string | null
  amount_due_base: string | null
  amount_paid_base: string | null
  amount_credited_base: string | null
  currency_conversion_status: CurrencyConversionStatus
  currency_conversion_failure_reason: CurrencyConversionFailureReason | null
  sent_to_contact: boolean | null
  raw_updated_at: string | null
}

interface CanonicalPaymentUpsert {
  user_id: string
  tenant_id: string
  source_system: 'xero'
  source_id: string
  invoice_source_id: string | null
  customer_source_id: string | null
  amount: number | null
  payment_date: string | null
  currency_rate: number | null
  reference: string | null
  raw_updated_at: string | null
}

export interface CanonicalMappingCounts {
  organisations: number
  customers: number
  invoices: number
  payments: number
}

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>

const SOURCE_SYSTEM = 'xero' as const
const PAGE_SIZE = 1000
const UPSERT_CHUNK_SIZE = 500

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase()
    if (lowered === 'true') return true
    if (lowered === 'false') return false
  }
  return null
}

function normalizeCountryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null
}

function readUseMulticurrency(actionValues: unknown[]): boolean | null {
  for (const actionValue of actionValues) {
    const action = asObject(actionValue)
    if (!action || readString(action.Name)?.toUpperCase() !== 'USEMULTICURRENCY') continue

    const status = readString(action.Status)?.toUpperCase()
    if (status === 'ALLOWED') return true
    if (status === 'NOT-ALLOWED') return false
  }

  return null
}

function dedupeCanonicalRows<
  TRow extends {
    user_id: string
    tenant_id: string
    source_system: string
    source_id: string
  },
>(rows: TRow[]) {
  const unique = new Map<string, TRow>()

  for (const row of rows) {
    const key = `${row.user_id}|${row.tenant_id}|${row.source_system}|${row.source_id}`
    unique.set(key, row)
  }

  return Array.from(unique.values())
}

function dedupeCanonicalOrganisationRows(rows: CanonicalOrganisationUpsert[]) {
  const unique = new Map<string, CanonicalOrganisationUpsert>()

  for (const row of rows) {
    const key = `${row.user_id}|${row.tenant_id}|${row.source_system}|${row.source_organisation_id}`
    unique.set(key, row)
  }

  return Array.from(unique.values())
}

async function fetchXeroRawRows(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
  tenantId: string,
  resourceType: XeroRawResourceType
) {
  const rows: XeroRawRow[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from('xero_raw')
      .select('tenant_id, source_id, raw_json, fetched_at')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .eq('resource_type', resourceType)
      .order('tenant_id', { ascending: true })
      .order('source_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      throw new Error(`Failed to load ${resourceType} raw rows: ${error.message}`)
    }

    const batch = (data ?? []) as XeroRawRow[]
    rows.push(...batch)

    if (batch.length < PAGE_SIZE) break
  }

  return rows
}

async function upsertInChunks<TRow extends object>(
  supabaseAdmin: SupabaseAdminClient,
  table:
    | 'canonical_organisations'
    | 'canonical_customers'
    | 'canonical_invoices'
    | 'canonical_payments',
  rows: TRow[],
  onConflict = 'user_id,tenant_id,source_system,source_id'
) {
  for (let index = 0; index < rows.length; index += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + UPSERT_CHUNK_SIZE)
    const { error } = await supabaseAdmin.from(table).upsert(chunk as object[], {
      onConflict,
    })

    if (error) {
      throw new Error(`Failed to upsert ${table}: ${error.message}`)
    }
  }
}

export async function mapXeroRawToCanonical(params: {
  userId: string
  tenantId: string
  supabaseAdmin?: SupabaseAdminClient
}): Promise<CanonicalMappingCounts> {
  const { userId, tenantId } = params
  const supabaseAdmin = params.supabaseAdmin ?? createSupabaseAdminClient()
  const [organisationRows, organisationActionRows, contactRows, invoiceRows] = await Promise.all([
    fetchXeroRawRows(supabaseAdmin, userId, tenantId, 'organisations'),
    fetchXeroRawRows(supabaseAdmin, userId, tenantId, 'organisation_actions'),
    fetchXeroRawRows(supabaseAdmin, userId, tenantId, 'contacts'),
    fetchXeroRawRows(supabaseAdmin, userId, tenantId, 'invoices'),
  ])

  const organisationsToUpsert: CanonicalOrganisationUpsert[] = []
  const organisationCurrencyContexts: Array<{
    sourceOrganisationId: string
    sourceRetrievedAt: string
    baseCurrency: unknown
  }> = []
  const customersToUpsert: CanonicalCustomerUpsert[] = []
  const invoicesToUpsert: CanonicalInvoiceUpsert[] = []
  const paymentsToUpsert: CanonicalPaymentUpsert[] = []
  const organisationActions = organisationActionRows.map((row) => row.raw_json)

  for (const rawRow of organisationRows) {
    const organisation = asObject(rawRow.raw_json)
    if (!organisation) continue

    const sourceOrganisationId =
      readString(organisation.OrganisationID) ?? readString(rawRow.source_id)
    const sourceRetrievedAt = parseXeroDateTime(rawRow.fetched_at)
    if (!sourceOrganisationId || !sourceRetrievedAt) continue

    organisationsToUpsert.push({
      user_id: userId,
      tenant_id: rawRow.tenant_id,
      source_system: SOURCE_SYSTEM,
      source_organisation_id: sourceOrganisationId,
      organisation_name: readString(organisation.Name),
      base_currency_code: normalizeCurrencyCode(organisation.BaseCurrency),
      country_code: normalizeCountryCode(organisation.CountryCode),
      source_timezone: readString(organisation.Timezone),
      xero_version: readString(organisation.Version),
      use_multicurrency: readUseMulticurrency(organisationActions),
      source_retrieved_at: sourceRetrievedAt,
    })
    organisationCurrencyContexts.push({
      sourceOrganisationId,
      sourceRetrievedAt,
      baseCurrency: organisation.BaseCurrency,
    })
  }

  organisationCurrencyContexts.sort((left, right) => {
    const retrievedComparison = right.sourceRetrievedAt.localeCompare(left.sourceRetrievedAt)
    if (retrievedComparison !== 0) return retrievedComparison
    return left.sourceOrganisationId.localeCompare(right.sourceOrganisationId)
  })
  const organisationBaseCurrency = organisationCurrencyContexts[0]?.baseCurrency ?? null

  for (const rawRow of contactRows) {
    const contact = asObject(rawRow.raw_json)
    if (!contact) continue

    const sourceId = readString(contact.ContactID) ?? readString(rawRow.source_id)
    if (!sourceId) continue

    customersToUpsert.push({
      user_id: userId,
      tenant_id: rawRow.tenant_id,
      source_system: SOURCE_SYSTEM,
      source_id: sourceId,
      name: readString(contact.Name) ?? sourceId,
      email: readString(contact.EmailAddress),
      is_customer: readBoolean(contact.IsCustomer),
      is_supplier: readBoolean(contact.IsSupplier),
      status: readString(contact.ContactStatus),
      raw_updated_at: parseXeroDateTime(contact.UpdatedDateUTC),
    })
  }

  for (const rawRow of invoiceRows) {
    const invoice = asObject(rawRow.raw_json)
    if (!invoice) continue

    const sourceId = readString(invoice.InvoiceID) ?? readString(rawRow.source_id)
    if (!sourceId) continue

    const contact = asObject(invoice.Contact)
    const customerSourceId = contact ? readString(contact.ContactID) : null
    const rawUpdatedAt = parseXeroDateTime(invoice.UpdatedDateUTC)
    const currency = convertCurrencyAmounts({
      transactionCurrency: invoice.CurrencyCode,
      organisationBaseCurrency,
      xeroCurrencyRate: invoice.CurrencyRate as string | number | null | undefined,
      amounts: {
        total: invoice.Total,
        amountDue: invoice.AmountDue,
        amountPaid: invoice.AmountPaid,
        amountCredited: invoice.AmountCredited,
      },
    })

    invoicesToUpsert.push({
      user_id: userId,
      tenant_id: rawRow.tenant_id,
      source_system: SOURCE_SYSTEM,
      source_id: sourceId,
      customer_source_id: customerSourceId,
      type: readString(invoice.Type),
      invoice_number: readString(invoice.InvoiceNumber),
      reference: readString(invoice.Reference),
      status: readString(invoice.Status),
      issue_date: parseXeroDate(invoice.DateString) ?? parseXeroDate(invoice.Date),
      due_date: parseXeroDate(invoice.DueDateString) ?? parseXeroDate(invoice.DueDate),
      fully_paid_date: parseXeroDate(invoice.FullyPaidOnDate),
      currency_code: readString(invoice.CurrencyCode),
      total: safeNumber(invoice.Total),
      amount_due: safeNumber(invoice.AmountDue),
      amount_paid: safeNumber(invoice.AmountPaid),
      amount_credited: safeNumber(invoice.AmountCredited),
      transaction_currency_code: currency.transactionCurrencyCode,
      organisation_base_currency_code: currency.organisationBaseCurrencyCode,
      xero_currency_rate: currency.xeroCurrencyRate,
      total_native: currency.amounts.total.native,
      amount_due_native: currency.amounts.amountDue.native,
      amount_paid_native: currency.amounts.amountPaid.native,
      amount_credited_native: currency.amounts.amountCredited.native,
      total_base: currency.amounts.total.base,
      amount_due_base: currency.amounts.amountDue.base,
      amount_paid_base: currency.amounts.amountPaid.base,
      amount_credited_base: currency.amounts.amountCredited.base,
      currency_conversion_status: currency.status,
      currency_conversion_failure_reason: currency.failureReason,
      sent_to_contact: readBoolean(invoice.SentToContact),
      raw_updated_at: rawUpdatedAt,
    })

    if (!Array.isArray(invoice.Payments)) continue

    for (const paymentRaw of invoice.Payments) {
      const payment = asObject(paymentRaw)
      if (!payment) continue

      const paymentSourceId = readString(payment.PaymentID)
      if (!paymentSourceId) continue

      paymentsToUpsert.push({
        user_id: userId,
        tenant_id: rawRow.tenant_id,
        source_system: SOURCE_SYSTEM,
        source_id: paymentSourceId,
        invoice_source_id: sourceId,
        customer_source_id: customerSourceId,
        amount: safeNumber(payment.Amount),
        payment_date: parseXeroDate(payment.Date),
        currency_rate: safeNumber(payment.CurrencyRate),
        reference: readString(payment.Reference),
        raw_updated_at: rawUpdatedAt,
      })
    }
  }

  const uniqueOrganisations = dedupeCanonicalOrganisationRows(organisationsToUpsert)
  const uniqueCustomers = dedupeCanonicalRows(customersToUpsert)
  const uniqueInvoices = dedupeCanonicalRows(invoicesToUpsert)
  const uniquePayments = dedupeCanonicalRows(paymentsToUpsert)

  await upsertInChunks(
    supabaseAdmin,
    'canonical_organisations',
    uniqueOrganisations,
    'user_id,tenant_id,source_system,source_organisation_id'
  )
  await upsertInChunks(supabaseAdmin, 'canonical_customers', uniqueCustomers)
  await upsertInChunks(supabaseAdmin, 'canonical_invoices', uniqueInvoices)
  await upsertInChunks(supabaseAdmin, 'canonical_payments', uniquePayments)

  return {
    organisations: uniqueOrganisations.length,
    customers: uniqueCustomers.length,
    invoices: uniqueInvoices.length,
    payments: uniquePayments.length,
  }
}
