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
type FollowUpChoice = 'tomorrow' | 'two_days' | 'three_days' | 'next_week' | 'custom'
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
      <h3 className="text-lg font-semibold text-gray-900">
        {unavailable ? 'Currency data needs refreshing' : 'Ranking uses available currency data'}
      </h3>
      <p className="mt-1 text-sm text-gray-600">
        {unavailable
          ? 'A reliable collections ranking cannot be calculated until the Xero organisation currency data is refreshed or inspected.'
          : 'Some invoice currency data could not be converted. We have ranked the remaining customers using safely valued data, and marked affected customers for review. Portfolio values are provisional and exclude those affected customers.'}
      </p>
      <p className="mt-2 text-sm text-gray-700">
        Affected invoices: {currencyHealth.affectedInvoiceCount} · Affected customers:{' '}
        {currencyHealth.affectedCustomerCount}
      </p>
      {failureReasons.length > 0 && (
        <p className="mt-1 text-xs text-gray-500">
          Reasons:{' '}
          {failureReasons
            .map(([reason, count]) => `${formatCurrencyFailureReason(reason)} (${count})`)
            .join(', ')}
        </p>
      )}
      <p className="mt-2 text-xs text-gray-500">
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
          <h3 className="text-lg font-semibold text-gray-900">Needs review</h3>
          <p className="mt-1 text-sm text-gray-600">
            These customers are not scored because at least one open invoice cannot be valued
            reliably in the organisation base currency.
          </p>
        </div>
        <div className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
          {customers.map((customer) => (
            <div key={customer.customer_source_id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-gray-900">{customer.customer_name}</p>
                  <p className="text-xs text-gray-600">{customer.customer_email || 'No email recorded'}</p>
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
              <Link href={customerHref(customer.customer_source_id)}
                className="mt-2 inline-block text-xs font-medium text-gray-700 underline underline-offset-2">
                Manage invoices
              </Link>
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
  )
}

const OUTCOME_OPTIONS: Array<{
  value: ActionHistoryOutcome
  label: string
}> = [
  { value: 'no_response', label: 'No response' },
  { value: 'message_sent', label: 'Message sent' },
  { value: 'responded_no_commitment', label: 'Responded — no commitment' },
  { value: 'reviewed_no_chase', label: 'Reviewed — no chase needed' },
]

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

function getRecommendedActionClasses(action: CollectionActionRow['recommended_action']) {
  if (action === 'Review now') {
    return 'bg-red-100 text-red-700'
  }

  if (action === 'Follow up') {
    return 'bg-amber-100 text-amber-800'
  }

  if (action === 'Monitor') {
    return 'bg-blue-100 text-blue-700'
  }

  return 'bg-gray-100 text-gray-700'
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
            <h1 className="text-2xl font-semibold text-gray-900">Today&apos;s Collection Actions</h1>
            <p className="mt-1 text-sm text-gray-600">
              Customers ranked by overdue exposure, urgency, changes from their normal payment pattern, payment recency, and the priority adjustment you choose. Score-based prompts indicate review urgency; you decide the appropriate contact or treatment.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={customersHref}
              className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
            >
              Customer summary
            </Link>
            <Link
              href={accountHref}
              className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
            >
              Account
            </Link>
          </div>
        </div>
      )}

      {freeUsageGuidance && !usageLimitReached && (
        <p className="text-xs text-gray-600">
          {freeUsageGuidance.message}{' '}
          <Link
            href="/pricing"
            className="font-semibold text-gray-800 underline decoration-gray-300 underline-offset-4 hover:text-gray-950"
          >
            {freeUsageGuidance.actionLabel}
          </Link>
        </p>
      )}

      {usageLimitReached && entitlement && (
        <Card>
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                You&apos;ve used all {entitlement.freeUsageDaysLimit} free collection days.
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                Upgrade to continue using daily prioritisation and action workflows.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => router.push('/pricing')} variant="primary" size="md">
                Upgrade
              </Button>
              <Link
                href={customersHref}
                className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
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
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
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
        <Card>
          <div className="space-y-4">
            {!loading && queueRows.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Next to chase</h3>
                  <p className="text-sm text-gray-600">{`${queueRows.length} remaining in your queue`}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Score-based prompts show review urgency, not a prescribed contact method.
                  </p>
                </div>
                {showManualQueueRefresh && (
                  <Button
                    onClick={() => void loadRows(true)}
                    variant="secondary"
                    size="sm"
                    disabled={refreshing}
                  >
                    {refreshing ? 'Refreshing…' : 'Refresh priorities'}
                  </Button>
                )}
                <div className="flex items-center gap-2">
                  {queueRows.length > 1 && (
                    <p className="text-xs text-gray-500">
                      Card {queuePosition} of {queueRows.length}
                    </p>
                  )}
                  {!loading && currentQueueRow && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => moveQueueCard('prev')}
                        disabled={queueCardIndex === 0 || disableQueueActions}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => moveQueueCard('next')}
                        disabled={queueCardIndex >= queueRows.length - 1 || disableQueueActions}
                      >
                        Next
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ) : !loading && queueInfo?.status === 'currency_data_unavailable' ? (
              currencyHealth ? (
                <CurrencyHealthDiagnostic currencyHealth={currencyHealth} />
              ) : null
            ) : !loading && queueInfo?.status === 'currency_data_degraded' ? (
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  No provisional queue customers remaining
                </h3>
                <p className="text-sm text-gray-600">
                  Review the affected customers above, then refresh Xero data to rebuild the full
                  queue.
                </p>
              </div>
            ) : !loading && error && dashboardRefresh ? (
              <Button onClick={() => void loadRows(true)} variant="secondary" size="sm" disabled={refreshing}>
                {refreshing ? 'Refreshing…' : 'Refresh priorities'}
              </Button>
            ) : !loading && queueInfo?.status === 'complete_today' ? (
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Queue complete</h3>
                <p className="text-sm text-gray-600">
                  All eligible customers are actioned or deferred for today.
                </p>
              </div>
            ) : !loading && queueInfo?.status === 'no_mapped_data' ? (
              <div className="space-y-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    Preparing your collection priorities
                  </h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Your Xero connection is ready. Yuohme is preparing the information needed to
                    show who to chase first automatically.
                  </p>
                </div>
                <Link
                  href={startHref}
                  className="inline-flex min-h-11 items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
                >
                  Resume preparation
                </Link>
              </div>
            ) : !loading && queueInfo?.status === 'no_overdue_customers' ? (
              <div>
                <h3 className="text-lg font-semibold text-gray-900">No overdue amount to chase</h3>
                <p className="text-sm text-gray-600">
                  No mapped customers currently have an overdue amount to chase.
                </p>
              </div>
            ) : !loading && queueInfo?.status === 'no_eligible_customers' ? (
              <div>
                <h3 className="text-lg font-semibold text-gray-900">No eligible customers</h3>
                <p className="text-sm text-gray-600">
                  No mapped customers currently meet the collection queue criteria.
                </p>
              </div>
            ) : !loading && rows.some((row) => row.override_level === 'do_not_chase') ? (
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-gray-900">
                  No customers need chasing from this queue
                </h3>
                <p className="text-sm text-gray-600">
                  Customers marked Never chase remain excluded until you change their customer
                  context.
                </p>
                <Link
                  href={founderContextHref}
                  className="inline-flex min-h-11 items-center text-sm font-semibold text-gray-900 underline underline-offset-4"
                >
                  Manage customer context
                </Link>
              </div>
            ) : !loading ? (
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  No collection actions available
                </h3>
                <p className="text-sm text-gray-600">
                  No customers need action from the current chase queue.
                </p>
              </div>
            ) : null}

            {loading && <p className="text-sm text-gray-600">Loading next customer…</p>}

            {!loading && !currentQueueRow && queueInfo?.status === 'complete_today' && (
              <div className="space-y-3 rounded-md border border-green-200 bg-green-50 px-3 py-3 text-sm text-green-900">
                <div className="space-y-2 rounded-md border border-green-300 bg-white px-3 py-3">
                  <p className="text-base font-semibold text-green-900">
                    You&apos;re done for today
                  </p>
                  <p className="text-sm text-green-800">
                    When you return, Yuohme will show the current actionable queue. Follow-up dates,
                    invoice promises and disputes remain governed by their own records.
                  </p>
                  <Link
                    href={customersHref}
                    className="inline-flex min-h-11 items-center text-sm font-semibold text-green-900 underline decoration-green-300 underline-offset-4 hover:text-green-950"
                  >
                    Browse customers
                  </Link>
                </div>
              </div>
            )}

            {!loading && currentQueueRow && (
              <div
                key={currentQueueRow.customer_source_id}
                className="space-y-2"
                onTouchStart={handleQueueCardTouchStart}
                onTouchEnd={handleQueueCardTouchEnd}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="text-lg font-semibold text-gray-900">{currentQueueRow.customer_name}</p>
                    <p className="text-xs text-gray-500">{currentQueueRow.customer_email || 'No email on file'}</p>
                    {recentActivity && (
                      <div className="pt-1 text-xs text-gray-500">
                        <p>
                          Last activity:{' '}
                          <span className="font-medium text-gray-700">
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
                      </div>
                    )}
                    {resolvedTenantId && <Link
                      href={customerHistoryUrl(currentQueueRow.customer_source_id, resolvedTenantId)}
                      className="mt-1 inline-flex min-h-11 items-center text-xs font-medium text-gray-700 underline underline-offset-2">
                      View full history
                    </Link>}
                  </div>
                  <div className="text-right">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                      Score-based prompt
                    </p>
                    <span
                      className={`inline-flex rounded-full px-3 py-1.5 text-sm font-semibold ${getRecommendedActionClasses(currentQueueRow.recommended_action)}`}
                    >
                      {currentQueueRow.recommended_action}
                    </span>
                  </div>
                </div>

                <div className="flex w-full items-center text-sm text-gray-600">
                  <div className="flex-1">
                    <p>
                      <span className="font-medium text-gray-900">
                        {formatMoney(
                          currentQueueRow.customer_to_chase_overdue_base,
                          organisationBaseCurrency
                        )}
                      </span>{' '}
                      {showMultiCurrencyAmounts ? 'equivalent to chase' : 'to chase'}
                    </p>
                    {currentQueueRow.customer_credit_applied_base > 0 && (
                      <p className="mt-0.5 text-xs text-gray-500">
                        {formatMoney(currentQueueRow.customer_credit_applied_base, organisationBaseCurrency)} Xero credit deducted
                      </p>
                    )}
                    {currentQueueRow.overdue_outstanding_base !== null &&
                      currentQueueRow.effective_disputed_overdue_base_decimal !== null &&
                      Number(currentQueueRow.effective_disputed_overdue_base_decimal) > 0 && (
                        <p className="mt-0.5 text-xs text-gray-500">
                          {formatMoney(currentQueueRow.overdue_outstanding_base, organisationBaseCurrency)} gross overdue
                        </p>
                      )}
                    {currentQueueRow.active_promised_overdue_base_decimal != null && Number(currentQueueRow.active_promised_overdue_base_decimal) > 0 && <p className="mt-0.5 text-xs text-gray-500">
                      {formatMoney(Number(currentQueueRow.active_promised_overdue_base_decimal), organisationBaseCurrency)} currently promised
                    </p>}
                    <Link href={customerInvoicesHref(currentQueueRow.customer_source_id)}
                      className="mt-1 inline-block text-xs font-medium text-gray-700 underline underline-offset-2">
                      Manage invoices
                    </Link>
                    {showMultiCurrencyAmounts && currentQueueRow.customer_credit_applied_base === 0 &&
                      formatInvoicedBreakdown(
                        currentQueueRow.collectible_native_currency_breakdown,
                        'collectible_overdue_native'
                      ) && (
                        <p className="mt-0.5 text-xs text-gray-500">
                          {formatInvoicedBreakdown(
                            currentQueueRow.collectible_native_currency_breakdown,
                            'collectible_overdue_native'
                          )}{' '}
                          to chase in invoice currency
                        </p>
                      )}
                  </div>
                  <p className="flex-1 text-center">
                    <span className="font-medium text-gray-900">
                      {formatWeightedDays(currentQueueRow.weighted_avg_overdue_days)}
                    </span>{' '}
                    days late
                  </p>
                  <p className="flex-1 text-right">
                    Last payment{' '}
                    <span className="font-medium text-gray-900">{formatDate(currentQueueRow.last_payment_date)}</span>
                  </p>
                </div>

                {showFirstActionGuidance && (
                  <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-3 text-sm text-sky-950">
                    <p className="font-semibold">Work the priority, then record what happened.</p>
                    <p className="mt-1 text-sky-900">
                      Recording an outcome sets the next follow-up date and updates the active queue.
                      Invoice promises and disputes are managed with their invoices.
                    </p>
                  </div>
                )}

                <div className="space-y-3 border-t border-gray-200 pt-4">
                  <p className="text-sm font-semibold text-gray-900">What happened?</p>
                  <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Record outcome">
                    {OUTCOME_OPTIONS.map((option) => (
                      <Button
                        key={option.value}
                        variant="primary"
                        size="md"
                        className="min-h-11 w-full justify-center text-center"
                        onClick={() => void handleRecordOutcome(option.value)}
                        disabled={disableQueueActions || uncertainAttempt ||
                          (followUpChoice === 'custom' && !customDateValue)}
                      >
                        {submittingAction ? 'Saving…' : option.label}
                      </Button>
                    ))}
                  </div>

                  <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                    <button type="button"
                      className="inline-flex min-h-11 w-full items-center justify-between gap-2 text-left text-sm text-gray-800 underline-offset-2 hover:underline disabled:opacity-60"
                      onClick={() => setShowFollowUpChoices((previous) => !previous)}
                      disabled={disableQueueActions || uncertainAttempt}
                      aria-expanded={showFollowUpChoices}
                    >
                      <span>Do not follow up until: <strong>{followUpChoice === 'tomorrow' ? 'Tomorrow' :
                        followUpChoice === 'two_days' ? 'In 2 days' :
                        followUpChoice === 'three_days' ? 'In 3 days' :
                        followUpChoice === 'next_week' ? 'Next week' :
                        customDateValue ? formatDate(customDateValue) : 'Choose date'}</strong></span>
                      <span className="text-xs font-medium">{showFollowUpChoices ? 'Close' : 'Change'}</span>
                    </button>
                    {showFollowUpChoices && (
                      <div className="flex flex-wrap gap-2 border-t border-gray-200 pt-2" role="group" aria-label="Follow-up timing">
                        {([
                          ['tomorrow', 'Tomorrow'], ['two_days', 'In 2 days'],
                          ['three_days', 'In 3 days'], ['next_week', 'Next week'],
                          ['custom', 'Choose date'],
                        ] as const).map(([choice, label]) => (
                          <button key={choice} type="button" aria-pressed={followUpChoice === choice}
                            onClick={() => setFollowUpChoice(choice)}
                            disabled={disableQueueActions || uncertainAttempt || !followUpSchedule}
                            className={`min-h-11 rounded-md border px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 disabled:opacity-60 ${
                              followUpChoice === choice ? 'border-gray-900 bg-gray-900 text-white' :
                                'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                            }`}
                          >{label}</button>
                        ))}
                        {followUpChoice === 'custom' && (
                          <label className="flex min-h-11 items-center gap-2 text-sm text-gray-700">
                            Date
                            <input type="date" min={followUpSchedule?.tomorrow}
                              value={customDateValue}
                              onChange={(event) => setCustomDateValue(event.target.value)}
                              disabled={disableQueueActions || uncertainAttempt}
                              className="min-h-11 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                            />
                          </label>
                        )}
                      </div>
                    )}
                  </div>

                  {!showNote ? (
                    <button type="button" className="min-h-11 text-sm font-medium text-gray-700 underline underline-offset-2"
                      onClick={() => setShowNote(true)} disabled={disableQueueActions || uncertainAttempt}>
                      Add note
                    </button>
                  ) : (
                    <label className="block space-y-1 text-sm font-medium text-gray-700">
                      Note (optional)
                      <textarea value={actionNote} onChange={(event) => setActionNote(event.target.value)}
                        maxLength={2000} rows={3} disabled={disableQueueActions || uncertainAttempt}
                        className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                        placeholder="What should you remember next time?" />
                      <span className="block text-xs font-normal text-gray-500">{actionNote.length}/2,000 characters</span>
                    </label>
                  )}
                  {uncertainAttempt && (
                    <Button variant="secondary" size="md" onClick={() => void handleRecordOutcome(null, true)}
                      disabled={disableQueueActions}>Retry save</Button>
                  )}
                </div>

                <details className="rounded-md border border-gray-200 bg-white px-3 py-2">
                  <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900">
                    Customer context
                  </summary>
                  <div className="pt-2">
                    <FounderContextControl
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
                    />
                  </div>
                </details>
              </div>
            )}

            {queueFeedback && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-green-700" role="status" aria-live="polite">
                <span>{queueFeedback}</span>
                {lastAction && (
                  <Button variant="ghost" size="sm" onClick={() => void handleUndoLastAction()}
                    disabled={disableQueueActions}>
                    {undoingAction ? 'Undoing…' : 'Undo'}
                  </Button>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {showTable &&
        !usageLimitReached &&
        !multiCurrencyPlanRequired &&
        !error &&
        !loading &&
        rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-gray-700">
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
            <tbody className="divide-y divide-gray-100 text-gray-800">
              {rows.map((row) => (
                <Fragment key={row.customer_source_id}>
                  <tr>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{row.customer_name}</p>
                      <p className="text-xs text-gray-600">{row.customer_email || '—'}</p>
                      <Link href={customerInvoicesHref(row.customer_source_id)}
                        className="mt-1 inline-block text-xs font-medium text-gray-700 underline underline-offset-2">
                        Manage invoices
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <p>
                        {formatMoney(row.customer_to_chase_overdue_base, organisationBaseCurrency)}
                        {showMultiCurrencyAmounts ? ' equivalent' : ''}
                      </p>
                      {row.customer_credit_applied_base > 0 && (
                        <p className="mt-0.5 text-xs text-gray-500">
                          {formatMoney(row.customer_credit_applied_base, organisationBaseCurrency)} Xero credit deducted
                        </p>
                      )}
                      {showMultiCurrencyAmounts && row.customer_credit_applied_base === 0 &&
                        formatInvoicedBreakdown(
                          row.collectible_native_currency_breakdown,
                          'collectible_overdue_native'
                        ) && (
                          <p className="mt-0.5 text-xs text-gray-500">
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
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getRecommendedActionClasses(row.recommended_action)}`}
                      >
                        {row.recommended_action}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        id={`table-override-${row.customer_source_id}`}
                        aria-label={`Customer context for ${row.customer_name}`}
                        className="min-h-11 rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
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
                        className="text-sm font-medium text-gray-700 underline-offset-2 hover:underline"
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
                      <td className="bg-gray-50 px-4 py-3 text-sm text-gray-700" colSpan={9}>
                        <div className="space-y-2">
                          <p>{row.reason}</p>
                          <div>
                            <p className="text-xs font-semibold text-gray-500">
                              Score breakdown
                            </p>
                            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-gray-700">
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
