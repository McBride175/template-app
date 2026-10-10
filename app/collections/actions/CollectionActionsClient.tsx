'use client'

import { notifyAccountingScope, subscribeAccountingUpdates } from '@/lib/accounting/product-events'

import { subscribePromiseActionability } from '@/lib/collections/promise-refresh'

import Link from 'next/link'
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type TouchEvent,
} from 'react'
import { useRouter } from 'next/navigation'
import Card from '@/app/components/ui/Card'
import Button from '@/app/components/ui/Button'
import Alert from '@/app/components/ui/Alert'
import QueueCustomer from './QueueCustomer'
import QueueOrder from './QueueOrder'
import QueueState from './QueueState'
import QueueActionPanel, { OUTCOME_OPTIONS, type FollowUpChoice } from './QueueActionPanel'
import MultiCurrencyPlanGate from '@/app/collections/MultiCurrencyPlanGate'
import DashboardXeroConnectionCard from '@/app/dashboard/DashboardXeroConnectionCard'
import FounderContextControl from '@/app/collections/FounderContextControl'
import { buildLoginPath } from '@/lib/auth-flow'
import { createActionBody, deleteActionBody, recordingAttempt, restoredCustomerIndex,
  type RecordingAttempt } from '@/lib/collections/action-recording'
import type { ActionHistoryOutcome } from '@/lib/collections/action-history'
import { customerHistoryUrl } from '@/lib/collections/customer-history-url'
import { shouldApplyQueueResponse, type QueueResponseStamp } from '@/lib/collections/queue-response-order'
import {
  FOUNDER_CONTEXT_OPTIONS,
  buildFounderContextConsequence,
  resolveFounderContextQueueIndex,
  selectActionableFounderContextRows,
  type FounderContextLevel,
} from '@/lib/collections/founder-context'
import {
  resolveFreeUsageGuidance,
  shouldShowFirstActionGuidance,
  type CollectionExperienceState,
} from '@/lib/collections/progressive-guidance'

interface CollectionActionRow {
  customer_source_id: string
  customer_name: string
  customer_email: string | null
  overdue_outstanding_base_decimal?: string | null
  total_outstanding_base_decimal?: string | null
  overdue_outstanding_base: number | null
  total_outstanding_base?: number | null
  collectible_overdue_base?: number
  customer_to_chase_overdue_base: number
  customer_credit_applied_base: number
  has_actionable_overdue_balance: boolean
  active_promised_overdue_base_decimal?: string | null
  collectible_outstanding_base?: number
  effective_disputed_overdue_base_decimal: string | null
  overdue_invoices_count?: number
  open_invoices_count?: number
  actionable_overdue_invoices_count?: number
  actionable_open_invoices_count?: number
  weighted_avg_overdue_days: number
  relative_lateness_days?: number | null
  relative_lateness_score?: number
  last_payment_date: string | null
  exposure_score?: number
  exposure_share_percent?: number
  exposure_relative_to_largest_percent?: number
  override_level: OverrideLevel
  override_multiplier?: number
  base_score?: number
  final_score?: number
  priority_score: number
  recommended_action: 'Review now' | 'Follow up' | 'Monitor' | 'No action'
  reason?: string
  score_breakdown_lines?: string[]
  organisation_base_currency_code?: string
  native_currency_breakdown?: Array<{
    currency_code: string
    total_outstanding_native: string
    overdue_outstanding_native: string
  }>
  collectible_native_currency_breakdown: Array<{
    currency_code: string
    collectible_outstanding_native: string
    collectible_overdue_native: string
  }>
  last_action_type: 'called' | 'emailed' | 'postponed' | null
  last_action_outcome: 'no_response' | 'spoke_to_customer' | 'promised_to_pay' | 'disputed' | null
  last_action_timestamp: string | null
  recent_activity?: {
    format: 'v1' | 'legacy'
    outcome: string | null
    note: string | null
    actionType: 'called' | 'emailed' | 'postponed' | null
    actionTimestamp: string
    nextActionDate: string | null
  } | null
}

export interface CollectionActionsApiResponse {
  ok?: boolean
  code?: string
  entitlement?: ActionsEntitlement
  rows?: CollectionActionRow[]
  actionsTakenByCustomerId?: Record<string, ActionTakenLog>
  queue?: CollectionQueueInfo
  organisationBaseCurrency?: string | null
  currencyContext?: CollectionsCurrencyContext
  currencyAccess?: CollectionsCurrencyAccess
  currencyHealth?: CollectionsCurrencyHealth
  reviewRequiredCustomers?: CurrencyReviewRequiredCustomer[]
  experience?: CollectionExperienceState
  tenantId?: string
  followUpSchedule?: FollowUpSchedule
  version?: { projectionRevision: string; financialEpoch: string; accountingGenerationId: string;
    financialCalculationId: string; evaluationDate: string }
  error?: string
}

interface LoadedCollectionActions {
  rows: CollectionActionRow[]
  actionsTakenByCustomerId: Record<string, ActionTakenLog>
}

type CollectionQueueStatus =
  | 'ready'
  | 'currency_data_degraded'
  | 'currency_data_unavailable'
  | 'no_mapped_data'
  | 'no_overdue_customers'
  | 'no_eligible_customers'
  | 'complete_today'

interface CollectionQueueInfo {
  status: CollectionQueueStatus
  rankingStatus: 'complete' | 'provisional' | 'unavailable'
  mappedCustomerCount: number
  mappedInvoiceCount: number
  mappedPaymentCount: number
  eligibleCustomerCount: number
  suppressedCustomerCount: number
  actionedTodayCount: number
  remainingCustomerCount: number
  returnedCustomerCount: number
  reviewRequiredCustomerCount: number
  relativeLateness: {
    mode: 'absolute-fallback' | 'portfolio-relative'
    materialObservationCount: number
    midpointAnchorDays: number
    highAnchorDays: number
    materialP50Days: number | null
    materialP90Days: number | null
  }
}

interface CollectionsCurrencyHealth {
  status: 'healthy' | 'degraded' | 'unavailable'
  rankingStatus: 'complete' | 'provisional' | 'unavailable'
  affectedInvoiceCount: number
  affectedCustomerCount: number
  failureReasons: Record<string, number>
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

interface ActionsEntitlement {
  plan: 'free' | 'paid'
  isPaid: boolean
  paidPlan: 'basic' | 'pro' | null
  tenantId: string | null
  usageDaysConsumed: number
  usageDaysRemaining: number | null
  freeUsageDaysLimit: number
  hasActionsAccess: boolean
}

interface CollectionOverrideApiResponse {
  ok?: boolean
  code?: string
  entitlement?: ActionsEntitlement
  currencyContext?: CollectionsCurrencyContext
  currencyAccess?: CollectionsCurrencyAccess
  projection?: CollectionActionsApiResponse
  projectionUnavailable?: boolean
  error?: string
}

interface ActionHistoryMutationApiResponse {
  ok?: boolean
  action?: {
    id: string
    outcome: ActionHistoryOutcome
    nextActionDate: string
    actionTimestamp: string
  }
  code?: string
  projection?: CollectionActionsApiResponse
  projectionUnavailable?: boolean
  error?: string
}

interface FollowUpSchedule {
  today: string
  tomorrow: string
  inTwoDays: string
  inThreeDays: string
  nextWeek: string
  timezone: string
}

interface CollectionActionsClientProps {
  embedded?: boolean
  showHeader?: boolean
  showFilters?: boolean
  showQueue?: boolean
  showTable?: boolean
  loginNextPath?: string
  tenantId?: string | null
  dashboardData?: CollectionActionsApiResponse | null
  dashboardState?: 'loading' | 'ready' | 'preparing' | 'unavailable' | 'blocked' | 'onboarding'
  dashboardRefresh?: () => Promise<CollectionActionsApiResponse | null>
  onProjectionVersion?: (stamp: QueueResponseStamp) => void
}

type LegacyActionType = 'called' | 'emailed' | 'postponed'
type LegacyActionOutcome = 'no_response' | 'spoke_to_customer' | 'promised_to_pay' | 'disputed'
type OverrideLevel = FounderContextLevel

interface ActionTakenLog {
  type: LegacyActionType
  takenAtIso: string
  outcome: LegacyActionOutcome | null
  nextActionDate: string | null
  actionId: string
}

interface LastActionState {
  actionId: string
  customerSourceId: string
  customerName: string
  tenantId: string
  outcome: ActionHistoryOutcome
}

function formatCurrencyFailureReason(reason: string) {
  return reason.replaceAll('_', ' ')
}

function CurrencyHealthDiagnostic({
  currencyHealth,
}: {
  currencyHealth: CollectionsCurrencyHealth
}) {
  const failureReasons = Object.entries(currencyHealth.failureReasons)
  const unavailable = currencyHealth.status === 'unavailable'

  return (
    <div>
      <h3 className="text-lg font-semibold text-text-primary">
        {unavailable ? 'Currency data needs refreshing' : 'Ranking uses available currency data'}
      </h3>
      <p className="mt-1 text-sm text-text-secondary">
        {unavailable
          ? 'A reliable collections ranking cannot be calculated until the Xero organisation currency data is refreshed or inspected.'
          : 'Some invoice currency data could not be converted. We have ranked the remaining customers using safely valued data, and marked affected customers for review. Portfolio values are provisional and exclude those affected customers.'}
      </p>
      <p className="mt-2 text-sm text-text-secondary">
        Affected invoices: {currencyHealth.affectedInvoiceCount} · Affected customers:{' '}
        {currencyHealth.affectedCustomerCount}
      </p>
      {failureReasons.length > 0 && (
        <p className="mt-1 text-xs text-text-muted">
          Reasons:{' '}
          {failureReasons
            .map(([reason, count]) => `${formatCurrencyFailureReason(reason)} (${count})`)
            .join(', ')}
        </p>
      )}
      <p className="mt-2 text-xs text-text-muted">
        Refresh Xero data or contact support if the issue remains.
      </p>
    </div>
  )
}

function formatInvoicedAmount(amount: string, currencyCode: string) {
  const numericAmount = Number(amount)
  if (!Number.isFinite(numericAmount)) return `${currencyCode} ${amount}`
  return `${formatMoney(numericAmount, currencyCode)} ${currencyCode}`
}

function formatInvoicedBreakdown<T extends { currency_code: string }>(
  breakdown: T[],
  amountField: keyof T
) {
  return breakdown
    .filter((entry) => Number(entry[amountField]) > 0)
    .map((entry) => formatInvoicedAmount(String(entry[amountField]), entry.currency_code))
    .join(' · ')
}

function ReviewRequiredCustomers({
  customers,
  customerHref,
}: {
  customers: CurrencyReviewRequiredCustomer[]
  customerHref: (customerSourceId: string) => string
}) {
  if (customers.length === 0) return null

  return (
    <Card>
      <div className="space-y-3">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">Needs review</h3>
          <p className="mt-1 text-sm text-text-secondary">
            These customers are not scored because at least one open invoice cannot be valued
            reliably in the organisation base currency.
          </p>
        </div>
        <div className="divide-y divide-border-default rounded-md border border-border-default bg-surface">
          {customers.map((customer) => (
            <div key={customer.customer_source_id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-text-primary">{customer.customer_name}</p>
                  <p className="text-xs text-text-secondary">{customer.customer_email || 'No email recorded'}</p>
                </div>
                <p className="text-xs font-medium text-feedback-warning">
                  {customer.affected_invoice_count} affected invoice
                  {customer.affected_invoice_count === 1 ? '' : 's'}
                </p>
              </div>
              {customer.native_currency_breakdown.length > 0 && (
                <p className="mt-2 text-xs text-text-secondary">
                  Invoiced outstanding:{' '}
                  {customer.native_currency_breakdown
                    .map((entry) =>
                      formatInvoicedAmount(entry.total_outstanding_native, entry.currency_code)
                    )
                    .join(' · ')}
                </p>
              )}
              <Link href={customerHref(customer.customer_source_id)}
                className="mt-2 inline-block text-xs font-medium text-text-secondary underline underline-offset-2">
                Manage invoices
              </Link>
              {Object.keys(customer.failure_reasons).length > 0 && (
                <p className="mt-1 text-xs text-text-muted">
                  Reasons:{' '}
                  {Object.entries(customer.failure_reasons)
                    .map(
                      ([reason, count]) =>
                        `${formatCurrencyFailureReason(reason)} (${count})`
                    )
                    .join(', ')}
                </p>
              )}
              <p className="mt-1 text-xs text-text-muted">
                Refresh Xero data or contact support before deciding priority.
              </p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
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

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString()
}

function formatRelativeTimeFromNow(value: string | null) {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  const diffMs = date.getTime() - Date.now()
  const absDiffMs = Math.abs(diffMs)
  const minuteMs = 60 * 1000
  const hourMs = 60 * minuteMs
  const dayMs = 24 * hourMs
  const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

  if (absDiffMs < hourMs) {
    return relativeFormat.format(Math.round(diffMs / minuteMs), 'minute')
  }

  if (absDiffMs < dayMs) {
    return relativeFormat.format(Math.round(diffMs / hourMs), 'hour')
  }

  return relativeFormat.format(Math.round(diffMs / dayMs), 'day')
}

function formatWeightedDays(value: number) {
  return Number.isFinite(value) ? value.toFixed(1) : '0.0'
}

function getRecommendedActionClasses() {
  return 'text-text-primary'
}

function getLegacyActionLabel(actionType: LegacyActionType) {
  if (actionType === 'called') return 'Called'
  if (actionType === 'emailed') return 'Emailed'
  return 'Postponed'
}

function getLegacyOutcomeLabel(outcome: LegacyActionOutcome) {
  if (outcome === 'no_response') return 'No response'
  if (outcome === 'spoke_to_customer') return 'Spoke to customer'
  if (outcome === 'promised_to_pay') return 'Promised to pay'
  return 'Disputed'
}

function getOutcomeLabel(outcome: ActionHistoryOutcome) {
  return OUTCOME_OPTIONS.find((option) => option.value === outcome)?.label ?? outcome
}

function followUpDateForChoice(choice: FollowUpChoice, schedule: FollowUpSchedule | null,
  customDate: string) {
  if (choice === 'tomorrow') return null // Omit: the server calculates its own tomorrow.
  if (!schedule) return null
  if (choice === 'two_days') return schedule.inTwoDays
  if (choice === 'three_days') return schedule.inThreeDays
  if (choice === 'next_week') return schedule.nextWeek
  return customDate || null
}

export default function CollectionActionsClient({
  embedded = false,
  showHeader,
  showFilters,
  showQueue,
  showTable = true,
  loginNextPath,
  tenantId = null, dashboardData, dashboardState, dashboardRefresh, onProjectionVersion,
}: CollectionActionsClientProps) {
  const router = useRouter()
  const [rows, setRows] = useState<CollectionActionRow[]>([])
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [expandedReasonId, setExpandedReasonId] = useState<string | null>(null)
  const [actionsTakenByCustomerId, setActionsTakenByCustomerId] = useState<Record<string, ActionTakenLog>>({})
  const [updatingOverrideByCustomerId, setUpdatingOverrideByCustomerId] = useState<
    Record<string, boolean>
  >({})
  const overrideRequestsInFlight = useRef(new Set<string>())
  const [queueCardIndex, setQueueCardIndex] = useState(0)
  const [queueFeedback, setQueueFeedback] = useState<string | null>(null)
  const [touchStartX, setTouchStartX] = useState<number | null>(null)
  const [followUpChoice, setFollowUpChoice] = useState<FollowUpChoice>('tomorrow')
  const [showFollowUpChoices, setShowFollowUpChoices] = useState(false)
  const [customDateValue, setCustomDateValue] = useState('')
  const [showNote, setShowNote] = useState(false)
  const [actionNote, setActionNote] = useState('')
  const [submittingAction, setSubmittingAction] = useState(false)
  const [undoingAction, setUndoingAction] = useState(false)
  const [uncertainAttempt, setUncertainAttempt] = useState(false)
  const actionRequestInFlight = useRef(false)
  const pendingAttempt = useRef<RecordingAttempt | null>(null)
  const [lastAction, setLastAction] = useState<LastActionState | null>(null)
  const [restoreCustomerSourceId, setRestoreCustomerSourceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [entitlement, setEntitlement] = useState<ActionsEntitlement | null>(null)
  const [usageLimitReached, setUsageLimitReached] = useState(false)
  const [xeroConnectionMissing, setXeroConnectionMissing] = useState(false)
  const [queueInfo, setQueueInfo] = useState<CollectionQueueInfo | null>(null)
  const [resolvedTenantId, setResolvedTenantId] = useState<string | null>(tenantId)
  const [followUpSchedule, setFollowUpSchedule] = useState<FollowUpSchedule | null>(null)
  const [experience, setExperience] = useState<CollectionExperienceState | null>(null)
  const [organisationBaseCurrency, setOrganisationBaseCurrency] = useState<string | null>(null)
  const [currencyContext, setCurrencyContext] = useState<CollectionsCurrencyContext | null>(null)
  const [currencyAccess, setCurrencyAccess] = useState<CollectionsCurrencyAccess | null>(null)
  const [currencyHealth, setCurrencyHealth] = useState<CollectionsCurrencyHealth | null>(null)
  const [reviewRequiredCustomers, setReviewRequiredCustomers] = useState<
    CurrencyReviewRequiredCustomer[]
  >([])
  const defaultLoginNextPath = embedded ? '/dashboard' : '/collections/actions'
  const effectiveLoginNextPath =
    loginNextPath ??
    (tenantId
      ? `${defaultLoginNextPath}?tenantId=${encodeURIComponent(tenantId)}`
      : defaultLoginNextPath)
  const effectiveOverdueOnly = embedded || overdueOnly
  const showHeaderSection = showHeader ?? !embedded
  const showFiltersSection = showFilters ?? !embedded
  const showQueueSection = showQueue ?? embedded
  const multiCurrencyPlanRequired = Boolean(
    currencyAccess?.requiresPro && !currencyAccess.allowed
  )
  const showMultiCurrencyAmounts = Boolean(
    currencyAccess?.allowed && currencyContext?.mode === 'multi_currency'
  )

  const resetActionPanel = useCallback(() => {
    setFollowUpChoice('tomorrow')
    setShowFollowUpChoices(false)
    setCustomDateValue('')
    setShowNote(false)
    setActionNote('')
  }, [])

  const loadRequestId = useRef(0)
  const projectionRequestSequence = useRef(0)
  const latestAppliedProjection = useRef<QueueResponseStamp | null>(null)
  const activeOverdueOnly = useRef(effectiveOverdueOnly)
  activeOverdueOnly.current = effectiveOverdueOnly
  const applyAuthoritativeProjection = useCallback((payload: CollectionActionsApiResponse,
    requestedOverdueOnly: boolean, requestSequence: number): LoadedCollectionActions | null => {
    if (requestedOverdueOnly !== activeOverdueOnly.current) return null
    const stamp: QueueResponseStamp = {
      tenantId: payload.tenantId ?? tenantId,
      projectionRevision: payload.version?.projectionRevision ?? null,
      financialEpoch: payload.version?.financialEpoch ?? null,
      accountingGenerationId: payload.version?.accountingGenerationId ?? null,
      requestSequence,
    }
    if (!shouldApplyQueueResponse(latestAppliedProjection.current, stamp)) return null
    latestAppliedProjection.current = stamp
    onProjectionVersion?.(stamp)
    if (payload.entitlement) setEntitlement(payload.entitlement)
    setUsageLimitReached(false)
    setOrganisationBaseCurrency(payload.organisationBaseCurrency ?? null)
    setCurrencyContext(payload.currencyContext ?? null)
    if (payload.currencyAccess !== undefined) setCurrencyAccess(payload.currencyAccess)
    setCurrencyHealth(payload.currencyHealth ?? null)
    setReviewRequiredCustomers(payload.reviewRequiredCustomers ?? [])
    setExperience(payload.experience ?? null)
    setResolvedTenantId(payload.tenantId ?? tenantId)
    notifyAccountingScope(payload.tenantId??tenantId)
    setFollowUpSchedule(payload.followUpSchedule ?? null)
    const nextRows = payload.rows ?? []
    const visibleRows = requestedOverdueOnly
      ? nextRows.filter((row) => row.has_actionable_overdue_balance) : nextRows
    const nextActionsTakenByCustomerId = payload.actionsTakenByCustomerId ?? {}
    setRows(visibleRows)
    setActionsTakenByCustomerId(nextActionsTakenByCustomerId)
    setQueueInfo(payload.queue ?? null)
    return { rows: visibleRows, actionsTakenByCustomerId: nextActionsTakenByCustomerId }
  }, [tenantId, onProjectionVersion])
  const loadRows = useCallback(
    async (manualRefresh: boolean) => {
      const requestId = ++loadRequestId.current
      const requestSequence = ++projectionRequestSequence.current
      const requestedOverdueOnly = effectiveOverdueOnly
      if (manualRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }

      setError(null)
      setXeroConnectionMissing(false)

      try {
        if (dashboardRefresh) {
          const payload = await dashboardRefresh()
          if (requestId !== loadRequestId.current || !payload) return null
          if (!payload.ok) { setEntitlement(payload.entitlement ?? null); setRows([])
            setUsageLimitReached(payload.code === 'ACTION_USAGE_LIMIT_REACHED')
            setCurrencyAccess(payload.currencyAccess ?? null); return null }
          return applyAuthoritativeProjection(payload, requestedOverdueOnly, requestSequence)
        }
        const params = new URLSearchParams({
          limit: '200',
          overdueOnly: String(effectiveOverdueOnly),
        })
        if (tenantId) {
          params.set('tenantId', tenantId)
        }

        const response = await fetch(`/api/collections/actions?${params.toString()}`, {
          cache: 'no-store',
          credentials: 'include',
        })

        if (requestId !== loadRequestId.current) return null
        if (response.status === 401) {
          router.replace(buildLoginPath(effectiveLoginNextPath, 'session_expired'))
          return null
        }

        const payload = (await response.json().catch(() => null)) as CollectionActionsApiResponse | null
        if (requestId !== loadRequestId.current) return null
        if (payload?.entitlement) {
          setEntitlement(payload.entitlement)
        }

        if (payload?.code === 'MULTI_CURRENCY_REQUIRES_PRO') {
          setRows([])
          setActionsTakenByCustomerId({})
          setQueueInfo(null)
          setOrganisationBaseCurrency(null)
          setCurrencyContext(payload.currencyContext ?? null)
          setCurrencyAccess(payload.currencyAccess ?? null)
          setCurrencyHealth(null)
          setReviewRequiredCustomers([])
          setExperience(payload.experience ?? null)
          setUsageLimitReached(false)
          return null
        }

        if (payload?.code === 'ACTION_USAGE_LIMIT_REACHED') {
          setRows([])
          setActionsTakenByCustomerId({})
          setQueueInfo(null)
          setOrganisationBaseCurrency(null)
          setCurrencyContext(null)
          setCurrencyAccess(null)
          setCurrencyHealth(null)
          setReviewRequiredCustomers([])
          setExperience(payload.experience ?? null)
          setUsageLimitReached(true)
          return null
        }

        if (payload?.code === 'NO_XERO_TENANT') {
          setRows([])
          setActionsTakenByCustomerId({})
          setQueueInfo(null)
          setOrganisationBaseCurrency(null)
          setCurrencyContext(null)
          setCurrencyAccess(null)
          setCurrencyHealth(null)
          setReviewRequiredCustomers([])
          setExperience(payload.experience ?? null)
          setUsageLimitReached(false)
          setXeroConnectionMissing(true)
          return null
        }

        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || 'Failed to load collection actions.')
        }

        return applyAuthoritativeProjection(payload, requestedOverdueOnly, requestSequence)
      } catch (fetchError) {
        if (requestId !== loadRequestId.current) return null
        setError(
          fetchError instanceof Error ? fetchError.message : 'Failed to load collection actions.'
        )
        return null
      } finally {
        if (requestId === loadRequestId.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [applyAuthoritativeProjection, dashboardRefresh, effectiveLoginNextPath, effectiveOverdueOnly, router, tenantId]
  )

  useEffect(() => {
    if (dashboardRefresh) return
    const updated = () => { void loadRows(true) }
    return subscribeAccountingUpdates(updated)
  }, [loadRows, dashboardRefresh])

  useEffect(() => {
    const requests = loadRequestId
    if (!dashboardRefresh) void loadRows(false)
    return () => { requests.current++ }
  }, [dashboardRefresh, loadRows])

  useEffect(() => {
    if (!dashboardRefresh) return
    if (dashboardData?.ok) {
      if (applyAuthoritativeProjection(dashboardData, true, ++projectionRequestSequence.current)) setError(null)
    }
    else {
      setRows([])
      setXeroConnectionMissing(dashboardData?.code === 'NO_XERO_TENANT')
      setEntitlement(dashboardData?.entitlement ?? null)
      setUsageLimitReached(dashboardData?.code === 'ACTION_USAGE_LIMIT_REACHED')
      setCurrencyContext(dashboardData?.currencyContext ?? null)
      setCurrencyAccess(dashboardData?.currencyAccess ?? null)
      setQueueInfo(null)
      if (dashboardState === 'preparing' || dashboardState === 'unavailable') setError('Unable to load collection priorities right now. Try refreshing again.')
    }
    setLoading(dashboardState === 'loading')
  }, [dashboardData, dashboardState, dashboardRefresh, applyAuthoritativeProjection])

  useEffect(() => subscribePromiseActionability(resolvedTenantId ?? tenantId, reconciliation => {
    if (reconciliation?.projection && reconciliation.projection.overdueOnly === effectiveOverdueOnly) {
      applyAuthoritativeProjection(reconciliation.projection, effectiveOverdueOnly, ++projectionRequestSequence.current)
    } else void loadRows(true)
  }, { overdueOnly: effectiveOverdueOnly, limit: 200 }), [resolvedTenantId, tenantId, loadRows, applyAuthoritativeProjection, effectiveOverdueOnly])

  const queueRows = useMemo(
    () => selectActionableFounderContextRows(rows, actionsTakenByCustomerId),
    [actionsTakenByCustomerId, rows]
  )
  const currentQueueRow = queueRows[queueCardIndex] ?? null
  const queuePosition = currentQueueRow ? queueCardIndex + 1 : 0
  const selectedFollowUpDate = followUpDateForChoice(followUpChoice, followUpSchedule, customDateValue)
  const recentActivity = currentQueueRow?.recent_activity ??
    (currentQueueRow?.last_action_type && currentQueueRow.last_action_timestamp ? {
      format: 'legacy' as const,
      actionType: currentQueueRow.last_action_type,
      outcome: currentQueueRow.last_action_outcome,
      note: null,
      actionTimestamp: currentQueueRow.last_action_timestamp,
      nextActionDate: null,
    } : null)

  useEffect(() => {
    setQueueCardIndex((prev) => {
      if (queueRows.length === 0) return 0
      return Math.min(prev, queueRows.length - 1)
    })
  }, [queueRows.length])

  useEffect(() => {
    const validCustomerIds = new Set(rows.map((row) => row.customer_source_id))
    setActionsTakenByCustomerId((prev) => {
      let changed = false
      const next: Record<string, ActionTakenLog> = {}

      for (const [customerId, action] of Object.entries(prev)) {
        if (validCustomerIds.has(customerId)) {
          next[customerId] = action
        } else {
          changed = true
        }
      }

      return changed ? next : prev
    })
  }, [rows])

  useEffect(() => {
    const validCustomerIds = new Set(rows.map((row) => row.customer_source_id))
    setUpdatingOverrideByCustomerId((prev) => {
      let changed = false
      const next: Record<string, boolean> = {}

      for (const [customerId, updating] of Object.entries(prev)) {
        if (validCustomerIds.has(customerId) && updating) {
          next[customerId] = true
        } else if (!validCustomerIds.has(customerId)) {
          changed = true
        }
      }

      return changed ? next : prev
    })
  }, [rows])

  useEffect(() => {
    if (!restoreCustomerSourceId) return

    const restoredIndex = queueRows.findIndex(
      (row) => row.customer_source_id === restoreCustomerSourceId
    )

    if (restoredIndex >= 0) {
      setQueueCardIndex(restoredIndex)
      setRestoreCustomerSourceId(null)
      return
    }

    const customerStillVisible = rows.some(
      (row) => row.customer_source_id === restoreCustomerSourceId
    )

    if (!customerStillVisible) {
      setRestoreCustomerSourceId(null)
    }
  }, [queueRows, restoreCustomerSourceId, rows])

  useEffect(() => {
    resetActionPanel()
  }, [currentQueueRow?.customer_source_id, resetActionPanel])

  const moveQueueCard = useCallback(
    (direction: 'next' | 'prev') => {
      setQueueCardIndex((prev) => {
        if (queueRows.length === 0) return 0
        if (direction === 'next') return Math.min(prev + 1, queueRows.length - 1)
        return Math.max(prev - 1, 0)
      })
    },
    [queueRows.length]
  )

  const handleQueueCardTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    setTouchStartX(event.changedTouches[0]?.clientX ?? null)
  }, [])

  const handleQueueCardTouchEnd = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      if (touchStartX === null) return

      const endX = event.changedTouches[0]?.clientX ?? touchStartX
      const deltaX = endX - touchStartX
      const swipeThreshold = 60

      if (deltaX <= -swipeThreshold) {
        moveQueueCard('next')
      } else if (deltaX >= swipeThreshold) {
        moveQueueCard('prev')
      }

      setTouchStartX(null)
    },
    [moveQueueCard, touchStartX]
  )

  const handleRecordOutcome = useCallback(async (
    outcome: ActionHistoryOutcome | null,
    retry = false
  ) => {
    if (actionRequestInFlight.current || undoingAction) return
    if (uncertainAttempt && !retry) return
    if (!retry && (!currentQueueRow || !outcome)) return
    if (!retry && followUpChoice === 'custom' && !selectedFollowUpDate) {
      setError('Choose a future follow-up date before recording the outcome.')
      return
    }
    if (!retry && followUpChoice !== 'tomorrow' && !selectedFollowUpDate) {
      setError('Refresh priorities to load the organisation follow-up dates.')
      return
    }

    const tenant = retry ? pendingAttempt.current?.tenantId : resolvedTenantId
    if (!tenant) {
      setError('The Xero organisation is unavailable. Refresh priorities and try again.')
      return
    }
    const attempt = retry ? pendingAttempt.current : recordingAttempt(
      pendingAttempt.current,
      {
        tenantId: tenant,
        customerSourceId: currentQueueRow!.customer_source_id,
        outcome: outcome!,
        nextActionDate: selectedFollowUpDate,
        note: actionNote.trim() || null,
      },
      () => crypto.randomUUID()
    )
    if (!attempt) return
    pendingAttempt.current = attempt
    actionRequestInFlight.current = true
    const requestSequence = ++projectionRequestSequence.current
    setSubmittingAction(true)
    setError(null)

    const customerName = currentQueueRow?.customer_source_id === attempt.customerSourceId
      ? currentQueueRow.customer_name : attempt.customerSourceId
    const preferredNextId = queueRows[queueCardIndex + 1]?.customer_source_id ??
      queueRows[queueCardIndex - 1]?.customer_source_id ?? null
    let definitiveFailure = false
    let savedAction = false
    try {
      const response = await fetch('/api/collections/action-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...createActionBody(attempt),
          queue_overdue_only: effectiveOverdueOnly, queue_limit: 200 }),
      })
      if (response.status === 401) {
        router.replace(buildLoginPath(effectiveLoginNextPath, 'session_expired'))
        return
      }
      const payload = (await response.json().catch(() => null)) as ActionHistoryMutationApiResponse | null
      if (!response.ok || !payload?.ok) {
        definitiveFailure = response.status >= 400 && response.status < 500 &&
          response.status !== 408 && response.status !== 429
        throw new Error(payload?.error || 'Could not record the outcome.')
      }
      if (payload.action?.id !== attempt.actionId) {
        throw new Error('The action response could not be verified.')
      }

      savedAction = true
      pendingAttempt.current = null
      setUncertainAttempt(false)
      setLastAction({ actionId: attempt.actionId, tenantId: attempt.tenantId,
        customerSourceId: attempt.customerSourceId, customerName, outcome: attempt.outcome })
      setExperience({ hasPriorCollectionActivity: true })
      setQueueFeedback(`${getOutcomeLabel(attempt.outcome)} recorded for ${customerName}.`)
      setExpandedReasonId((previous) => previous === attempt.customerSourceId ? null : previous)
      resetActionPanel()

      const refreshed = payload.projection
        ? applyAuthoritativeProjection(payload.projection, effectiveOverdueOnly, requestSequence)
        : await loadRows(true)
      if (!refreshed) {
        if (payload.projection) return // A newer authoritative revision already won.
        setQueueFeedback(`${getOutcomeLabel(attempt.outcome)} recorded for ${customerName}. Refresh priorities to confirm the queue.`)
        return
      }
      const nextQueueRows = selectActionableFounderContextRows(
        refreshed.rows, refreshed.actionsTakenByCustomerId
      )
      const preferredIndex = preferredNextId
        ? restoredCustomerIndex(nextQueueRows, preferredNextId) : -1
      setQueueCardIndex(preferredIndex >= 0 ? preferredIndex :
        Math.min(queueCardIndex, Math.max(0, nextQueueRows.length - 1)))
    } catch (createError) {
      if (savedAction) {
        setQueueFeedback(`${getOutcomeLabel(attempt.outcome)} recorded for ${customerName}. Refresh priorities to confirm the queue.`)
        setError('The outcome was saved, but priorities could not refresh. Refresh priorities to confirm the queue.')
      } else if (definitiveFailure) {
        pendingAttempt.current = null
        setUncertainAttempt(false)
        setError(createError instanceof Error ? createError.message : 'Could not record the outcome.')
      } else {
        setUncertainAttempt(true)
        setError('Could not confirm this outcome. Retry save to reuse the same action ID.')
      }
    } finally {
      actionRequestInFlight.current = false
      setSubmittingAction(false)
    }
  }, [actionNote, applyAuthoritativeProjection, currentQueueRow, effectiveLoginNextPath, effectiveOverdueOnly, followUpChoice, loadRows,
    queueCardIndex, queueRows, resetActionPanel, resolvedTenantId, router,
    selectedFollowUpDate, uncertainAttempt, undoingAction])

  const handleUndoLastAction = useCallback(async () => {
    if (!lastAction || actionRequestInFlight.current || undoingAction) return
    actionRequestInFlight.current = true
    const requestSequence = ++projectionRequestSequence.current
    setUndoingAction(true)
    setError(null)
    try {
      const response = await fetch('/api/collections/action-history', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...deleteActionBody(lastAction),
          queue_overdue_only: effectiveOverdueOnly, queue_limit: 200 }),
      })
      if (response.status === 401) {
        router.replace(buildLoginPath(effectiveLoginNextPath, 'session_expired'))
        return
      }
      const payload = (await response.json().catch(() => null)) as ActionHistoryMutationApiResponse | null
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'Could not confirm Undo. Try again.')
      }

      const refreshed = payload.projection
        ? applyAuthoritativeProjection(payload.projection, effectiveOverdueOnly, requestSequence)
        : await loadRows(true)
      if (!refreshed) {
        if (payload.projection) { setLastAction(null); return }
        throw new Error('Action deleted, but priorities could not refresh. Retry Undo to check the queue.')
      }
      const nextQueueRows = selectActionableFounderContextRows(
        refreshed.rows, refreshed.actionsTakenByCustomerId
      )
      const restoredIndex = restoredCustomerIndex(nextQueueRows, lastAction.customerSourceId)
      if (restoredIndex >= 0) setQueueCardIndex(restoredIndex)
      setQueueFeedback(restoredIndex >= 0
        ? `Undid ${getOutcomeLabel(lastAction.outcome)} for ${lastAction.customerName}. Customer returned to the queue.`
        : `Undid ${getOutcomeLabel(lastAction.outcome)} for ${lastAction.customerName}. Customer is not in the current priority view.`)
      setLastAction(null)
    } catch (undoError) {
      setError(undoError instanceof Error && undoError.message.startsWith('Action deleted,')
        ? undoError.message : 'Could not confirm Undo. Retry to check the authoritative queue.')
    } finally {
      actionRequestInFlight.current = false
      setUndoingAction(false)
    }
  }, [applyAuthoritativeProjection, effectiveLoginNextPath, effectiveOverdueOnly, lastAction, loadRows, router, undoingAction])

  const handleOverrideChange = useCallback(
    async (
      customerSourceId: string,
      overrideLevel: OverrideLevel,
      currentOverrideLevel: OverrideLevel,
      persistentExclusionConfirmed = false
    ) => {
      if (overrideLevel === currentOverrideLevel) return
      if (overrideRequestsInFlight.current.has(customerSourceId)) return

      if (
        overrideLevel === 'do_not_chase' &&
        currentOverrideLevel !== 'do_not_chase' &&
        !persistentExclusionConfirmed
      ) {
        const confirmed = window.confirm(
          'Never chase removes this customer from the chase queue until you change the setting. Do not follow up until is a temporary date on a recorded outcome. Continue?'
        )
        if (!confirmed) return
      }

      const customerName =
        rows.find((row) => row.customer_source_id === customerSourceId)?.customer_name ??
        'This customer'
      const previousIndex = queueRows.findIndex(
        (row) => row.customer_source_id === customerSourceId
      )
      const previousPosition = previousIndex >= 0 ? previousIndex + 1 : null
      const previousCardIndex = queueCardIndex

      overrideRequestsInFlight.current.add(customerSourceId)
      const requestSequence = ++projectionRequestSequence.current

      setUpdatingOverrideByCustomerId((prev) => ({
        ...prev,
        [customerSourceId]: true,
      }))
      setError(null)
      setQueueFeedback(null)

      try {
        const response = await fetch('/api/collections/override', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            customer_source_id: customerSourceId,
            override_level: overrideLevel,
            tenant_id: tenantId,
            queue_overdue_only: effectiveOverdueOnly,
            queue_limit: 200,
          }),
        })

        if (response.status === 401) {
          router.replace(buildLoginPath(effectiveLoginNextPath, 'session_expired'))
          return
        }

        const payload = (await response.json().catch(() => null)) as CollectionOverrideApiResponse | null

        if (response.status === 402 && payload?.code === 'ACTION_USAGE_LIMIT_REACHED') {
          if (payload.entitlement) setEntitlement(payload.entitlement)
          setRows([])
          setUsageLimitReached(true)
          return
        }
        if (response.status === 402 && payload?.code === 'MULTI_CURRENCY_REQUIRES_PRO') {
          if (payload.entitlement) setEntitlement(payload.entitlement)
          setRows([])
          setCurrencyContext(payload.currencyContext ?? null)
          setCurrencyAccess(payload.currencyAccess ?? null)
          setUsageLimitReached(false)
          return
        }

        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || 'Failed to update customer override.')
        }

        const refreshed = payload.projection
          ? applyAuthoritativeProjection(payload.projection, effectiveOverdueOnly, requestSequence)
          : await loadRows(true)
        if (!refreshed) {
          if (payload.projection) return
          setQueueFeedback(
            `${FOUNDER_CONTEXT_OPTIONS.find((option) => option.value === overrideLevel)?.label ?? 'Customer context'} saved, but Yuohme could not refresh the queue. Try refreshing again.`
          )
          return
        }

        const nextQueueRows = selectActionableFounderContextRows(
          refreshed.rows,
          refreshed.actionsTakenByCustomerId
        )
        const nextPositionIndex = nextQueueRows.findIndex(
          (row) => row.customer_source_id === customerSourceId
        )
        const nextPosition = nextPositionIndex >= 0 ? nextPositionIndex + 1 : null

        setQueueCardIndex(
          resolveFounderContextQueueIndex({
            customerSourceId,
            previousIndex: previousCardIndex,
            nextQueueRows,
          })
        )
        setQueueFeedback(
          buildFounderContextConsequence({
            customerName,
            level: overrideLevel,
            previousPosition,
            nextPosition,
          })
        )
      } catch (updateError) {
        setError(
          updateError instanceof Error ? updateError.message : 'Failed to update customer override.'
        )
      } finally {
        overrideRequestsInFlight.current.delete(customerSourceId)
        setUpdatingOverrideByCustomerId((prev) => {
          const next = { ...prev }
          delete next[customerSourceId]
          return next
        })
      }
    },
    [applyAuthoritativeProjection, effectiveLoginNextPath, effectiveOverdueOnly, loadRows, queueCardIndex, queueRows, router, rows, tenantId]
  )

  const customersHref = tenantId
    ? `/customers?tenantId=${encodeURIComponent(tenantId)}`
    : '/customers'
  const customerInvoicesHref = (customerSourceId: string) =>
    `${customersHref}${tenantId ? '&' : '?'}customerSourceId=${encodeURIComponent(customerSourceId)}`
  const founderContextHref = `${customersHref}#customer-context`
  const accountHref = tenantId
    ? `/account?tenantId=${encodeURIComponent(tenantId)}`
    : '/account'
  const startHref = tenantId
    ? `/start?tenantId=${encodeURIComponent(tenantId)}`
    : '/start'
  const freeUsageGuidance = resolveFreeUsageGuidance(entitlement)
  const showFirstActionGuidance = shouldShowFirstActionGuidance(experience)
  const showManualQueueRefresh = experience?.hasPriorCollectionActivity === true

  const disableQueueActions =
    loading || refreshing ||
    submittingAction ||
    undoingAction ||
    Boolean(
      currentQueueRow && updatingOverrideByCustomerId[currentQueueRow.customer_source_id]
    )

  if (xeroConnectionMissing) {
    return (
      <section id={embedded ? 'collection-actions' : undefined} className="space-y-6">
        <DashboardXeroConnectionCard state="disconnected" />
      </section>
    )
  }

  return (
    <section id={embedded ? 'collection-actions' : undefined} className="space-y-6">
      {showHeaderSection && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">Priorities</h1>
            <p className="mt-1 text-sm text-text-secondary">
              Customers ranked by overdue exposure, urgency, changes from their normal payment pattern, payment recency, and the priority adjustment you choose. Score-based prompts indicate review urgency; you decide the appropriate contact or treatment.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={customersHref}
              className="inline-flex items-center justify-center rounded-md border border-border-strong bg-surface px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-subtle"
            >
              Customer summary
            </Link>
            <Link
              href={accountHref}
              className="inline-flex items-center justify-center rounded-md border border-border-strong bg-surface px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-subtle"
            >
              Account
            </Link>
          </div>
        </div>
      )}

      {freeUsageGuidance && !usageLimitReached && (
        <p className="text-xs text-text-secondary">
          {freeUsageGuidance.message}{' '}
          <Link
            href="/pricing"
            className="font-semibold text-text-primary underline decoration-gray-300 underline-offset-4 hover:text-text-primary"
          >
            {freeUsageGuidance.actionLabel}
          </Link>
        </p>
      )}

      {usageLimitReached && entitlement && (
        <Card>
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-text-primary">
                You&apos;ve used all {entitlement.freeUsageDaysLimit} free collection days.
              </h2>
              <p className="mt-1 text-sm text-text-secondary">
                Upgrade to continue using daily prioritisation and action workflows.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => router.push('/pricing')} variant="primary" size="md">
                Upgrade
              </Button>
              <Link
                href={customersHref}
                className="inline-flex items-center justify-center rounded-md border border-border-strong bg-surface px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-subtle"
              >
                Back to collections summary
              </Link>
            </div>
          </div>
        </Card>
      )}

      {multiCurrencyPlanRequired && <MultiCurrencyPlanGate />}

      {showFiltersSection && !usageLimitReached && !multiCurrencyPlanRequired && (
        <Card>
          <div className="flex flex-wrap items-end gap-4">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border-strong text-text-primary focus:ring-focus"
                checked={overdueOnly}
                onChange={(event) => setOverdueOnly(event.target.checked)}
              />
              Overdue only
            </label>
            <Button onClick={() => void loadRows(true)} variant="secondary" size="md" disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        </Card>
      )}

      {!showQueueSection &&
        !usageLimitReached &&
        !multiCurrencyPlanRequired &&
        !loading &&
        currencyHealth?.status === 'unavailable' && (
          <Card>
            <CurrencyHealthDiagnostic currencyHealth={currencyHealth} />
          </Card>
        )}

      {!usageLimitReached &&
        !multiCurrencyPlanRequired &&
        !loading &&
        currencyHealth?.status === 'degraded' && (
        <Card>
          <CurrencyHealthDiagnostic currencyHealth={currencyHealth} />
        </Card>
      )}

      {!usageLimitReached && !multiCurrencyPlanRequired && !loading && (
        <ReviewRequiredCustomers customers={reviewRequiredCustomers} customerHref={customerInvoicesHref} />
      )}

      {showQueueSection && !usageLimitReached && !multiCurrencyPlanRequired && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-text-primary">Priorities</h1>
              <p className="mt-1 text-sm text-text-secondary">{queueRows.length > 0
                ? `Next to chase · ${queueRows.length} remaining in your queue`
                : 'Work through your actionable collection queue.'}</p>
            </div>
            {showManualQueueRefresh && <Button onClick={() => void loadRows(true)} variant="ghost" className="min-h-11" disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh priorities'}
            </Button>}
          </div>

          {loading ? <QueueState title="Loading next customer…" description="Preparing your collection priorities." loading />
            : currentQueueRow ? (
            <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_16rem]">
              <Card className="min-w-0 space-y-5 shadow-none sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-default pb-3">
                  <p className="hidden text-xs text-text-secondary sm:block">Ranked by Yuohme · choose the appropriate contact method</p>
                  <div className="flex gap-2" aria-label="Queue navigation" role="group">
                    <Button variant="secondary" size="sm" className="min-h-11" onClick={() => moveQueueCard('prev')}
                      disabled={queueCardIndex === 0 || disableQueueActions}>Previous</Button>
                    <Button variant="secondary" size="sm" className="min-h-11" onClick={() => moveQueueCard('next')}
                      disabled={queueCardIndex >= queueRows.length - 1 || disableQueueActions}>Next</Button>
                  </div>
                </div>
                <div key={currentQueueRow.customer_source_id} onTouchStart={handleQueueCardTouchStart} onTouchEnd={handleQueueCardTouchEnd}>
                  <QueueCustomer position={queuePosition} count={queueRows.length}
                    name={currentQueueRow.customer_name} email={currentQueueRow.customer_email}
                    amount={formatMoney(currentQueueRow.customer_to_chase_overdue_base, organisationBaseCurrency)}
                    equivalent={showMultiCurrencyAmounts}
                    grossOverdue={currentQueueRow.overdue_outstanding_base != null ? formatMoney(currentQueueRow.overdue_outstanding_base, organisationBaseCurrency) : undefined}
                    totalOutstanding={currentQueueRow.total_outstanding_base != null ? formatMoney(currentQueueRow.total_outstanding_base, organisationBaseCurrency) : undefined}
                    disputed={currentQueueRow.effective_disputed_overdue_base_decimal != null && Number(currentQueueRow.effective_disputed_overdue_base_decimal) > 0 ? formatMoney(Number(currentQueueRow.effective_disputed_overdue_base_decimal), organisationBaseCurrency) : undefined}
                    promised={currentQueueRow.active_promised_overdue_base_decimal != null && Number(currentQueueRow.active_promised_overdue_base_decimal) > 0 ? formatMoney(Number(currentQueueRow.active_promised_overdue_base_decimal), organisationBaseCurrency) : undefined}
                    credit={currentQueueRow.customer_credit_applied_base > 0 ? formatMoney(currentQueueRow.customer_credit_applied_base, organisationBaseCurrency) : undefined}
                    nativeAmounts={showMultiCurrencyAmounts && currentQueueRow.customer_credit_applied_base === 0 ? formatInvoicedBreakdown(currentQueueRow.collectible_native_currency_breakdown, 'collectible_overdue_native') || undefined : undefined}
                    weightedDays={formatWeightedDays(currentQueueRow.weighted_avg_overdue_days)} lastPayment={formatDate(currentQueueRow.last_payment_date)}
                    recommendation={currentQueueRow.recommended_action} reason={currentQueueRow.reason}
                    breakdown={currentQueueRow.score_breakdown_lines} score={currentQueueRow.priority_score.toFixed(1)}
                    adjustment={currentQueueRow.override_level} invoicesHref={customerInvoicesHref(currentQueueRow.customer_source_id)}
                    historyHref={resolvedTenantId ? customerHistoryUrl(currentQueueRow.customer_source_id, resolvedTenantId) : undefined}
                    recentActivity={recentActivity ? <div className="pt-1 text-xs text-text-muted">
                        <p>
                          Last activity:{' '}
                          <span className="font-medium text-text-secondary">
                            {recentActivity.format === 'v1'
                              ? getOutcomeLabel(recentActivity.outcome as ActionHistoryOutcome)
                              : recentActivity.actionType
                                ? getLegacyActionLabel(recentActivity.actionType)
                                : 'Recorded action'}
                          </span>
                          {formatRelativeTimeFromNow(recentActivity.actionTimestamp)
                            ? ` · ${formatRelativeTimeFromNow(recentActivity.actionTimestamp)}`
                            : ''}
                        </p>
                        {recentActivity.format === 'legacy' && recentActivity.outcome && (
                          <p>
                            Legacy outcome: {getLegacyOutcomeLabel(recentActivity.outcome as LegacyActionOutcome)}
                          </p>
                        )}
                        {recentActivity.nextActionDate && (
                          <p>Follow up: {formatDate(recentActivity.nextActionDate)}</p>
                        )}
                        {recentActivity.format === 'v1' && recentActivity.note && (
                          <p className="max-w-md truncate" title={recentActivity.note}>
                            Note: {recentActivity.note}
                          </p>
                        )}
                      </div> : undefined}
                    contextControl={<FounderContextControl
                      customerName={currentQueueRow.customer_name}
                      value={currentQueueRow.override_level}
                      saving={Boolean(
                        updatingOverrideByCustomerId[currentQueueRow.customer_source_id]
                      )}
                      disabled={submittingAction || undoingAction}
                      manageHref={founderContextHref}
                      onChange={(level, persistentExclusionConfirmed) =>
                        void handleOverrideChange(
                          currentQueueRow.customer_source_id,
                          level,
                          currentQueueRow.override_level,
                          persistentExclusionConfirmed
                        )
                      }
                    />}>
                    <QueueActionPanel disabled={disableQueueActions} saving={submittingAction} uncertain={uncertainAttempt}
                      firstActionGuidance={showFirstActionGuidance} followUp={followUpChoice}
                      followUpLabel={followUpChoice === 'tomorrow' ? 'Tomorrow' : followUpChoice === 'two_days' ? 'In 2 days' :
                        followUpChoice === 'three_days' ? 'In 3 days' : followUpChoice === 'next_week' ? 'Next week' : customDateValue ? formatDate(customDateValue) : 'Choose date'}
                      showFollowUp={showFollowUpChoices} datesAvailable={Boolean(followUpSchedule)} minimumDate={followUpSchedule?.tomorrow}
                      customDate={customDateValue} showNote={showNote} note={actionNote}
                      onRecord={outcome => void handleRecordOutcome(outcome)} onRetry={() => void handleRecordOutcome(null, true)}
                      onToggleFollowUp={() => setShowFollowUpChoices(previous => !previous)} onFollowUp={setFollowUpChoice}
                      onCustomDate={setCustomDateValue} onShowNote={() => setShowNote(true)} onNote={setActionNote} />
                  </QueueCustomer>
                </div>
              </Card>
              <QueueOrder rows={queueRows.map(row => ({id: row.customer_source_id, name: row.customer_name,
                amount: `${formatMoney(row.customer_to_chase_overdue_base, organisationBaseCurrency)} ${showMultiCurrencyAmounts ? 'equivalent to chase' : 'to chase'}`}))}
                index={queueCardIndex} disabled={disableQueueActions} onSelect={setQueueCardIndex} />
            </div>
          ) : queueInfo?.status === 'currency_data_unavailable' ? (
            currencyHealth ? <Card className="shadow-none"><CurrencyHealthDiagnostic currencyHealth={currencyHealth} /></Card> : null
          ) : queueInfo?.status === 'currency_data_degraded' ? (
            <QueueState title="No provisional queue customers remaining" description="Review the affected customers above, then refresh Xero data to rebuild the full queue." />
          ) : error ? (
            <QueueState title="Priorities unavailable" description="Try refreshing the current queue again.">
              <Button onClick={() => void loadRows(true)} variant="secondary" className="min-h-11" disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh priorities'}</Button>
            </QueueState>
          ) : queueInfo?.status === 'complete_today' ? (
            <QueueState title="Queue complete" description="All eligible customers are actioned or deferred for today.">
              <p className="text-sm text-text-secondary">When you return, Yuohme will show the current actionable queue. Follow-up dates, invoice promises and disputes remain governed by their own records.</p>
              <Link href={customersHref} className="mt-3 inline-flex min-h-11 items-center font-semibold text-link underline underline-offset-4">Browse customers</Link>
            </QueueState>
          ) : queueInfo?.status === 'no_mapped_data' ? (
            <QueueState title="Preparing your collection priorities" description="Your Xero connection is ready. Yuohme is preparing the information needed to show who to chase first automatically.">
              <Link href={startHref} className="inline-flex min-h-11 items-center font-semibold text-link underline underline-offset-4">Resume preparation</Link>
            </QueueState>
          ) : queueInfo?.status === 'no_overdue_customers' ? (
            <QueueState title="No overdue amount to chase" description="No mapped customers currently have an overdue amount to chase." />
          ) : queueInfo?.status === 'no_eligible_customers' ? (
            <QueueState title="No eligible customers" description="No mapped customers currently meet the collection queue criteria." />
          ) : rows.some(row => row.override_level === 'do_not_chase') ? (
            <QueueState title="No customers need chasing from this queue" description="Customers marked Never chase remain excluded until you change their customer context.">
              <Link href={founderContextHref} className="inline-flex min-h-11 items-center font-semibold text-link underline underline-offset-4">Manage customer context</Link>
            </QueueState>
          ) : <QueueState title="No collection actions available" description="No customers need action from the current chase queue." />}

          {queueFeedback && <Alert variant="info" className="flex flex-wrap items-center gap-2" aria-live="polite">
            <span>{queueFeedback}</span>
            {lastAction && <Button variant="ghost" size="sm" className="min-h-11" onClick={() => void handleUndoLastAction()} disabled={disableQueueActions}>
              {undoingAction ? 'Undoing…' : 'Undo'}
            </Button>}
          </Alert>}
        </div>
      )}

      {error && <Alert variant="error">{error}</Alert>}

      {showTable &&
        !usageLimitReached &&
        !multiCurrencyPlanRequired &&
        !error &&
        !loading &&
        rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border-default bg-surface">
          <table className="min-w-full divide-y divide-border-default text-sm">
            <thead className="bg-surface-subtle text-left text-text-secondary">
              <tr>
                <th className="px-4 py-3 font-medium">Customer name</th>
                <th className="px-4 py-3 font-medium">Overdue to chase</th>
                <th className="px-4 py-3 font-medium">Actionable overdue invoices</th>
                <th className="px-4 py-3 font-medium">Weighted avg days late</th>
                <th className="px-4 py-3 font-medium">Last payment date</th>
                <th className="px-4 py-3 font-medium">Priority score</th>
                <th className="px-4 py-3 font-medium">Score-based prompt</th>
                <th className="px-4 py-3 font-medium">Customer context</th>
                <th className="px-4 py-3 font-medium">Reasoning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default text-text-primary">
              {rows.map((row) => (
                <Fragment key={row.customer_source_id}>
                  <tr>
                    <td className="px-4 py-3">
                      <p className="font-medium text-text-primary">{row.customer_name}</p>
                      <p className="text-xs text-text-secondary">{row.customer_email || '—'}</p>
                      <Link href={customerInvoicesHref(row.customer_source_id)}
                        className="mt-1 inline-block text-xs font-medium text-text-secondary underline underline-offset-2">
                        Manage invoices
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <p>
                        {formatMoney(row.customer_to_chase_overdue_base, organisationBaseCurrency)}
                        {showMultiCurrencyAmounts ? ' equivalent' : ''}
                      </p>
                      {row.customer_credit_applied_base > 0 && (
                        <p className="mt-0.5 text-xs text-text-muted">
                          {formatMoney(row.customer_credit_applied_base, organisationBaseCurrency)} Xero credit deducted
                        </p>
                      )}
                      {showMultiCurrencyAmounts && row.customer_credit_applied_base === 0 &&
                        formatInvoicedBreakdown(
                          row.collectible_native_currency_breakdown,
                          'collectible_overdue_native'
                        ) && (
                          <p className="mt-0.5 text-xs text-text-muted">
                            {formatInvoicedBreakdown(
                              row.collectible_native_currency_breakdown,
                              'collectible_overdue_native'
                            )}{' '}
                            to chase in invoice currency
                          </p>
                        )}
                    </td>
                    <td className="px-4 py-3">{row.actionable_overdue_invoices_count}</td>
                    <td className="px-4 py-3">{formatWeightedDays(row.weighted_avg_overdue_days)}</td>
                    <td className="px-4 py-3">{formatDate(row.last_payment_date)}</td>
                    <td className="px-4 py-3">{row.priority_score.toFixed(1)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getRecommendedActionClasses()}`}
                      >
                        {row.recommended_action}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        id={`table-override-${row.customer_source_id}`}
                        aria-label={`Customer context for ${row.customer_name}`}
                        className="min-h-11 rounded-md border border-border-strong bg-surface px-2 py-2 text-sm text-text-primary focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus disabled:cursor-not-allowed disabled:opacity-60"
                        value={row.override_level}
                        onChange={(event) =>
                          void handleOverrideChange(
                            row.customer_source_id,
                            event.target.value as OverrideLevel,
                            row.override_level
                          )
                        }
                        disabled={Boolean(updatingOverrideByCustomerId[row.customer_source_id])}
                      >
                        {FOUNDER_CONTEXT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        className="text-sm font-medium text-text-secondary underline-offset-2 hover:underline"
                        onClick={() => {
                          setExpandedReasonId((prev) =>
                            prev === row.customer_source_id ? null : row.customer_source_id
                          )
                        }}
                      >
                        {expandedReasonId === row.customer_source_id ? 'Hide reason' : 'View reason'}
                      </button>
                    </td>
                  </tr>
                  {expandedReasonId === row.customer_source_id && (
                    <tr>
                      <td className="bg-surface-subtle px-4 py-3 text-sm text-text-secondary" colSpan={9}>
                        <div className="space-y-2">
                          <p>{row.reason}</p>
                          <div>
                            <p className="text-xs font-semibold text-text-muted">
                              Score breakdown
                            </p>
                            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-text-secondary">
                              {(row.score_breakdown_lines ?? []).map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
