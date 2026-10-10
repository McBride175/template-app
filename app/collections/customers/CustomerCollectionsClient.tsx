'use client'

import { notifyAccountingScope, subscribeAccountingUpdates } from '@/lib/accounting/product-events'

import type { FinancialMutationReconciliation } from '@/lib/collections/financial-mutation-reconciliation-server'
import { shouldApplyCustomerFinancialResponse, type CustomerFinancialStamp } from '@/lib/collections/financial-mutation-response'
import { notifyPromiseActionabilityChanged } from '@/lib/collections/promise-refresh'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { SortBy, SortDir, CustomerCollectionsSummaryRow } from './customer-workspace-types'
import { formatMoney, formatInvoicedAmount, formatCurrencyFailureReason } from './customer-format'
import CustomerOverview from './CustomerOverview'
import CustomerPromises from './CustomerPromises'
import CustomerBrowser from './CustomerBrowser'
import CustomerSelectionPanel from './CustomerSelectionPanel'
import Select from '@/app/components/ui/Select'
import { actionStyles } from '@/app/components/ui/actionStyles'
import Alert from '@/app/components/ui/Alert'
import Spinner from '@/app/components/ui/Spinner'
import EmptyState from '@/app/components/ui/EmptyState'
import Card from '@/app/components/ui/Card'
import Button from '@/app/components/ui/Button'
import { InvoiceDisputeList } from '@/app/collections/customers/CustomerInvoiceDisputes'
import type { InvoiceDisputeView } from '@/lib/collections/invoice-dispute-view'
import MultiCurrencyPlanGate from '@/app/collections/MultiCurrencyPlanGate'
import { buildLoginPath } from '@/lib/auth-flow'
import { disputesReturnHref, withDisputesOrigin } from '@/lib/collections/dispute-worklist'
import { promisesReturnHref, withPromisesOrigin } from '@/lib/collections/promise-worklist'
import { prioritiesReturnHref, queueCustomerId, withQueueOrigin } from '../actions/queue-navigation-context'
import { customerHistoryUrl } from '@/lib/collections/customer-history-url'
import {
  FOUNDER_CONTEXT_OPTIONS,
  type FounderContextLevel,
} from '@/lib/collections/founder-context'


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
        notifyAccountingScope(payload.tenantId)
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
        notifyAccountingScope(payload.tenantId)
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

  const [originPromises, setOriginPromises] = useState<string | null>(null)
  const [originDisputes, setOriginDisputes] = useState<string | null>(null)
  const [originQueueCustomer, setOriginQueueCustomer] = useState<string | null>(null)
  useEffect(() => {
    const read = () => {
      const params = new URL(window.location.href).searchParams
      setOriginQueueCustomer(queueCustomerId(params.get('queueCustomerSourceId')))
      setOriginPromises(promisesReturnHref(params.get('promisesReturn'), params.get('tenantId')))
      setOriginDisputes(disputesReturnHref(params.get('disputesReturn'), params.get('tenantId')))
    }
    read(); window.addEventListener('popstate', read)
    return () => window.removeEventListener('popstate', read)
  }, [])

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
    const updated = () => { void loadRows(true); if (expandedCustomerSourceId) void loadDetail(expandedCustomerSourceId) }
    return subscribeAccountingUpdates(updated)
  }, [loadRows, loadDetail, expandedCustomerSourceId])

  useEffect(() => {
    if (!expandedCustomerSourceId || detailLoading ||
      detail?.customerSourceId !== expandedCustomerSourceId ||
      pendingDetailScrollId.current !== expandedCustomerSourceId || !invoiceSectionRef.current) return
    pendingDetailScrollId.current = null
    let target: HTMLElement = invoiceSectionRef.current
    try {
      if (window.location.hash.startsWith('#invoice-') || ['#customer-invoices', '#customer-promises', '#customer-overview'].includes(window.location.hash)) {
        const invoice = document.getElementById(decodeURIComponent(window.location.hash.slice(1)))
        if (invoice && target.contains(invoice)) target = invoice
      }
    } catch { /* Ignore malformed customer fragments. */ }
    target.focus({ preventScroll: true })
    target.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
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

  const prioritiesHref = prioritiesReturnHref(resolvedTenantId, originQueueCustomer)

  return (
    <div className="min-w-0 space-y-4 sm:space-y-6">
      <header className={expandedCustomerSourceId ? 'sr-only sm:not-sr-only' : ''}>
        <h1 className="text-xl font-semibold text-text-primary sm:text-2xl">Customers</h1>
      </header>
      {error && <Alert variant="error">{error}</Alert>}
      {disputeRefreshState && <Alert variant={disputeRefreshState.stale ? 'warning' : 'success'}>
        {disputeRefreshState.message}
        {disputeRefreshState.stale && <button type="button" className="ml-2 inline-flex min-h-11 items-center underline" onClick={() => expandedCustomerSourceId && void recoverDetail(expandedCustomerSourceId)}>Refresh page</button>}
      </Alert>}
      {contextError && <Alert variant="error">{contextError}</Alert>}
      {contextFeedback && <Alert variant="success">{contextFeedback}</Alert>}
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


      {!multiCurrencyPlanRequired && <div className="grid min-w-0 items-start gap-3 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <CustomerSelectionPanel key={expandedCustomerSourceId ?? 'browse'} selected={Boolean(expandedCustomerSourceId)}>
          <CustomerBrowser rows={visibleRows} selectedId={expandedCustomerSourceId} currency={organisationBaseCurrency}
            equivalent={showMultiCurrencyAmounts} search={searchQuery} onSearch={setSearchQuery}
            overdueOnly={overdueOnly} onOverdueOnly={setOverdueOnly} sort={sortOption}
            onSort={value => setSortOption(value as `${SortBy}:${SortDir}`)} sortOptions={SORT_OPTIONS}
            loading={loading} refreshing={refreshing} blocked={Boolean(error || disputeRefreshState?.stale || currencyHealth?.status === 'unavailable')}
            onSelect={selectCustomer} summary={description}
            onRefresh={() => disputeRefreshState?.stale ? expandedCustomerSourceId && void recoverDetail(expandedCustomerSourceId) : void loadRows(true)} />
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
                      <Link href={withDisputesOrigin(withQueueOrigin(customerHistoryUrl(customer.customer_source_id, resolvedTenantId), originQueueCustomer), originDisputes, resolvedTenantId)}
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


          {!error && !loading && visibleRows.length > 0 && <details className="mt-4 border-t border-border-default">
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-focus">Shown customer totals</summary>
            <dl className="space-y-3 pb-3 text-sm">
              <div><dt className="text-text-secondary">{showMultiCurrencyAmounts ? 'Gross equivalent outstanding total' : 'Gross outstanding total'}</dt><dd>{formatMoney(totals.outstandingBase, organisationBaseCurrency)}</dd></div>
              <div><dt className="text-text-secondary">{showMultiCurrencyAmounts ? 'Gross equivalent overdue total' : 'Gross overdue total'}</dt><dd>{formatMoney(totals.overdueOutstandingBase, organisationBaseCurrency)}</dd></div>
              <div><dt className="text-text-secondary">Overdue invoices total</dt><dd>{totals.overdueInvoicesCount}</dd></div>
              <div><dt className="text-text-secondary">Oldest overdue days total</dt><dd>{totals.oldestOverdueDaysSum}</dd></div>
            </dl>
          </details>}
        </CustomerSelectionPanel>
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
      {expandedCustomerSourceId && (
        <section ref={(element) => { invoiceSectionRef.current = element }}
          tabIndex={-1} aria-label="Selected customer detail" className="min-w-0 scroll-mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-x-4">{originDisputes && <Link href={originDisputes} className={actionStyles({ variant: 'ghost', className: 'min-h-11 px-0' })}>Back to Disputes</Link>}{originPromises && <Link href={originPromises} className={actionStyles({ variant: 'ghost', className: 'min-h-11 px-0' })}>Back to Promises</Link>}<Link href={prioritiesHref} className={actionStyles({ variant: 'ghost', className: 'min-h-11 px-0' })}>Back to Priorities</Link></div>
            <Button variant="ghost" className="min-h-11" onClick={() => selectCustomer(expandedCustomerSourceId)}>
              Close customer
            </Button>
          </div>
          {detailLoading && <div className="flex items-center gap-2 py-4 text-sm" role="status"><Spinner label={null} />Loading selected customer and invoices…</div>}
          {detailError && !detailLoading && <Card>
            <Alert variant="error">{detailError}</Alert>
            <Button variant="ghost" className="min-h-11" onClick={() => void loadDetail(expandedCustomerSourceId)}>Retry customer detail</Button>
          </Card>}
          {detail && detail.customerSourceId === expandedCustomerSourceId && (
            <div className="min-w-0 space-y-5">
              {detail.row ? <CustomerOverview row={{ ...detail.row, override_level: rows.find(row => row.customer_source_id === detail.row!.customer_source_id)?.override_level ?? detail.row.override_level }} currency={detail.organisationBaseCurrency ?? null}
                equivalent={showMultiCurrencyAmounts} historyHref={detail.tenantId ? withDisputesOrigin(withPromisesOrigin(withQueueOrigin(customerHistoryUrl(expandedCustomerSourceId, detail.tenantId), originQueueCustomer), originPromises, detail.tenantId), originDisputes, detail.tenantId) : undefined}
                contextControl={<>
                  <label className="sr-only" htmlFor={`customer-context-${detail.row.customer_source_id}`}>Customer context for {detail.row.customer_name}</label>
                  <Select id={`customer-context-${detail.row.customer_source_id}`} value={rows.find(row => row.customer_source_id === detail.row!.customer_source_id)?.override_level ?? detail.row.override_level}
                    onChange={event => void handleFounderContextChange(rows.find(row => row.customer_source_id === detail.row!.customer_source_id) ?? detail.row!, event.target.value as FounderContextLevel)}
                    disabled={!rows.some(row => row.customer_source_id === detail.row!.customer_source_id) || Boolean(updatingContextByCustomerId[detail.row.customer_source_id])} className="min-h-11 max-w-sm">
                    {FOUNDER_CONTEXT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </Select>
                  <p className="text-xs text-text-secondary" aria-live="polite">{updatingContextByCustomerId[detail.row.customer_source_id] ? 'Saving…' : !rows.some(row => row.customer_source_id === detail.row!.customer_source_id) ? 'This account is outside the current customer list. Adjust the list filters to manage its priority setting.' : ''}</p>
                </>} /> : <div>
                  <h2 className="break-words text-xl font-semibold">{detail.reviewRequiredCustomer?.customer_name ?? 'Customer'}</h2>
                  <Alert variant="warning">Customer amounts cannot be valued reliably. Review currency evidence before deciding what to chase.</Alert>
                  {detail.tenantId && <Link href={withDisputesOrigin(withPromisesOrigin(withQueueOrigin(customerHistoryUrl(expandedCustomerSourceId, detail.tenantId), originQueueCustomer), originPromises, detail.tenantId), originDisputes, detail.tenantId)} className={actionStyles({ variant: 'secondary', className: 'mt-2 min-h-11' })}>View history</Link>}
                </div>}
              <div id="customer-invoices" tabIndex={-1} className="min-w-0 scroll-mt-4">
              {(detail.currencyHealth?.status === 'unavailable' || !detail.organisationBaseCurrency) ?
                <p className="text-sm text-gray-700">Customer amounts are unavailable until currency data is ready.</p> :
              <InvoiceDisputeList workspace key={expandedCustomerSourceId} tenantId={detail.tenantId!} customerSourceId={expandedCustomerSourceId}
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
              </div>
              {detail.currencyHealth?.status !== 'unavailable' && detail.organisationBaseCurrency && <CustomerPromises invoices={detail.invoices ?? []} />}
            </div>
          )}
        </section>
      )}


          {!expandedCustomerSourceId && <EmptyState title="Select a customer" description="Find an account to review its financial position, invoices and collection history.">
            <Link href={prioritiesHref} className={actionStyles({ variant: 'secondary', className: 'min-h-11' })}>Back to Priorities</Link>
          </EmptyState>}
        </div>

      </div>}
    </div>
  )
}
