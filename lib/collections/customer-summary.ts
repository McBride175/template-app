import 'server-only'

import { createServerSupabaseClient } from '@/lib/supabase-server'
import {
  calculateHistoricalPaymentBaseline,
  calculateRelativeLatenessDays,
  type HistoricalPaymentInvoice,
} from '@/lib/collections/payment-behavior'
import {
  evaluateCollectionsCurrencyHealth,
  type CollectionsCurrencyEvaluation,
  type CollectionsCurrencyHealth,
  type CollectionsCurrencyFailureReason,
  type CollectionsCurrencyIssue,
  type CollectionsInvoiceCurrencyRow,
} from '@/lib/collections/currency-health'
import {
  compareDecimalValues,
  decimalValueToFiniteNumber,
  multiplyDecimalByInteger,
  normalizeCurrencyCode,
  normalizeDecimalValue,
  sumDecimalValues,
} from '@/lib/money/currency'

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
  total_outstanding_base_decimal: string
  overdue_outstanding_base_decimal: string
  total_outstanding_base: number
  overdue_outstanding_base: number
  /** @deprecated Base-currency compatibility alias. */
  total_outstanding: number
  /** @deprecated Base-currency compatibility alias. */
  overdue_outstanding: number
  oldest_overdue_invoice_date: string | null
  oldest_overdue_days: number | null
  weighted_avg_overdue_days: number
  historical_paid_invoice_count: number
  historical_mean_days_late: number | null
  historical_normal_days_late: number | null
  relative_lateness_days: number | null
  latest_invoice_date: string | null
  latest_due_date: string | null
  last_payment_date: string | null
  last_payment_days_ago: number | null
  has_recent_partial_payment: boolean
  organisation_base_currency_code: string
  /** @deprecated Organisation-base-currency compatibility alias. */
  currency_code: string
  native_currency_breakdown: NativeCurrencyBreakdown[]
}

export interface NativeCurrencyBreakdown {
  currency_code: string
  total_outstanding_native: string
  overdue_outstanding_native: string
}

export interface CurrencyReviewRequiredCustomer {
  customer_source_id: string
  customer_name: string
  customer_email: string | null
  review_status: 'unscored_due_to_currency'
  affected_invoice_count: number
  open_invoices_count: number
  overdue_invoices_count: number
  failure_reasons: Partial<Record<CollectionsCurrencyFailureReason, number>>
  native_currency_breakdown: NativeCurrencyBreakdown[]
}

export interface CustomerCollectionsSummaryResult {
  rows: CustomerCollectionsSummaryRow[]
  reviewRequiredCustomers: CurrencyReviewRequiredCustomer[]
  organisationBaseCurrency: string | null
  currencyHealth: CollectionsCurrencyHealth
  currencyEvaluation: CollectionsCurrencyEvaluation
  sourceCounts: {
    customers: number
    invoices: number
    payments: number
  }
}

interface CanonicalOrganisationRow {
  base_currency_code: string | null
}

interface CanonicalCustomerRow {
  source_id: string
  name: string
  email: string | null
  is_customer: boolean | null
  is_supplier: boolean | null
  status: string | null
}

interface CanonicalInvoiceRow extends CollectionsInvoiceCurrencyRow {
  source_id: string
  customer_source_id: string | null
  type: string | null
  status: string | null
  issue_date: string | null
  due_date: string | null
  fully_paid_date: string | null
  total_native: string | number | null
  amount_paid_native: string | number | null
  amount_credited_native: string | number | null
}

interface CanonicalPaymentRow {
  invoice_source_id: string | null
  customer_source_id: string | null
  payment_date: string | null
}

interface MutableCustomerSummaryRow extends CustomerCollectionsSummaryRow {
  has_receivable_invoice_activity: boolean
  open_receivable_invoice_source_ids: Set<string>
  total_outstanding_base_amounts: string[]
  overdue_outstanding_base_amounts: string[]
  overdue_weighted_days_numerator_amounts: string[]
  native_total_amounts_by_currency: Map<string, string[]>
  native_overdue_amounts_by_currency: Map<string, string[]>
}

interface MutableCurrencyReviewRequiredCustomer extends CurrencyReviewRequiredCustomer {
  native_total_amounts_by_currency: Map<string, string[]>
  native_overdue_amounts_by_currency: Map<string, string[]>
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

function isPositiveDecimal(value: string | null) {
  return value !== null && compareDecimalValues(value, '0') === 1
}

function mergeBoolean(current: boolean | null, incoming: boolean | null) {
  if (current === true || incoming === true) return true
  if (current === false || incoming === false) return false
  return null
}

function appendDecimalAmount(
  amountsByCurrency: Map<string, string[]>,
  currencyCode: string,
  amount: string
) {
  const amounts = amountsByCurrency.get(currencyCode) ?? []
  amounts.push(amount)
  amountsByCurrency.set(currencyCode, amounts)
}

function incrementFailureReason(
  reasons: Partial<Record<CollectionsCurrencyFailureReason, number>>,
  reason: CollectionsCurrencyFailureReason
) {
  reasons[reason] = (reasons[reason] ?? 0) + 1
}

function buildReviewRequiredCustomers(params: {
  customerBySourceId: ReadonlyMap<string, CanonicalCustomerRow>
  invoices: readonly CanonicalInvoiceRow[]
  currencyIssues: readonly CollectionsCurrencyIssue[]
  affectedCustomerSourceIds: readonly string[]
  todayIso: string
}): CurrencyReviewRequiredCustomer[] {
  const reviewByCustomerSourceId = new Map<
    string,
    MutableCurrencyReviewRequiredCustomer
  >()
  const affectedInvoiceSourceIds = new Set(
    params.currencyIssues.map((issue) => normalizeSourceId(issue.invoiceSourceId)).filter(
      (sourceId): sourceId is string => sourceId !== null
    )
  )

  for (const customerSourceId of params.affectedCustomerSourceIds) {
    const customer = params.customerBySourceId.get(customerSourceId)
    reviewByCustomerSourceId.set(customerSourceId, {
      customer_source_id: customerSourceId,
      customer_name: customer?.name.trim() || customerSourceId,
      customer_email: customer?.email ?? null,
      review_status: 'unscored_due_to_currency',
      affected_invoice_count: 0,
      open_invoices_count: 0,
      overdue_invoices_count: 0,
      failure_reasons: {},
      native_currency_breakdown: [],
      native_total_amounts_by_currency: new Map<string, string[]>(),
      native_overdue_amounts_by_currency: new Map<string, string[]>(),
    })
  }

  for (const issue of params.currencyIssues) {
    const customerSourceId = normalizeSourceId(issue.customerSourceId)
    if (!customerSourceId) continue
    const review = reviewByCustomerSourceId.get(customerSourceId)
    if (!review) continue
    review.affected_invoice_count += 1
    incrementFailureReason(review.failure_reasons, issue.failureReason)
  }

  for (const invoice of params.invoices) {
    if (
      normalizeInvoiceType(invoice.type) !== COLLECTIBLE_INVOICE_TYPE ||
      normalizeInvoiceStatus(invoice.status) !== COLLECTIBLE_INVOICE_STATUS
    ) {
      continue
    }

    const customerSourceId = normalizeSourceId(invoice.customer_source_id)
    if (!customerSourceId) continue
    const review = reviewByCustomerSourceId.get(customerSourceId)
    if (!review) continue

    const invoiceSourceId = normalizeSourceId(invoice.source_id)
    const amountDueNative = normalizeDecimalValue(invoice.amount_due_native)
    const nativeAmountComparison =
      amountDueNative === null ? null : compareDecimalValues(amountDueNative, '0')
    if (
      nativeAmountComparison !== 1 &&
      !(invoiceSourceId && affectedInvoiceSourceIds.has(invoiceSourceId))
    ) {
      continue
    }

    review.open_invoices_count += 1
    const transactionCurrencyCode = normalizeCurrencyCode(invoice.transaction_currency_code)
    if (amountDueNative && nativeAmountComparison === 1 && transactionCurrencyCode) {
      appendDecimalAmount(
        review.native_total_amounts_by_currency,
        transactionCurrencyCode,
        amountDueNative
      )
    }

    const dueDate = isIsoDate(invoice.due_date) ? invoice.due_date : null
    if (dueDate && dueDate < params.todayIso) {
      review.overdue_invoices_count += 1
      if (amountDueNative && nativeAmountComparison === 1 && transactionCurrencyCode) {
        appendDecimalAmount(
          review.native_overdue_amounts_by_currency,
          transactionCurrencyCode,
          amountDueNative
        )
      }
    }
  }

  return Array.from(reviewByCustomerSourceId.values())
    .map((review) => {
      const nativeCurrencyCodes = new Set([
        ...review.native_total_amounts_by_currency.keys(),
        ...review.native_overdue_amounts_by_currency.keys(),
      ])

      return {
        customer_source_id: review.customer_source_id,
        customer_name: review.customer_name,
        customer_email: review.customer_email,
        review_status: review.review_status,
        affected_invoice_count: review.affected_invoice_count,
        open_invoices_count: review.open_invoices_count,
        overdue_invoices_count: review.overdue_invoices_count,
        failure_reasons: review.failure_reasons,
        native_currency_breakdown: Array.from(nativeCurrencyCodes)
          .sort()
          .map((currencyCode) => ({
            currency_code: currencyCode,
            total_outstanding_native:
              sumDecimalValues(
                review.native_total_amounts_by_currency.get(currencyCode) ?? []
              ) ?? '0',
            overdue_outstanding_native:
              sumDecimalValues(
                review.native_overdue_amounts_by_currency.get(currencyCode) ?? []
              ) ?? '0',
          })),
      }
    })
    .sort((a, b) =>
      a.customer_name.localeCompare(b.customer_name, undefined, { sensitivity: 'base' })
    )
}

function createMutableSummary(
  sourceId: string,
  organisationBaseCurrency: string
): MutableCustomerSummaryRow {
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
    total_outstanding_base_decimal: '0',
    overdue_outstanding_base_decimal: '0',
    total_outstanding_base: 0,
    overdue_outstanding_base: 0,
    total_outstanding: 0,
    overdue_outstanding: 0,
    oldest_overdue_invoice_date: null,
    oldest_overdue_days: null,
    weighted_avg_overdue_days: 0,
    historical_paid_invoice_count: 0,
    historical_mean_days_late: null,
    historical_normal_days_late: null,
    relative_lateness_days: null,
    latest_invoice_date: null,
    latest_due_date: null,
    last_payment_date: null,
    last_payment_days_ago: null,
    has_recent_partial_payment: false,
    organisation_base_currency_code: organisationBaseCurrency,
    currency_code: organisationBaseCurrency,
    native_currency_breakdown: [],
    has_receivable_invoice_activity: false,
    open_receivable_invoice_source_ids: new Set<string>(),
    total_outstanding_base_amounts: [],
    overdue_outstanding_base_amounts: [],
    overdue_weighted_days_numerator_amounts: [],
    native_total_amounts_by_currency: new Map<string, string[]>(),
    native_overdue_amounts_by_currency: new Map<string, string[]>(),
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

async function fetchCanonicalOrganisations(
  supabase: ServerSupabaseClient,
  userId: string,
  tenantId: string
) {
  const { data, error } = await supabase
    .from('canonical_organisations')
    .select('base_currency_code')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)

  if (error) {
    throw new Error(`Failed to load canonical organisation currency: ${error.message}`)
  }

  return (data ?? []) as CanonicalOrganisationRow[]
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
      .select(
        'source_id, customer_source_id, type, status, issue_date, due_date, fully_paid_date, transaction_currency_code, organisation_base_currency_code, total_native, amount_paid_native, amount_due_native, amount_credited_native, amount_due_base, currency_conversion_status, currency_conversion_failure_reason'
      )
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

  const [organisations, customers, invoices, payments] = await Promise.all([
    fetchCanonicalOrganisations(supabase, userId, tenantId),
    fetchCanonicalCustomers(supabase, userId, tenantId),
    fetchCanonicalInvoices(supabase, userId, tenantId),
    fetchCanonicalPayments(supabase, userId, tenantId),
  ])

  const currencyEvaluation = evaluateCollectionsCurrencyHealth({ organisations, invoices })
  const {
    organisationBaseCurrency,
    currencyHealth,
    affectedCustomerSourceIds,
    currencyIssues,
  } = currencyEvaluation
  const sourceCounts = {
    customers: customers.length,
    invoices: invoices.length,
    payments: payments.length,
  }
  const customerBySourceId = new Map<string, CanonicalCustomerRow>()

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

  if (currencyHealth.status === 'unavailable' || !organisationBaseCurrency) {
    return {
      rows: [],
      reviewRequiredCustomers: [],
      organisationBaseCurrency,
      currencyHealth,
      currencyEvaluation,
      sourceCounts,
    }
  }

  const reviewRequiredCustomers = buildReviewRequiredCustomers({
    customerBySourceId,
    invoices,
    currencyIssues,
    affectedCustomerSourceIds,
    todayIso,
  })
  const affectedCustomerSourceIdSet = new Set(affectedCustomerSourceIds)

  const rowsByCustomerSourceId = new Map<string, MutableCustomerSummaryRow>()
  const customerSourceIdByCollectibleInvoiceSourceId = new Map<string, string>()
  const historicalInvoicesByCustomerSourceId = new Map<string, HistoricalPaymentInvoice[]>()

  const ensureSummary = (sourceId: string) => {
    const existing = rowsByCustomerSourceId.get(sourceId)
    if (existing) return existing

    const created = createMutableSummary(sourceId, organisationBaseCurrency)
    rowsByCustomerSourceId.set(sourceId, created)
    return created
  }

  for (const invoice of invoices) {
    if (normalizeInvoiceType(invoice.type) !== COLLECTIBLE_INVOICE_TYPE) {
      continue
    }

    const invoiceSourceId = normalizeSourceId(invoice.source_id)
    const customerSourceId = normalizeSourceId(invoice.customer_source_id)

    if (customerSourceId) {
      const historicalInvoices = historicalInvoicesByCustomerSourceId.get(customerSourceId) ?? []
      historicalInvoices.push({
        type: invoice.type,
        status: invoice.status,
        due_date: invoice.due_date,
        fully_paid_date: invoice.fully_paid_date,
        total: invoice.total_native,
        amount_paid: invoice.amount_paid_native,
        amount_due: invoice.amount_due_native,
        amount_credited: invoice.amount_credited_native,
      })
      historicalInvoicesByCustomerSourceId.set(customerSourceId, historicalInvoices)
    }

    if (invoiceSourceId && customerSourceId) {
      customerSourceIdByCollectibleInvoiceSourceId.set(invoiceSourceId, customerSourceId)
    }

    if (normalizeInvoiceStatus(invoice.status) !== COLLECTIBLE_INVOICE_STATUS) {
      continue
    }

    if (!customerSourceId) continue
    if (affectedCustomerSourceIdSet.has(customerSourceId)) continue

    const summary = ensureSummary(customerSourceId)
    summary.has_receivable_invoice_activity = true
    summary.total_invoices_count += 1

    const issueDate = isIsoDate(invoice.issue_date) ? invoice.issue_date : null
    const dueDate = isIsoDate(invoice.due_date) ? invoice.due_date : null
    const amountDueNative = normalizeDecimalValue(invoice.amount_due_native)
    const amountDueBase = normalizeDecimalValue(invoice.amount_due_base)
    const transactionCurrencyCode = normalizeCurrencyCode(invoice.transaction_currency_code)

    summary.latest_invoice_date = maxIsoDate(summary.latest_invoice_date, issueDate)
    summary.latest_due_date = maxIsoDate(summary.latest_due_date, dueDate)

    if (amountDueNative === null || !isPositiveDecimal(amountDueNative)) {
      continue
    }

    if (!amountDueBase || !transactionCurrencyCode || !isPositiveDecimal(amountDueBase)) {
      throw new Error(
        `Currency health invariant failed for collectible invoice ${invoice.source_id}`
      )
    }

    summary.open_invoices_count += 1
    summary.total_outstanding_base_amounts.push(amountDueBase)
    appendDecimalAmount(
      summary.native_total_amounts_by_currency,
      transactionCurrencyCode,
      amountDueNative
    )

    if (invoiceSourceId) {
      summary.open_receivable_invoice_source_ids.add(invoiceSourceId)
    }

    if (dueDate && dueDate < todayIso) {
      const overdueDays = calculateOverdueDays(todayUtcMs, dueDate)

      summary.overdue_invoices_count += 1
      summary.overdue_outstanding_base_amounts.push(amountDueBase)
      appendDecimalAmount(
        summary.native_overdue_amounts_by_currency,
        transactionCurrencyCode,
        amountDueNative
      )
      summary.oldest_overdue_invoice_date = minIsoDate(summary.oldest_overdue_invoice_date, dueDate)
      const weightedAmount = multiplyDecimalByInteger(amountDueBase, overdueDays)
      if (weightedAmount === null) {
        throw new Error(
          `Failed to weight base amount for collectible invoice ${invoice.source_id}`
        )
      }
      summary.overdue_weighted_days_numerator_amounts.push(weightedAmount)
    }
  }

  for (const [sourceId, customer] of customerBySourceId.entries()) {
    if (affectedCustomerSourceIdSet.has(sourceId)) continue
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

    row.oldest_overdue_days = calculateDaysAgo(todayUtcMs, row.oldest_overdue_invoice_date)
    row.last_payment_days_ago = calculateDaysAgo(todayUtcMs, row.last_payment_date)

    const totalOutstandingBaseDecimal =
      sumDecimalValues(row.total_outstanding_base_amounts) ?? '0'
    const overdueOutstandingBaseDecimal =
      sumDecimalValues(row.overdue_outstanding_base_amounts) ?? '0'
    const weightedDaysNumeratorDecimal =
      sumDecimalValues(row.overdue_weighted_days_numerator_amounts) ?? '0'
    const totalOutstandingBase = decimalValueToFiniteNumber(totalOutstandingBaseDecimal)
    const overdueOutstandingBase = decimalValueToFiniteNumber(overdueOutstandingBaseDecimal)
    const weightedDaysNumerator = decimalValueToFiniteNumber(weightedDaysNumeratorDecimal)

    if (
      totalOutstandingBase === null ||
      overdueOutstandingBase === null ||
      weightedDaysNumerator === null
    ) {
      throw new Error(`Base-currency aggregation exceeded the supported calculation range`)
    }

    row.total_outstanding_base = totalOutstandingBase
    row.overdue_outstanding_base = overdueOutstandingBase
    row.total_outstanding_base_decimal = totalOutstandingBaseDecimal
    row.overdue_outstanding_base_decimal = overdueOutstandingBaseDecimal
    row.total_outstanding = totalOutstandingBase
    row.overdue_outstanding = overdueOutstandingBase

    if (overdueOutstandingBase <= 0) {
      row.weighted_avg_overdue_days = 0
    } else {
      row.weighted_avg_overdue_days = weightedDaysNumerator / overdueOutstandingBase
    }

    const nativeCurrencyCodes = new Set([
      ...row.native_total_amounts_by_currency.keys(),
      ...row.native_overdue_amounts_by_currency.keys(),
    ])
    row.native_currency_breakdown = Array.from(nativeCurrencyCodes)
      .sort()
      .map((currencyCode) => ({
        currency_code: currencyCode,
        total_outstanding_native:
          sumDecimalValues(row.native_total_amounts_by_currency.get(currencyCode) ?? []) ?? '0',
        overdue_outstanding_native:
          sumDecimalValues(row.native_overdue_amounts_by_currency.get(currencyCode) ?? []) ?? '0',
      }))

    const historicalBaseline = calculateHistoricalPaymentBaseline(
      historicalInvoicesByCustomerSourceId.get(row.customer_source_id) ?? [],
      { evaluationDate: todayIso }
    )
    row.historical_paid_invoice_count = historicalBaseline.usableInvoiceCount
    row.historical_mean_days_late = historicalBaseline.meanDaysLate
    row.historical_normal_days_late = historicalBaseline.normalDaysLate
    row.relative_lateness_days = calculateRelativeLatenessDays(
      row.weighted_avg_overdue_days,
      historicalBaseline.normalDaysLate
    )

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
      total_outstanding_base_decimal: row.total_outstanding_base_decimal,
      overdue_outstanding_base_decimal: row.overdue_outstanding_base_decimal,
      total_outstanding_base: row.total_outstanding_base,
      overdue_outstanding_base: row.overdue_outstanding_base,
      total_outstanding: row.total_outstanding,
      overdue_outstanding: row.overdue_outstanding,
      oldest_overdue_invoice_date: row.oldest_overdue_invoice_date,
      oldest_overdue_days: row.oldest_overdue_days,
      weighted_avg_overdue_days: row.weighted_avg_overdue_days,
      historical_paid_invoice_count: row.historical_paid_invoice_count,
      historical_mean_days_late: row.historical_mean_days_late,
      historical_normal_days_late: row.historical_normal_days_late,
      relative_lateness_days: row.relative_lateness_days,
      latest_invoice_date: row.latest_invoice_date,
      latest_due_date: row.latest_due_date,
      last_payment_date: row.last_payment_date,
      last_payment_days_ago: row.last_payment_days_ago,
      has_recent_partial_payment: row.has_recent_partial_payment,
      organisation_base_currency_code: row.organisation_base_currency_code,
      currency_code: row.currency_code,
      native_currency_breakdown: row.native_currency_breakdown,
    })
  }

  return {
    rows,
    reviewRequiredCustomers,
    organisationBaseCurrency,
    currencyHealth,
    currencyEvaluation,
    sourceCounts,
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
