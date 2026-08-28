import 'server-only'

import { createServerSupabaseClient } from '@/lib/supabase-server'

const PAGE_SIZE = 1000
const MS_PER_DAY = 86_400_000
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const COLLECTIBLE_INVOICE_TYPE = 'ACCREC'
const COLLECTIBLE_INVOICE_STATUS = 'AUTHORISED'
const RECENT_PAYMENT_WINDOW_DAYS = 30

export interface CustomerCollectionsSummaryRow {
  customer_source_id: string
  customer_name: string
  customer_email: string | null
  is_customer: boolean | null
  is_supplier: boolean | null
  status: string | null
  total_invoices_count: number
  open_invoices_count: number
  overdue_invoices_count: number
  total_outstanding: number
  overdue_outstanding: number
  oldest_overdue_invoice_date: string | null
  oldest_overdue_days: number | null
  weighted_avg_overdue_days: number
  latest_invoice_date: string | null
  latest_due_date: string | null
  last_payment_date: string | null
  last_payment_days_ago: number | null
  has_recent_partial_payment: boolean
  currency_code: string | null
}

export interface CustomerCollectionsSummaryResult {
  rows: CustomerCollectionsSummaryRow[]
  sourceCounts: {
    customers: number
    invoices: number
    payments: number
  }
}

interface CanonicalCustomerRow {
  source_id: string
  name: string
  email: string | null
  is_customer: boolean | null
  is_supplier: boolean | null
  status: string | null
}

interface CanonicalInvoiceRow {
  source_id: string
  customer_source_id: string | null
  type: string | null
  status: string | null
  issue_date: string | null
  due_date: string | null
  currency_code: string | null
  amount_due: string | number | null
}

interface CanonicalPaymentRow {
  invoice_source_id: string | null
  customer_source_id: string | null
  payment_date: string | null
}

interface MutableCustomerSummaryRow extends CustomerCollectionsSummaryRow {
  has_receivable_invoice_activity: boolean
  currency_codes: Set<string>
  open_receivable_invoice_source_ids: Set<string>
  overdue_weighted_days_numerator: number
  overdue_weighted_days_denominator: number
}

type ServerSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>

function normalizeSourceId(value: string | null | undefined) {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeInvoiceType(value: string | null) {
  if (!value) return null
  const normalized = value.trim().toUpperCase()
  return normalized.length > 0 ? normalized : null
}

function normalizeInvoiceStatus(value: string | null) {
  if (!value) return null
  const normalized = value.trim().toUpperCase()
  return normalized.length > 0 ? normalized : null
}

function isIsoDate(value: string | null | undefined): value is string {
  return typeof value === 'string' && ISO_DATE_REGEX.test(value)
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number.parseFloat(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function maxIsoDate(a: string | null, b: string | null) {
  if (!isIsoDate(a)) return isIsoDate(b) ? b : null
  if (!isIsoDate(b)) return a
  return a >= b ? a : b
}

function minIsoDate(a: string | null, b: string | null) {
  if (!isIsoDate(a)) return isIsoDate(b) ? b : null
  if (!isIsoDate(b)) return a
  return a <= b ? a : b
}

function toUtcDateMs(isoDate: string) {
  const [yearRaw, monthRaw, dayRaw] = isoDate.split('-')
  const year = Number.parseInt(yearRaw, 10)
  const month = Number.parseInt(monthRaw, 10)
  const day = Number.parseInt(dayRaw, 10)
  return Date.UTC(year, month - 1, day)
}

function getTodayContext() {
  const now = new Date()
  const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const todayIso = new Date(todayUtcMs).toISOString().slice(0, 10)
  return { todayIso, todayUtcMs }
}

function calculateDaysAgo(todayUtcMs: number, isoDate: string | null) {
  if (!isIsoDate(isoDate)) return null
  return Math.floor((todayUtcMs - toUtcDateMs(isoDate)) / MS_PER_DAY)
}

function calculateOverdueDays(todayUtcMs: number, dueDate: string | null) {
  if (!isIsoDate(dueDate)) return 0
  return Math.max(0, Math.floor((todayUtcMs - toUtcDateMs(dueDate)) / MS_PER_DAY))
}

function isRecentDateWithinDays(todayUtcMs: number, isoDate: string, windowDays: number) {
  const daysAgo = calculateDaysAgo(todayUtcMs, isoDate)
  if (daysAgo === null) return false
  return daysAgo >= 0 && daysAgo <= windowDays
}

function isOpenInvoice(status: string | null, amountDue: number) {
  return normalizeInvoiceStatus(status) === COLLECTIBLE_INVOICE_STATUS && amountDue > 0
}

function mergeBoolean(current: boolean | null, incoming: boolean | null) {
  if (current === true || incoming === true) return true
  if (current === false || incoming === false) return false
  return null
}

function createMutableSummary(sourceId: string): MutableCustomerSummaryRow {
  return {
    customer_source_id: sourceId,
    customer_name: sourceId,
    customer_email: null,
    is_customer: null,
    is_supplier: null,
    status: null,
    total_invoices_count: 0,
    open_invoices_count: 0,
    overdue_invoices_count: 0,
    total_outstanding: 0,
    overdue_outstanding: 0,
    oldest_overdue_invoice_date: null,
    oldest_overdue_days: null,
    weighted_avg_overdue_days: 0,
    latest_invoice_date: null,
    latest_due_date: null,
    last_payment_date: null,
    last_payment_days_ago: null,
    has_recent_partial_payment: false,
    currency_code: null,
    has_receivable_invoice_activity: false,
    currency_codes: new Set<string>(),
    open_receivable_invoice_source_ids: new Set<string>(),
    overdue_weighted_days_numerator: 0,
    overdue_weighted_days_denominator: 0,
  }
}

async function fetchCanonicalCustomers(
  supabase: ServerSupabaseClient,
  userId: string,
  tenantId: string
) {
  const rows: CanonicalCustomerRow[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('canonical_customers')
      .select('source_id, name, email, is_customer, is_supplier, status')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .order('source_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      throw new Error(`Failed to load canonical customers: ${error.message}`)
    }

    const batch = (data ?? []) as CanonicalCustomerRow[]
    rows.push(...batch)

    if (batch.length < PAGE_SIZE) break
  }

  return rows
}

async function fetchCanonicalInvoices(
  supabase: ServerSupabaseClient,
  userId: string,
  tenantId: string
) {
  const rows: CanonicalInvoiceRow[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('canonical_invoices')
      .select('source_id, customer_source_id, type, status, issue_date, due_date, currency_code, amount_due')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .order('source_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      throw new Error(`Failed to load canonical invoices: ${error.message}`)
    }

    const batch = (data ?? []) as CanonicalInvoiceRow[]
    rows.push(...batch)

    if (batch.length < PAGE_SIZE) break
  }

  return rows
}

async function fetchCanonicalPayments(
  supabase: ServerSupabaseClient,
  userId: string,
  tenantId: string
) {
  const rows: CanonicalPaymentRow[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('canonical_payments')
      .select('invoice_source_id, customer_source_id, payment_date')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .order('source_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      throw new Error(`Failed to load canonical payments: ${error.message}`)
    }

    const batch = (data ?? []) as CanonicalPaymentRow[]
    rows.push(...batch)

    if (batch.length < PAGE_SIZE) break
  }

  return rows
}

export async function loadCustomerCollectionsSummaryWithMetadata(
  supabase: ServerSupabaseClient,
  userId: string,
  tenantId: string
): Promise<CustomerCollectionsSummaryResult> {
  const { todayIso, todayUtcMs } = getTodayContext()

  const [customers, invoices, payments] = await Promise.all([
    fetchCanonicalCustomers(supabase, userId, tenantId),
    fetchCanonicalInvoices(supabase, userId, tenantId),
    fetchCanonicalPayments(supabase, userId, tenantId),
  ])

  const rowsByCustomerSourceId = new Map<string, MutableCustomerSummaryRow>()
  const customerBySourceId = new Map<string, CanonicalCustomerRow>()
  const customerSourceIdByCollectibleInvoiceSourceId = new Map<string, string>()

  const ensureSummary = (sourceId: string) => {
    const existing = rowsByCustomerSourceId.get(sourceId)
    if (existing) return existing

    const created = createMutableSummary(sourceId)
    rowsByCustomerSourceId.set(sourceId, created)
    return created
  }

  for (const customer of customers) {
    const sourceId = normalizeSourceId(customer.source_id)
    if (!sourceId) continue

    const existing = customerBySourceId.get(sourceId)
    if (!existing) {
      customerBySourceId.set(sourceId, customer)
      continue
    }

    customerBySourceId.set(sourceId, {
      source_id: sourceId,
      name:
        existing.name.trim().length > 0
          ? existing.name
          : customer.name.trim().length > 0
            ? customer.name
            : sourceId,
      email: existing.email ?? customer.email ?? null,
      is_customer: mergeBoolean(existing.is_customer, customer.is_customer),
      is_supplier: mergeBoolean(existing.is_supplier, customer.is_supplier),
      status: existing.status ?? customer.status ?? null,
    })
  }

  for (const invoice of invoices) {
    if (normalizeInvoiceType(invoice.type) !== COLLECTIBLE_INVOICE_TYPE) {
      continue
    }

    const invoiceSourceId = normalizeSourceId(invoice.source_id)
    const customerSourceId = normalizeSourceId(invoice.customer_source_id)

    if (invoiceSourceId && customerSourceId) {
      customerSourceIdByCollectibleInvoiceSourceId.set(invoiceSourceId, customerSourceId)
    }

    if (normalizeInvoiceStatus(invoice.status) !== COLLECTIBLE_INVOICE_STATUS) {
      continue
    }

    if (!customerSourceId) continue

    const summary = ensureSummary(customerSourceId)
    summary.has_receivable_invoice_activity = true
    summary.total_invoices_count += 1

    const issueDate = isIsoDate(invoice.issue_date) ? invoice.issue_date : null
    const dueDate = isIsoDate(invoice.due_date) ? invoice.due_date : null
    const amountDue = parseNumeric(invoice.amount_due) ?? 0
    const currencyCode = invoice.currency_code?.trim() || null

    summary.latest_invoice_date = maxIsoDate(summary.latest_invoice_date, issueDate)
    summary.latest_due_date = maxIsoDate(summary.latest_due_date, dueDate)

    if (currencyCode) {
      summary.currency_codes.add(currencyCode)
    }

    if (!isOpenInvoice(invoice.status, amountDue)) {
      continue
    }

    summary.open_invoices_count += 1
    summary.total_outstanding += amountDue

    if (invoiceSourceId) {
      summary.open_receivable_invoice_source_ids.add(invoiceSourceId)
    }

    if (dueDate && dueDate < todayIso) {
      const overdueDays = calculateOverdueDays(todayUtcMs, dueDate)

      summary.overdue_invoices_count += 1
      summary.overdue_outstanding += amountDue
      summary.oldest_overdue_invoice_date = minIsoDate(summary.oldest_overdue_invoice_date, dueDate)
      summary.overdue_weighted_days_numerator += amountDue * overdueDays
      summary.overdue_weighted_days_denominator += amountDue
    }
  }

  for (const [sourceId, customer] of customerBySourceId.entries()) {
    const summary = rowsByCustomerSourceId.get(sourceId)

    if (!summary) {
      if (customer.is_customer !== true) continue
      const created = ensureSummary(sourceId)
      created.customer_name = customer.name.trim().length > 0 ? customer.name : sourceId
      created.customer_email = customer.email
      created.is_customer = customer.is_customer
      created.is_supplier = customer.is_supplier
      created.status = customer.status
      continue
    }

    if (summary.customer_name === sourceId && customer.name.trim().length > 0) {
      summary.customer_name = customer.name
    }
    if (!summary.customer_email && customer.email) {
      summary.customer_email = customer.email
    }
    summary.is_customer = mergeBoolean(summary.is_customer, customer.is_customer)
    summary.is_supplier = mergeBoolean(summary.is_supplier, customer.is_supplier)
    if (!summary.status && customer.status) {
      summary.status = customer.status
    }
  }

  for (const payment of payments) {
    const invoiceSourceId = normalizeSourceId(payment.invoice_source_id)
    const customerSourceId =
      normalizeSourceId(payment.customer_source_id) ??
      (invoiceSourceId
        ? customerSourceIdByCollectibleInvoiceSourceId.get(invoiceSourceId) ?? null
        : null)
    if (!customerSourceId) continue

    const paymentDate = isIsoDate(payment.payment_date) ? payment.payment_date : null
    if (!paymentDate) continue

    const summary = rowsByCustomerSourceId.get(customerSourceId)
    if (!summary) continue

    summary.last_payment_date = maxIsoDate(summary.last_payment_date, paymentDate)

    const isRecentPartialPayment =
      !!invoiceSourceId &&
      summary.open_receivable_invoice_source_ids.has(invoiceSourceId) &&
      isRecentDateWithinDays(todayUtcMs, paymentDate, RECENT_PAYMENT_WINDOW_DAYS)

    if (isRecentPartialPayment) {
      summary.has_recent_partial_payment = true
    }
  }

  const rows: CustomerCollectionsSummaryRow[] = []

  for (const row of rowsByCustomerSourceId.values()) {
    if (!row.has_receivable_invoice_activity && row.is_customer !== true) {
      continue
    }

    row.currency_code = row.currency_codes.size === 1 ? Array.from(row.currency_codes)[0] : null
    row.oldest_overdue_days = calculateDaysAgo(todayUtcMs, row.oldest_overdue_invoice_date)
    row.last_payment_days_ago = calculateDaysAgo(todayUtcMs, row.last_payment_date)

    if (row.overdue_outstanding <= 0 || row.overdue_weighted_days_denominator <= 0) {
      row.weighted_avg_overdue_days = 0
    } else {
      row.weighted_avg_overdue_days =
        row.overdue_weighted_days_numerator / row.overdue_weighted_days_denominator
    }

    rows.push({
      customer_source_id: row.customer_source_id,
      customer_name: row.customer_name,
      customer_email: row.customer_email,
      is_customer: row.is_customer,
      is_supplier: row.is_supplier,
      status: row.status,
      total_invoices_count: row.total_invoices_count,
      open_invoices_count: row.open_invoices_count,
      overdue_invoices_count: row.overdue_invoices_count,
      total_outstanding: row.total_outstanding,
      overdue_outstanding: row.overdue_outstanding,
      oldest_overdue_invoice_date: row.oldest_overdue_invoice_date,
      oldest_overdue_days: row.oldest_overdue_days,
      weighted_avg_overdue_days: row.weighted_avg_overdue_days,
      latest_invoice_date: row.latest_invoice_date,
      latest_due_date: row.latest_due_date,
      last_payment_date: row.last_payment_date,
      last_payment_days_ago: row.last_payment_days_ago,
      has_recent_partial_payment: row.has_recent_partial_payment,
      currency_code: row.currency_code,
    })
  }

  return {
    rows,
    sourceCounts: {
      customers: customers.length,
      invoices: invoices.length,
      payments: payments.length,
    },
  }
}

export async function loadCustomerCollectionsSummary(
  supabase: ServerSupabaseClient,
  userId: string,
  tenantId: string
) {
  const result = await loadCustomerCollectionsSummaryWithMetadata(supabase, userId, tenantId)
  return result.rows
}
