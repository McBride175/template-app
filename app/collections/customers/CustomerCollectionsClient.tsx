'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Card from '@/app/components/Card'
import Button from '@/app/components/Button'

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
  total_outstanding: number
  overdue_outstanding: number
  oldest_overdue_invoice_date: string | null
  oldest_overdue_days: number | null
  latest_invoice_date: string | null
  latest_due_date: string | null
  last_payment_date: string | null
  currency_code: string | null
}

interface CollectionsApiResponse {
  ok?: boolean
  rows?: CustomerCollectionsSummaryRow[]
  tenantId?: string | null
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

function formatCurrencyTotalsByCode(totalsByCurrency: Map<string, number>) {
  const visibleBuckets = Array.from(totalsByCurrency.entries())
    .filter(([, amount]) => Math.abs(amount) > Number.EPSILON)

  if (visibleBuckets.length === 0) {
    return formatMoney(0, null)
  }

  return visibleBuckets
    .sort(([leftCode], [rightCode]) => leftCode.localeCompare(rightCode))
    .map(([currencyCode, amount]) => formatMoney(amount, currencyCode))
    .join(' · ')
}

function getStatusLabel(row: CustomerCollectionsSummaryRow) {
  if (row.status?.trim()) return row.status
  if (row.is_customer === true) return 'customer'
  if (row.is_supplier === true) return 'supplier'
  return 'contact'
}

function getStatusBadgeClasses(row: CustomerCollectionsSummaryRow) {
  if (row.overdue_outstanding > 0) {
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

        if (response.status === 402) {
          router.push('/pricing?reason=usage-limit')
          return
        }

        const payload = (await response.json().catch(() => null)) as CollectionsApiResponse | null
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || 'Failed to load customer collections summary.')
        }

        setRows(payload.rows ?? [])
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

  const description = useMemo(() => {
    if (loading) return 'Loading customer aggregation…'
    if (rows.length === 0) return 'No customer rows matched the current filters.'
    return `${rows.length} customer${rows.length === 1 ? '' : 's'} shown`
  }, [loading, rows.length])

  const totals = useMemo(() => {
    const outstandingByCurrency = new Map<string, number>()
    const overdueOutstandingByCurrency = new Map<string, number>()

    let overdueInvoicesCount = 0
    let oldestOverdueDaysSum = 0

    for (const row of rows) {
      const currencyCode = row.currency_code?.trim() || null

      if (currencyCode || Math.abs(row.total_outstanding) > Number.EPSILON) {
        const outstandingCurrencyCode = currencyCode ?? 'UNK'
        outstandingByCurrency.set(
          outstandingCurrencyCode,
          (outstandingByCurrency.get(outstandingCurrencyCode) ?? 0) + row.total_outstanding
        )
      }

      if (currencyCode || Math.abs(row.overdue_outstanding) > Number.EPSILON) {
        const overdueCurrencyCode = currencyCode ?? 'UNK'
        overdueOutstandingByCurrency.set(
          overdueCurrencyCode,
          (overdueOutstandingByCurrency.get(overdueCurrencyCode) ?? 0) + row.overdue_outstanding
        )
      }

      overdueInvoicesCount += row.overdue_invoices_count
      oldestOverdueDaysSum += row.oldest_overdue_days ?? 0
    }

    return {
      outstandingByCurrency,
      overdueOutstandingByCurrency,
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

      <Card>
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
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && <p className="text-sm text-gray-600">{description}</p>}

      {!error && !loading && rows.length > 0 && (
        <div className="space-y-3">
          <div className="grid gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-600">Outstanding total</p>
              <p className="mt-1 font-semibold text-gray-900">
                {formatCurrencyTotalsByCode(totals.outstandingByCurrency)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-600">Overdue outstanding total</p>
              <p className="mt-1 font-semibold text-gray-900">
                {formatCurrencyTotalsByCode(totals.overdueOutstandingByCurrency)}
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
                    {formatMoney(row.total_outstanding, row.currency_code)}
                  </td>
                  <td className="px-4 py-3">
                    {formatMoney(row.overdue_outstanding, row.currency_code)}
                  </td>
                  <td className="px-4 py-3">{row.overdue_invoices_count}</td>
                  <td className="px-4 py-3">{row.oldest_overdue_days ?? '—'}</td>
                  <td className="px-4 py-3">{formatDate(row.last_payment_date)}</td>
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
