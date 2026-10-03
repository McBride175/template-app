'use client'

import type { FinancialMutationReconciliation } from '@/lib/collections/financial-mutation-reconciliation-server'
import { shouldApplyCustomerFinancialResponse, type CustomerFinancialStamp } from '@/lib/collections/financial-mutation-response'
import { notifyPromiseActionabilityChanged } from '@/lib/collections/promise-refresh'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Card from '@/app/components/ui/Card'
import Button from '@/app/components/ui/Button'
import { InvoiceDisputeList } from '@/app/collections/customers/CustomerInvoiceDisputes'
import type { InvoiceDisputeView } from '@/lib/collections/invoice-dispute-view'
import MultiCurrencyPlanGate from '@/app/collections/MultiCurrencyPlanGate'
import {
  formatCurrentOverdueAge,
  formatHistoricalPaymentTiming,
  formatRelativeLateness,
} from '@/lib/collections/payment-behavior-copy'
import { buildLoginPath } from '@/lib/auth-flow'
import { customerHistoryUrl } from '@/lib/collections/customer-history-url'
import {
  FOUNDER_CONTEXT_OPTIONS,
  type FounderContextLevel,
} from '@/lib/collections/founder-context'

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
  total_outstanding_base_decimal: string | null
  overdue_outstanding_base_decimal: string | null
  total_outstanding_base: number | null
  overdue_outstanding_base: number | null
  collectible_outstanding_base: number
  collectible_overdue_base: number
  customer_to_chase_overdue_base: number
  customer_credit_applied_base: number
  effective_disputed_outstanding_base_decimal: string | null
  effective_disputed_overdue_base_decimal: string | null
  has_active_dispute: boolean
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
  collectible_native_currency_breakdown: Array<{
    currency_code: string
    effective_disputed_outstanding_native: string
    effective_disputed_overdue_native: string
    collectible_outstanding_native: string
    collectible_overdue_native: string
  }>
  override_level: FounderContextLevel
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

interface CustomerDetailResponse extends CollectionsApiResponse {
  customerSourceId?: string
  row?: CustomerCollectionsSummaryRow | null
  reviewRequiredCustomer?: CurrencyReviewRequiredCustomer | null
  invoices?: InvoiceDisputeView[]
  version?: { generationId: string | null; financialEpoch?: string; customerRevision?: string;
    projectionRevision?: string; evaluationDate?: string }
}

interface CollectionOverrideApiResponse {
  ok?: boolean
  code?: string
  error?: string
}

interface CustomerCollectionsClientProps {
  tenantId?: string | null
  initialCustomerSourceId?: string | null
}

const SORT_OPTIONS: Array<{
  value: `${SortBy}:${SortDir}`
  label: string
}> = [
  { value: 'overdue_outstanding:desc', label: 'Gross overdue (high to low)' },
  { value: 'overdue_outstanding:asc', label: 'Gross overdue (low to high)' },
  { value: 'total_outstanding:desc', label: 'Gross outstanding (high to low)' },
  { value: 'total_outstanding:asc', label: 'Gross outstanding (low to high)' },
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

function formatMoney(amount: number | null, currencyCode: string | null) {
  if (amount === null) return 'Base amount unavailable'
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
  if (row.overdue_invoices_count > 0) {
    return 'bg-amber-100 text-amber-800'
  }
  return 'bg-gray-100 text-gray-700'
}

export default function CustomerCollectionsClient({ tenantId = null, initialCustomerSourceId = null }: CustomerCollectionsClientProps) {
  const router = useRouter()
  const loginNextPath = tenantId
    ? `/customers?tenantId=${encodeURIComponent(tenantId)}`
    : '/customers'
  const [rows, setRows] = useState<CustomerCollectionsSummaryRow[]>([])
  const [resolvedTenantId, setResolvedTenantId] = useState<string | null>(tenantId)
  const [expandedCustomerSourceId, setExpandedCustomerSourceId] = useState<string | null>(initialCustomerSourceId)
  const [detail, setDetail] = useState<CustomerDetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(Boolean(initialCustomerSourceId))
  const [detailError, setDetailError] = useState<string | null>(null)
  const selectedCustomerRef = useRef(expandedCustomerSourceId)
  selectedCustomerRef.current = expandedCustomerSourceId
  const mutationSequence = useRef(0)
  const latestReadyMutationSequence = useRef(0)
  const financialStamps = useRef(new Map<string, CustomerFinancialStamp>())
  const detailRequestId = useRef(0)
  const detailAbort = useRef<AbortController | null>(null)
  const listPatches = useRef(new Map<string, { throughRequest: number; row: CustomerCollectionsSummaryRow | null }>())
  const listRequestId = useRef(0)
  const listAbort = useRef<AbortController | null>(null)
  const invoiceSectionRef = useRef<HTMLElement | null>(null)
  const pendingDetailScrollId = useRef<string | null>(initialCustomerSourceId)
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [sortOption, setSortOption] =
    useState<`${SortBy}:${SortDir}`>('overdue_outstanding:desc')
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [disputeRefreshState, setDisputeRefreshState] = useState<{
    stale: boolean
    message: string
  } | null>(null)
  const [contextError, setContextError] = useState<string | null>(null)
  const [contextFeedback, setContextFeedback] = useState<string | null>(null)
  const [updatingContextByCustomerId, setUpdatingContextByCustomerId] = useState<
    Record<string, boolean>
  >({})
  const contextRequestsInFlight = useRef(new Set<string>())
  const [organisationBaseCurrency, setOrganisationBaseCurrency] = useState<string | null>(null)
  const [currencyContext, setCurrencyContext] = useState<CollectionsCurrencyContext | null>(null)
  const [currencyAccess, setCurrencyAccess] = useState<CollectionsCurrencyAccess | null>(null)
  const [currencyHealth, setCurrencyHealth] = useState<CollectionsCurrencyHealth | null>(null)
  const [reviewRequiredCustomers, setReviewRequiredCustomers] = useState<
    CurrencyReviewRequiredCustomer[]
  >([])

  const loadRows = useCallback(
    async (manualRefresh: boolean) => {
      const requestId = ++listRequestId.current
      listAbort.current?.abort()
      const controller = new AbortController()
      listAbort.current = controller
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
          signal: controller.signal,
        })
        if (requestId !== listRequestId.current) return false

        if (response.status === 401) {
          router.replace(buildLoginPath(loginNextPath, 'session_expired'))
          return false
        }

        const payload = (await response.json().catch(() => null)) as CollectionsApiResponse | null
        if (requestId !== listRequestId.current) return false

        if (response.status === 402 && payload?.code === 'MULTI_CURRENCY_REQUIRES_PRO') {
          setRows([])
          setOrganisationBaseCurrency(null)
          setCurrencyContext(payload.currencyContext ?? null)
          setCurrencyAccess(payload.currencyAccess ?? null)
          setCurrencyHealth(null)
          setReviewRequiredCustomers([])
          return false
        }

        if (response.status === 402) {
          router.push('/pricing?reason=usage-limit')
          return false
        }

        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || 'Failed to load customer collections summary.')
        }

        setRows((payload.rows ?? []).flatMap(row => {
          const patch = listPatches.current.get(row.customer_source_id)
          return patch && requestId <= patch.throughRequest ? (patch.row ? [patch.row] : []) : [row]
        }))
        setResolvedTenantId(payload.tenantId ?? null)
        setOrganisationBaseCurrency(payload.organisationBaseCurrency ?? null)
        setCurrencyContext(payload.currencyContext ?? null)
        setCurrencyAccess(payload.currencyAccess ?? null)
        setCurrencyHealth(payload.currencyHealth ?? null)
        setReviewRequiredCustomers(payload.reviewRequiredCustomers ?? [])
        return true
      } catch (fetchError) {
        if (controller.signal.aborted || requestId !== listRequestId.current) return false
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : 'Failed to load customer collections summary.'
        )
        return false
      } finally {
        if (requestId === listRequestId.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [loginNextPath, overdueOnly, router, sortOption, tenantId]
  )

  const loadDetail = useCallback(async (customerSourceId: string): Promise<boolean> => {
    const requestId = ++detailRequestId.current
    detailAbort.current?.abort()
    const controller = new AbortController()
    detailAbort.current = controller
    setDetailLoading(true)
    setDetailError(null)
    try {
      const params = new URLSearchParams({ customerSourceId })
      if (tenantId) params.set('tenantId', tenantId)
      const response = await fetch(`/api/collections/customer-detail?${params}`, {
        credentials: 'include', cache: 'no-store', signal: controller.signal,
      })
      if (requestId !== detailRequestId.current) return false
      if (response.status === 401) {
        router.replace(buildLoginPath(loginNextPath, 'session_expired'))
        return false
      }
      const payload = await response.json().catch(() => null) as CustomerDetailResponse | null
      if (requestId !== detailRequestId.current) return false
      if (!response.ok || !payload?.ok || payload.tenantId === undefined ||
        payload.customerSourceId !== customerSourceId) {
        throw new Error(payload?.error || 'Could not load customer detail.')
      }
      if (payload.version?.financialEpoch && payload.version.customerRevision && payload.version.projectionRevision && payload.version.evaluationDate && payload.version.generationId) {
        const stamp = payload.version as CustomerFinancialStamp
        if (!shouldApplyCustomerFinancialResponse(financialStamps.current.get(customerSourceId) ?? null, stamp)) return false
        financialStamps.current.set(customerSourceId, stamp)
      }
      setResolvedTenantId(payload.tenantId ?? null)
      setDetail(payload)
      return true
    } catch (cause) {
      if (controller.signal.aborted || requestId !== detailRequestId.current) return false
      setDetail(null)
      setDetailError(cause instanceof Error ? cause.message : 'Could not load customer detail.')
      return false
    } finally {
      if (requestId === detailRequestId.current) setDetailLoading(false)
    }
  }, [tenantId, router, loginNextPath])

  useEffect(() => {
    if (!expandedCustomerSourceId) {
      detailAbort.current?.abort()
      detailRequestId.current++
      setDetail(null)
      setDetailLoading(false)
      return
    }
    void loadDetail(expandedCustomerSourceId)
    return () => { detailAbort.current?.abort() }
  }, [expandedCustomerSourceId, loadDetail])

  useEffect(() => {
    const onHistory = () => {
      const selected = new URL(window.location.href).searchParams.get('customerSourceId')?.trim() || null
      pendingDetailScrollId.current = selected
      setExpandedCustomerSourceId(selected)
    }
    window.addEventListener('popstate', onHistory)
    return () => window.removeEventListener('popstate', onHistory)
  }, [])

  useEffect(() => {
    pendingDetailScrollId.current = initialCustomerSourceId
    setExpandedCustomerSourceId(initialCustomerSourceId)
  }, [initialCustomerSourceId])

  const selectCustomer = useCallback((customerSourceId: string) => {
    const next = expandedCustomerSourceId === customerSourceId ? null : customerSourceId
    const url = new URL(window.location.href)
    if (next) url.searchParams.set('customerSourceId', next)
    else url.searchParams.delete('customerSourceId')
    window.history.pushState({}, '', url)
    pendingDetailScrollId.current = next
    setExpandedCustomerSourceId(next)
    setDetail(null)
    setDetailLoading(Boolean(next))
  }, [expandedCustomerSourceId])

  const applyReconciliation = useCallback(async (result: FinancialMutationReconciliation, sequence?: number) => {
    if (result.tenantId !== resolvedTenantId || result.customerSourceId !== selectedCustomerRef.current) return false
    if (!result.reconciliationReady) {
      if (sequence !== undefined && sequence < latestReadyMutationSequence.current) return true
      setDisputeRefreshState({ stale: true, message: 'The change was saved. Current financial details are not ready; refresh the details before making another change.' })
      return false
    }
    const previous = financialStamps.current.get(result.customerSourceId) ?? null
    if (!shouldApplyCustomerFinancialResponse(previous, result.version)) return true // A newer result already won.
    latestReadyMutationSequence.current = Math.max(latestReadyMutationSequence.current, sequence ?? 0)
    financialStamps.current.set(result.customerSourceId, result.version)
    detailAbort.current?.abort()
    detailRequestId.current++
    listPatches.current.set(result.customerSourceId, { throughRequest: listRequestId.current, row: result.detail.row })
    setDetailLoading(false)
    setDetailError(null)
    setDetail({ ok: true, ...result.detail, tenantId: result.tenantId, customerSourceId: result.customerSourceId })
    // Financial operational edits do not alter the list's gross balances, ages,
    // identity search or gross overdue filter. Replace the existing row in place.
    setRows(previousRows => previousRows.flatMap(row => row.customer_source_id === result.customerSourceId
      ? result.detail.row ? [result.detail.row] : [] : [row]))
    setReviewRequiredCustomers(previousReviews => [...previousReviews.filter(row => row.customer_source_id !== result.customerSourceId),
      ...(result.detail.reviewRequiredCustomer ? [result.detail.reviewRequiredCustomer] : [])])
    setDisputeRefreshState(null)
    if (!result.detail.row || result.detail.reviewRequiredCustomer ||
      (detail?.customerSourceId === result.customerSourceId && Boolean(detail.row) !== Boolean(result.detail.row)) ||
      (previous && previous.generationId !== result.version.generationId)) void loadRows(true)
    if (!previous || previous.financialEpoch !== result.version.financialEpoch) {
      notifyPromiseActionabilityChanged(result.tenantId, result)
    }
    return true
  }, [resolvedTenantId, loadRows, detail])

  const recoverDetail = useCallback(async (customerSourceId: string) => {
    if (!resolvedTenantId) return false
    try {
      const params = new URLSearchParams({ tenantId: resolvedTenantId, customerSourceId })
      const response = await fetch(`/api/collections/financial-reconciliation?${params}`, { cache: 'no-store', credentials: 'include' })
      const body = await response.json() as { ok?: boolean; reconciliation?: FinancialMutationReconciliation }
      if (response.ok && body.ok && body.reconciliation?.reconciliationReady) return applyReconciliation(body.reconciliation)
      if (body.reconciliation?.reconciliationReady !== false || body.reconciliation.reason !== 'schema') return false
      // Staged schema absence retains the existing authoritative detail read.
      // This is explicit recovery only, never a normal successful-save waterfall.
      const fresh = await loadDetail(customerSourceId)
      if (fresh) setDisputeRefreshState(null)
      return fresh
    } catch { return false }
  }, [resolvedTenantId, applyReconciliation, loadDetail])

  useEffect(() => {
    void loadRows(false)
  }, [loadRows])

  useEffect(() => {
    if (!expandedCustomerSourceId || detailLoading ||
      detail?.customerSourceId !== expandedCustomerSourceId ||
      pendingDetailScrollId.current !== expandedCustomerSourceId || !invoiceSectionRef.current) return
    pendingDetailScrollId.current = null
    invoiceSectionRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [expandedCustomerSourceId, detailLoading, detail])

  const handleFounderContextChange = useCallback(
    async (
      row: CustomerCollectionsSummaryRow,
      overrideLevel: FounderContextLevel
    ) => {
      if (overrideLevel === row.override_level) return
      if (contextRequestsInFlight.current.has(row.customer_source_id)) return

      if (overrideLevel === 'do_not_chase') {
        const confirmed = window.confirm(
          `Never chase removes ${row.customer_name} from the chase queue until you change the setting. Do not follow up until is a temporary date on a recorded outcome. Continue?`
        )
        if (!confirmed) return
      }

      contextRequestsInFlight.current.add(row.customer_source_id)

      setUpdatingContextByCustomerId((current) => ({
        ...current,
        [row.customer_source_id]: true,
      }))
      setContextError(null)
      setContextFeedback(null)

      try {
        const response = await fetch('/api/collections/override', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            customer_source_id: row.customer_source_id,
            override_level: overrideLevel,
            tenant_id: tenantId,
          }),
        })

        if (response.status === 401) {
          router.replace(buildLoginPath(loginNextPath, 'session_expired'))
          return
        }

        const payload = (await response.json().catch(() => null)) as
          | CollectionOverrideApiResponse
          | null

        if (response.status === 402) {
          router.push(
            payload?.code === 'MULTI_CURRENCY_REQUIRES_PRO'
              ? '/pricing?reason=multi-currency'
              : '/pricing?reason=usage-limit'
          )
          return
        }

        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || 'Failed to save customer context.')
        }

        const refreshed = await loadRows(true)
        if (!refreshed) {
          setContextError(
            'Customer context was saved, but the current list could not be refreshed. Try Refresh.'
          )
          return
        }

        const label =
          FOUNDER_CONTEXT_OPTIONS.find((option) => option.value === overrideLevel)?.label ??
          'Customer context'
        setContextFeedback(
          overrideLevel === 'normal'
            ? `${row.customer_name} returned to Normal. Yuohme will use the accounting data alone.`
            : `${row.customer_name} marked ${label}. Today’s queue will use this context.`
        )
      } catch (updateError) {
        setContextError(
          updateError instanceof Error
            ? updateError.message
            : 'Failed to save customer context.'
        )
      } finally {
        contextRequestsInFlight.current.delete(row.customer_source_id)
        setUpdatingContextByCustomerId((current) => {
          const next = { ...current }
          delete next[row.customer_source_id]
          return next
        })
      }
    },
    [loadRows, loginNextPath, router, tenantId]
  )

  const multiCurrencyPlanRequired = Boolean(
    currencyAccess?.requiresPro && !currencyAccess.allowed
  )
  const showMultiCurrencyAmounts = Boolean(
    currencyAccess?.allowed && currencyContext?.mode === 'multi_currency'
  )

  const visibleRows = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase()
    if (!normalizedQuery) return rows

    return rows.filter((row) =>
      `${row.customer_name} ${row.customer_email ?? ''}`
        .toLocaleLowerCase()
        .includes(normalizedQuery)
    )
  }, [rows, searchQuery])

  const description = useMemo(() => {
    if (loading) return 'Loading customer aggregation…'
    if (currencyHealth?.status === 'unavailable') return 'Collections ranking is unavailable.'
    if (currencyHealth?.status === 'degraded' && rows.length === 0) {
      return `No safely valued customers shown · ${reviewRequiredCustomers.length} need review`
    }
    if (visibleRows.length === 0) return 'No customer rows matched the current filters.'
    const rankedDescription = `${visibleRows.length} customer${visibleRows.length === 1 ? '' : 's'} shown`
    if (currencyHealth?.status !== 'degraded') return rankedDescription
    return `${rankedDescription} · ${reviewRequiredCustomers.length} need review`
  }, [currencyHealth?.status, loading, reviewRequiredCustomers.length, rows.length, visibleRows.length])

  const totals = useMemo(() => {
    let outstandingBase: number | null = 0
    let overdueOutstandingBase: number | null = 0
    let overdueInvoicesCount = 0
    let oldestOverdueDaysSum = 0

    for (const row of visibleRows) {
      if (row.total_outstanding_base === null) outstandingBase = null
      else if (outstandingBase !== null) outstandingBase += row.total_outstanding_base
      if (row.overdue_outstanding_base === null) overdueOutstandingBase = null
      else if (overdueOutstandingBase !== null) overdueOutstandingBase += row.overdue_outstanding_base
      overdueInvoicesCount += row.overdue_invoices_count
      oldestOverdueDaysSum += row.oldest_overdue_days ?? 0
    }

    return {
      outstandingBase,
      overdueOutstandingBase,
      overdueInvoicesCount,
      oldestOverdueDaysSum,
    }
  }, [visibleRows])

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

      {expandedCustomerSourceId && (
        <section ref={(element) => { invoiceSectionRef.current = element }}
          aria-label="Selected customer detail" className="scroll-mt-6 space-y-3">
          <div className="flex justify-end">
            <Button variant="secondary" size="md" onClick={() => selectCustomer(expandedCustomerSourceId)}>
              Hide invoices
            </Button>
          </div>
          {detailLoading && <Card><p className="text-sm text-gray-600">Loading selected customer and invoices…</p></Card>}
          {detailError && !detailLoading && <Card>
            <p role="alert" className="text-sm text-red-700">{detailError}</p>
            <Button variant="secondary" size="md" onClick={() => void loadDetail(expandedCustomerSourceId)}>Retry customer detail</Button>
          </Card>}
          {detail && detail.customerSourceId === expandedCustomerSourceId && (
            <Card>
              <div className="mb-3">
                <h2 className="text-lg font-semibold text-gray-900">
                  {detail.row?.customer_name ?? detail.reviewRequiredCustomer?.customer_name ?? 'Customer'}
                </h2>
                {detail.row && <p className="text-sm text-gray-700">
                  {formatMoney(detail.row.total_outstanding_base, detail.organisationBaseCurrency ?? null)} gross outstanding
                  {' · '}{formatMoney(detail.row.overdue_outstanding_base, detail.organisationBaseCurrency ?? null)} gross overdue
                  {' · '}{formatMoney(detail.row.customer_to_chase_overdue_base, detail.organisationBaseCurrency ?? null)} to chase
                </p>}
                {detail.tenantId && <Link href={customerHistoryUrl(expandedCustomerSourceId, detail.tenantId)}
                  className="mt-2 inline-flex min-h-11 items-center rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-900">
                  View history
                </Link>}
              </div>
              {(detail.currencyHealth?.status === 'unavailable' || !detail.organisationBaseCurrency) ?
                <p className="text-sm text-gray-700">Customer amounts are unavailable until currency data is ready.</p> :
              <InvoiceDisputeList key={expandedCustomerSourceId} tenantId={detail.tenantId!} customerSourceId={expandedCustomerSourceId}
                customerName={detail.row?.customer_name ?? detail.reviewRequiredCustomer?.customer_name ?? 'Customer'}
                invoices={detail.invoices ?? []} loading={false}
                reload={() => recoverDetail(expandedCustomerSourceId)}
                onPromiseRefresh={() => recoverDetail(expandedCustomerSourceId)}
                onReconciled={applyReconciliation}
                onChanged={async () => true}
                onMutationStarted={() => { setDisputeRefreshState(null); return ++mutationSequence.current }}
                onMutationPending={(message) => setDisputeRefreshState({ stale: true, message })}
                onMutationResult={(refreshed, message) => setDisputeRefreshState({ stale: !refreshed, message })}
                disabled={detailLoading || Boolean(disputeRefreshState?.stale)} />}
            </Card>
          )}
        </section>
      )}

      {!multiCurrencyPlanRequired && (
        <Card>
          <div id="customer-context" className="scroll-mt-6">
            <h2 className="text-lg font-semibold text-gray-900">Customer context</h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-gray-600">
              Yuohme ranks customers from Xero first. If you know something the accounting data
              cannot show, you can optionally set Priority, Safe, or Never chase here. Normal is
              the default and needs no action.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-gray-500">
              Customer context stays in place until you change it. Use a dated outcome or invoice promise,
              or an action log for temporary collection workflow.
            </p>
          </div>
        </Card>
      )}

      {!multiCurrencyPlanRequired && <Card>
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm text-gray-700">
            <span>Find a customer</span>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search name or email"
              className="min-h-11 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </label>

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

          <Button onClick={() => disputeRefreshState?.stale
            ? expandedCustomerSourceId && void recoverDetail(expandedCustomerSourceId) : void loadRows(true)} variant="secondary" size="md" disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </Card>}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {disputeRefreshState && (
        <p role={disputeRefreshState.stale ? 'alert' : 'status'}
          className={disputeRefreshState.stale ? 'text-sm text-amber-900' : 'text-sm text-green-700'}>
          {disputeRefreshState.message}
          {disputeRefreshState.stale && (
            <button type="button" className="ml-2 underline" onClick={() => expandedCustomerSourceId && void recoverDetail(expandedCustomerSourceId)}>
              Refresh page
            </button>
          )}
        </p>
      )}
      {contextError && (
        <p className="text-sm text-red-600" role="alert">
          {contextError}
        </p>
      )}
      {contextFeedback && (
        <p className="text-sm text-green-700" role="status" aria-live="polite">
          {contextFeedback}
        </p>
      )}
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

      {!error && !disputeRefreshState?.stale &&
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
                  {resolvedTenantId && (
                    <div className="mt-2">
                      <Link href={customerHistoryUrl(customer.customer_source_id, resolvedTenantId)}
                        className="mr-2 inline-flex min-h-11 items-center rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-900">
                        View history
                      </Link>
                      <button type="button" className="min-h-11 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-900"
                        aria-expanded={expandedCustomerSourceId === customer.customer_source_id}
                        onClick={() => selectCustomer(customer.customer_source_id)}>
                        {expandedCustomerSourceId === customer.customer_source_id ? 'Hide invoices' : 'Manage invoices'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {!error && !disputeRefreshState?.stale &&
        !multiCurrencyPlanRequired &&
        !loading &&
        currencyHealth?.status !== 'unavailable' &&
        visibleRows.length > 0 && (
        <div className="space-y-3">
          <div className="grid gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-600">
                {showMultiCurrencyAmounts ? 'Gross equivalent outstanding total' : 'Gross outstanding total'}
              </p>
              <p className="mt-1 font-semibold text-gray-900">
                {formatMoney(totals.outstandingBase, organisationBaseCurrency)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-600">
                {showMultiCurrencyAmounts
                  ? 'Gross equivalent overdue total'
                  : 'Gross overdue total'}
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
                <th className="px-4 py-3 font-medium">Gross outstanding</th>
                <th className="px-4 py-3 font-medium">Gross overdue</th>
                <th className="px-4 py-3 font-medium">Overdue invoices</th>
                <th className="px-4 py-3 font-medium">Oldest actionable overdue (days)</th>
                <th className="px-4 py-3 font-medium">Last payment date</th>
                <th className="px-4 py-3 font-medium">Payment behaviour</th>
                <th className="px-4 py-3 font-medium">Customer context</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Invoices</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-800">
              {visibleRows.map((row) => (
                <Fragment key={row.customer_source_id}>
                <tr>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{row.customer_name}</p>
                    <p className="text-xs text-gray-600">{row.customer_email || '—'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p>
                      {formatMoney(row.total_outstanding_base, organisationBaseCurrency)}
                      {showMultiCurrencyAmounts && row.total_outstanding_base !== null ? ' equivalent' : ''}
                    </p>
                    {(showMultiCurrencyAmounts || row.total_outstanding_base === null) &&
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
                    {row.has_active_dispute && (
                      <p className="mt-0.5 text-xs text-gray-600">
                        Disputed: {row.effective_disputed_outstanding_base_decimal === null
                          ? 'Base amount unavailable'
                          : formatMoney(Number(row.effective_disputed_outstanding_base_decimal), organisationBaseCurrency)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p>
                      {formatMoney(row.overdue_outstanding_base, organisationBaseCurrency)}
                      {showMultiCurrencyAmounts && row.overdue_outstanding_base !== null ? ' equivalent overdue' : ''}
                    </p>
                    {(showMultiCurrencyAmounts || row.overdue_outstanding_base === null) &&
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
                    {(row.customer_to_chase_overdue_base > 0 || row.customer_credit_applied_base > 0) &&
                      (row.overdue_outstanding_base === null ||
                        row.customer_to_chase_overdue_base !== row.overdue_outstanding_base) && (
                        <p className="mt-0.5 text-xs text-gray-600">
                          {row.customer_to_chase_overdue_base > 0
                            ? `${formatMoney(row.customer_to_chase_overdue_base, organisationBaseCurrency)} to chase`
                            : 'No overdue amount to chase'}
                        </p>
                      )}
                    {row.customer_credit_applied_base > 0 && (
                      <p className="mt-0.5 text-xs text-gray-500">
                        {formatMoney(row.customer_credit_applied_base, organisationBaseCurrency)} Xero credit deducted
                      </p>
                    )}
                    {row.has_active_dispute && (
                      <p className="mt-0.5 text-xs text-gray-600">
                        Disputed: {row.effective_disputed_overdue_base_decimal === null
                          ? 'Base amount unavailable'
                          : formatMoney(Number(row.effective_disputed_overdue_base_decimal), organisationBaseCurrency)}
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
                  <td className="min-w-48 px-4 py-3">
                    <label className="sr-only" htmlFor={`customer-context-${row.customer_source_id}`}>
                      Customer context for {row.customer_name}
                    </label>
                    <select
                      id={`customer-context-${row.customer_source_id}`}
                      value={row.override_level}
                      onChange={(event) =>
                        void handleFounderContextChange(
                          row,
                          event.target.value as FounderContextLevel
                        )
                      }
                      disabled={Boolean(updatingContextByCustomerId[row.customer_source_id])}
                      className="min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {FOUNDER_CONTEXT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 min-h-4 text-xs text-gray-500" aria-live="polite">
                      {updatingContextByCustomerId[row.customer_source_id] ? 'Saving…' : ''}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getStatusBadgeClasses(row)}`}
                    >
                      {getStatusLabel(row)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {resolvedTenantId && <Link href={customerHistoryUrl(row.customer_source_id, resolvedTenantId)}
                      className="mr-2 inline-flex min-h-11 items-center whitespace-nowrap rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50">
                      View history
                    </Link>}
                    <button type="button" className="min-h-11 whitespace-nowrap rounded-md border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50"
                      aria-expanded={expandedCustomerSourceId === row.customer_source_id}
                      onClick={() => selectCustomer(row.customer_source_id)}>
                      {expandedCustomerSourceId === row.customer_source_id ? 'Hide invoices' : 'Manage invoices'}
                    </button>
                    {row.has_active_dispute && <p className="mt-1 text-xs text-amber-800">Disputed debt</p>}
                  </td>
                </tr>
                </Fragment>
              ))}
            </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
