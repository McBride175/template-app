import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { parseXeroDate, parseXeroDateTime, safeNumber } from '@/lib/xero/canonical-mapping'

type XeroRawResourceType = 'contacts' | 'invoices'

interface XeroRawRow {
  tenant_id: string
  source_id: string
  raw_json: unknown
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
      .select('tenant_id, source_id, raw_json')
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
  table: 'canonical_customers' | 'canonical_invoices' | 'canonical_payments',
  rows: TRow[]
) {
  for (let index = 0; index < rows.length; index += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + UPSERT_CHUNK_SIZE)
    const { error } = await supabaseAdmin.from(table).upsert(chunk as object[], {
      onConflict: 'user_id,tenant_id,source_system,source_id',
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
  const [contactRows, invoiceRows] = await Promise.all([
    fetchXeroRawRows(supabaseAdmin, userId, tenantId, 'contacts'),
    fetchXeroRawRows(supabaseAdmin, userId, tenantId, 'invoices'),
  ])

  const customersToUpsert: CanonicalCustomerUpsert[] = []
  const invoicesToUpsert: CanonicalInvoiceUpsert[] = []
  const paymentsToUpsert: CanonicalPaymentUpsert[] = []

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

  const uniqueCustomers = dedupeCanonicalRows(customersToUpsert)
  const uniqueInvoices = dedupeCanonicalRows(invoicesToUpsert)
  const uniquePayments = dedupeCanonicalRows(paymentsToUpsert)

  await upsertInChunks(supabaseAdmin, 'canonical_customers', uniqueCustomers)
  await upsertInChunks(supabaseAdmin, 'canonical_invoices', uniqueInvoices)
  await upsertInChunks(supabaseAdmin, 'canonical_payments', uniquePayments)

  return {
    customers: uniqueCustomers.length,
    invoices: uniqueInvoices.length,
    payments: uniquePayments.length,
  }
}
