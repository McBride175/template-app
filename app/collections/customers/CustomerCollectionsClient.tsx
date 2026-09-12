'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Card from '@/app/components/Card'
import Button from '@/app/components/Button'
import MultiCurrencyPlanGate from '@/app/collections/MultiCurrencyPlanGate'
import {
  formatCurrentOverdueAge,
  formatHistoricalPaymentTiming,
  formatRelativeLateness,
} from '@/lib/collections/payment-behavior-copy'

type SortBy =
  | 'overdue_outstanding'
  | 'total_outstanding'
  | 'oldest_overdue_days'
  | 'customer_name'

type SortDir = 'asc' | 'desc'

interface CustomerCollectionsSummaryRow {
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
  organisation_base_currency_code: string
  native_currency_breakdown: Array<{
    currency_code: string
    total_outstanding_native: string
    overdue_outstanding_native: string
  }>
}

interface CollectionsCurrencyContext {
  mode: 'single_currency' | 'multi_currency'
  invoicedCurrencies: string[]
  relevantInvoiceCount: number
}

interface CollectionsCurrencyAccess {
  allowed: boolean
  requiresPro: boolean
  reason: 'allowed' | 'actions_access_required' | 'multi_currency_requires_pro'
}

interface CollectionsCurrencyHealth {
  status: 'healthy' | 'degraded' | 'unavailable'
  rankingStatus: 'complete' | 'provisional' | 'unavailable'
  affectedInvoiceCount: number
  affectedCustomerCount: number
  failureReasons: Record<string, number>
}

interface CurrencyReviewRequiredCustomer {
  customer_source_id: string
  customer_name: string
  customer_email: string | null
  review_status: 'unscored_due_to_currency'
  affected_invoice_count: number
  open_invoices_count: number
  overdue_invoices_count: number
  failure_reasons: Record<string, number>
  native_currency_breakdown: Array<{
    currency_code: string
    total_outstanding_native: string
    overdue_outstanding_native: string
  }>
}

interface CollectionsApiResponse {
  ok?: boolean
  code?: string
  rows?: CustomerCollectionsSummaryRow[]
  tenantId?: string | null
  organisationBaseCurrency?: string | null
  currencyContext?: CollectionsCurrencyContext
  currencyAccess?: CollectionsCurrencyAccess
  currencyHealth?: CollectionsCurrencyHealth
  reviewRequiredCustomers?: CurrencyReviewRequiredCustomer[]
  error?: string
}

interface CustomerCollectionsClientProps {
  tenantId?: string | null
}

const SORT_OPTIONS: Array<{
  value: `${SortBy}:${SortDir}`
  label: string
}> = [
  { value: 'overdue_outstanding:desc', label: 'Overdue outstanding (high to low)' },
  { value: 'overdue_outstanding:asc', label: 'Overdue outstanding (low to high)' },
  { value: 'total_outstanding:desc', label: 'Total outstanding (high to low)' },
  { value: 'total_outstanding:asc', label: 'Total outstanding (low to high)' },
  { value: 'oldest_overdue_days:desc', label: 'Oldest overdue (oldest first)' },
  { value: 'oldest_overdue_days:asc', label: 'Oldest overdue (newest first)' },
  { value: 'customer_name:asc', label: 'Customer name (A to Z)' },
  { value: 'customer_name:desc', label: 'Customer name (Z to A)' },
]

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString()
}

function formatMoney(amount: number, currencyCode: string | null) {
  const normalizedCurrencyCode = currencyCode?.trim() || null

  if (normalizedCurrencyCode) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: normalizedCurrencyCode,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount)
    } catch {
      // Fall through to generic number formatting when currency code is invalid.
    }
  }

  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatInvoicedAmount(amount: string, currencyCode: string) {
  const numericAmount = Number(amount)
  if (!Number.isFinite(numericAmount)) return `${currencyCode} ${amount}`
  return `${formatMoney(numericAmount, currencyCode)} ${currencyCode}`
}

function formatInvoicedBreakdown(
  breakdown: CustomerCollectionsSummaryRow['native_currency_breakdown'],
  amountField: 'total_outstanding_native' | 'overdue_outstanding_native'
) {
  return breakdown
    .filter((entry) => Number(entry[amountField]) > 0)
    .map((entry) => formatInvoicedAmount(entry[amountField], entry.currency_code))
    .join(' · ')
}

function formatCurrencyFailureReason(reason: string) {
  return reason.replaceAll('_', ' ')
}

function getStatusLabel(row: CustomerCollectionsSummaryRow) {
  if (row.status?.trim()) return row.status
  if (row.is_customer === true) return 'customer'
  if (row.is_supplier === true) return 'supplier'
  return 'contact'
}

function getStatusBadgeClasses(row: CustomerCollectionsSummaryRow) {
  if (row.overdue_outstanding_base > 0) {
    return 'bg-amber-100 text-amber-800'
  }
  return 'bg-gray-100 text-gray-700'
}

export default function CustomerCollectionsClient({ tenantId = null }: CustomerCollectionsClientProps) {
  const router = useRouter()
  const loginNextPath = tenantId
    ? `/customers?tenantId=${encodeURIComponent(tenantId)}`
    : '/customers'
  const [rows, setRows] = useState<CustomerCollectionsSummaryRow[]>([])
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [sortOption, setSortOption] =
    useState<`${SortBy}:${SortDir}`>('overdue_outstanding:desc')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [organisationBaseCurrency, setOrganisationBaseCurrency] = useState<string | null>(null)
  const [currencyContext, setCurrencyContext] = useState<CollectionsCurrencyContext | null>(null)
  const [currencyAccess, setCurrencyAccess] = useState<CollectionsCurrencyAccess | null>(null)
  const [currencyHealth, setCurrencyHealth] = useState<CollectionsCurrencyHealth | null>(null)
  const [reviewRequiredCustomers, setReviewRequiredCustomers] = useState<
    CurrencyReviewRequiredCustomer[]
  >([])

  const loadRows = useCallback(
    async (manualRefresh: boolean) => {
      if (manualRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)

      try {
        const [sortBy, sortDir] = sortOption.split(':') as [SortBy, SortDir]
        const params = new URLSearchParams({
          overdueOnly: String(overdueOnly),
          sortBy,
          sortDir,
          limit: '200',
        })
        if (tenantId) {
          params.set('tenantId', tenantId)
        }

        const response = await fetch(`/api/collections/customers?${params.toString()}`, {
          cache: 'no-store',
          credentials: 'include',
        })

        if (response.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(loginNextPath)}`)
          return
        }

        const payload = (await response.json().catch(() => null)) as CollectionsApiResponse | null

        if (response.status === 402 && payload?.code === 'MULTI_CURRENCY_REQUIRES_PRO') {
          setRows([])
          setOrganisationBaseCurrency(null)
          setCurrencyContext(payload.currencyContext ?? null)
          setCurrencyAccess(payload.currencyAccess ?? null)
          setCurrencyHealth(null)
          setReviewRequiredCustomers([])
          return
        }

        if (response.status === 402) {
          router.push('/pricing?reason=usage-limit')
          return
        }

        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || 'Failed to load customer collections summary.')
        }

        setRows(payload.rows ?? [])
        setOrganisationBaseCurrency(payload.organisationBaseCurrency ?? null)
        setCurrencyContext(payload.currencyContext ?? null)
        setCurrencyAccess(payload.currencyAccess ?? null)
        setCurrencyHealth(payload.currencyHealth ?? null)
        setReviewRequiredCustomers(payload.reviewRequiredCustomers ?? [])
      } catch (fetchError) {
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : 'Failed to load customer collections summary.'
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [loginNextPath, overdueOnly, router, sortOption, tenantId]
  )

  useEffect(() => {
    void loadRows(false)
  }, [loadRows])

  const multiCurrencyPlanRequired = Boolean(
    currencyAccess?.requiresPro && !currencyAccess.allowed
  )
  const showMultiCurrencyAmounts = Boolean(
    currencyAccess?.allowed && currencyContext?.mode === 'multi_currency'
  )

  const description = useMemo(() => {
    if (loading) return 'Loading customer aggregation…'
    if (currencyHealth?.status === 'unavailable') return 'Collections ranking is unavailable.'
    if (currencyHealth?.status === 'degraded' && rows.length === 0) {
      return `No safely valued customers shown · ${reviewRequiredCustomers.length} need review`
    }
    if (rows.length === 0) return 'No customer rows matched the current filters.'
    const rankedDescription = `${rows.length} customer${rows.length === 1 ? '' : 's'} shown`
    if (currencyHealth?.status !== 'degraded') return rankedDescription
    return `${rankedDescription} · ${reviewRequiredCustomers.length} need review`
  }, [currencyHealth?.status, loading, reviewRequiredCustomers.length, rows.length])

  const totals = useMemo(() => {
    let outstandingBase = 0
    let overdueOutstandingBase = 0
    let overdueInvoicesCount = 0
    let oldestOverdueDaysSum = 0

    for (const row of rows) {
      outstandingBase += row.total_outstanding_base
      overdueOutstandingBase += row.overdue_outstanding_base
      overdueInvoicesCount += row.overdue_invoices_count
      oldestOverdueDaysSum += row.oldest_overdue_days ?? 0
    }

    return {
      outstandingBase,
      overdueOutstandingBase,
      overdueInvoicesCount,
      oldestOverdueDaysSum,
    }
  }, [rows])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Customer Collections Summary</h1>
          <p className="mt-1 text-sm text-gray-600">
            Aggregated view of customer receivables from canonical invoices and payments.
          </p>
        </div>
      </div>

      {!multiCurrencyPlanRequired && <Card>
        <div className="flex flex-wrap items-end gap-4">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
              checked={overdueOnly}
              onChange={(event) => setOverdueOnly(event.target.checked)}
            />
            Overdue only
          </label>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <span>Sort</span>
            <select
              value={sortOption}
              onChange={(event) => setSortOption(event.target.value as `${SortBy}:${SortDir}`)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <Button onClick={() => void loadRows(true)} variant="secondary" size="md" disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </Card>}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && !multiCurrencyPlanRequired && (
        <p className="text-sm text-gray-600">{description}</p>
      )}

      {multiCurrencyPlanRequired && <MultiCurrencyPlanGate />}

      {!error &&
        !multiCurrencyPlanRequired &&
        !loading &&
        currencyHealth?.status === 'unavailable' && (
        <Card>
          <h2 className="text-lg font-semibold text-gray-900">Currency data needs refreshing</h2>
          <p className="mt-1 text-sm text-gray-600">
            A reliable collections summary cannot be calculated until the Xero organisation
            currency data is refreshed or inspected.
          </p>
          <p className="mt-2 text-sm text-gray-700">
            Affected invoices: {currencyHealth.affectedInvoiceCount} · Affected customers:{' '}
            {currencyHealth.affectedCustomerCount}
          </p>
          {Object.keys(currencyHealth.failureReasons).length > 0 && (
            <p className="mt-1 text-xs text-gray-500">
              Reasons:{' '}
              {Object.entries(currencyHealth.failureReasons)
                .map(([reason, count]) => `${reason.replaceAll('_', ' ')} (${count})`)
                .join(', ')}
            </p>
          )}
        </Card>
      )}

      {!error &&
        !multiCurrencyPlanRequired &&
        !loading &&
        currencyHealth?.status === 'degraded' && (
        <Card>
          <h2 className="text-lg font-semibold text-gray-900">Ranking uses available currency data</h2>
          <p className="mt-1 text-sm text-gray-600">
            Some invoice currency data could not be converted. We have ranked the remaining
            customers using safely valued data, and marked affected customers for review. The
            displayed totals exclude those affected customers and are provisional.
          </p>
          <p className="mt-2 text-sm text-gray-700">
            Affected invoices: {currencyHealth.affectedInvoiceCount} · Affected customers:{' '}
            {currencyHealth.affectedCustomerCount}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Refresh Xero data or contact support if the issue remains.
          </p>
        </Card>
      )}

      {!error &&
        !multiCurrencyPlanRequired &&
        !loading &&
        reviewRequiredCustomers.length > 0 && (
        <Card>
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Needs review</h2>
              <p className="mt-1 text-sm text-gray-600">
                These customers are not scored because at least one open invoice cannot be valued
                reliably in the organisation base currency.
              </p>
            </div>
            <div className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
              {reviewRequiredCustomers.map((customer) => (
                <div key={customer.customer_source_id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-gray-900">{customer.customer_name}</p>
                      <p className="text-xs text-gray-600">
                        {customer.customer_email || 'No email recorded'}
                      </p>
                    </div>
                    <p className="text-xs font-medium text-amber-800">
                      {customer.affected_invoice_count} affected invoice
                      {customer.affected_invoice_count === 1 ? '' : 's'}
                    </p>
                  </div>
                  {customer.native_currency_breakdown.length > 0 && (
                    <p className="mt-2 text-xs text-gray-600">
                      Invoiced outstanding:{' '}
                      {customer.native_currency_breakdown
                        .map((entry) =>
                          formatInvoicedAmount(entry.total_outstanding_native, entry.currency_code)
                        )
                        .join(' · ')}
                    </p>
                  )}
                  {Object.keys(customer.failure_reasons).length > 0 && (
                    <p className="mt-1 text-xs text-gray-500">
                      Reasons:{' '}
                      {Object.entries(customer.failure_reasons)
                        .map(
                          ([reason, count]) =>
                            `${formatCurrencyFailureReason(reason)} (${count})`
                        )
                        .join(', ')}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-gray-500">
                    Refresh Xero data or contact support before deciding priority.
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {!error &&
        !multiCurrencyPlanRequired &&
        !loading &&
        currencyHealth?.status !== 'unavailable' &&
        rows.length > 0 && (
        <div className="space-y-3">
          <div className="grid gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-600">
                {showMultiCurrencyAmounts ? 'Equivalent outstanding total' : 'Outstanding total'}
              </p>
              <p className="mt-1 font-semibold text-gray-900">
                {formatMoney(totals.outstandingBase, organisationBaseCurrency)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-600">
                {showMultiCurrencyAmounts
                  ? 'Equivalent overdue total'
                  : 'Overdue outstanding total'}
              </p>
              <p className="mt-1 font-semibold text-gray-900">
                {formatMoney(totals.overdueOutstandingBase, organisationBaseCurrency)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-600">Overdue invoices total</p>
              <p className="mt-1 font-semibold text-gray-900">{totals.overdueInvoicesCount}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-600">Oldest overdue days total</p>
              <p className="mt-1 font-semibold text-gray-900">{totals.oldestOverdueDaysSum}</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-gray-700">
              <tr>
                <th className="px-4 py-3 font-medium">Customer name</th>
                <th className="px-4 py-3 font-medium">Outstanding</th>
                <th className="px-4 py-3 font-medium">Overdue outstanding</th>
                <th className="px-4 py-3 font-medium">Overdue invoices</th>
                <th className="px-4 py-3 font-medium">Oldest overdue (days)</th>
                <th className="px-4 py-3 font-medium">Last payment date</th>
                <th className="px-4 py-3 font-medium">Payment behaviour</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-800">
              {rows.map((row) => (
                <tr key={row.customer_source_id}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{row.customer_name}</p>
                    <p className="text-xs text-gray-600">{row.customer_email || '—'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p>
                      {formatMoney(row.total_outstanding_base, organisationBaseCurrency)}
                      {showMultiCurrencyAmounts ? ' equivalent' : ''}
                    </p>
                    {showMultiCurrencyAmounts &&
                      formatInvoicedBreakdown(
                        row.native_currency_breakdown,
                        'total_outstanding_native'
                      ) && (
                        <p className="mt-0.5 text-xs text-gray-500">
                          {formatInvoicedBreakdown(
                            row.native_currency_breakdown,
                            'total_outstanding_native'
                          )}{' '}
                          invoiced
                        </p>
                      )}
                  </td>
                  <td className="px-4 py-3">
                    <p>
                      {formatMoney(row.overdue_outstanding_base, organisationBaseCurrency)}
                      {showMultiCurrencyAmounts ? ' equivalent overdue' : ''}
                    </p>
                    {showMultiCurrencyAmounts &&
                      formatInvoicedBreakdown(
                        row.native_currency_breakdown,
                        'overdue_outstanding_native'
                      ) && (
                        <p className="mt-0.5 text-xs text-gray-500">
                          {formatInvoicedBreakdown(
                            row.native_currency_breakdown,
                            'overdue_outstanding_native'
                          )}{' '}
                          invoiced
                        </p>
                      )}
                  </td>
                  <td className="px-4 py-3">{row.overdue_invoices_count}</td>
                  <td className="px-4 py-3">{row.oldest_overdue_days ?? '—'}</td>
                  <td className="px-4 py-3">{formatDate(row.last_payment_date)}</td>
                  <td className="min-w-64 px-4 py-3">
                    <dl className="space-y-1 text-xs text-gray-600">
                      <div>
                        <dt className="inline font-medium text-gray-700">Typical payment timing: </dt>
                        <dd className="inline">
                          {formatHistoricalPaymentTiming(row.historical_normal_days_late)}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-gray-700">Historical invoices: </dt>
                        <dd className="inline">{row.historical_paid_invoice_count}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-gray-700">Current overdue age: </dt>
                        <dd className="inline">
                          {formatCurrentOverdueAge(row.weighted_avg_overdue_days)}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-gray-700">Versus normal: </dt>
                        <dd className="inline">
                          {formatRelativeLateness(row.relative_lateness_days)}
                        </dd>
                      </div>
                    </dl>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getStatusBadgeClasses(row)}`}
                    >
                      {getStatusLabel(row)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
