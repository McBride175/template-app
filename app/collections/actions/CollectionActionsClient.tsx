'use client'

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useMemo, useState, type TouchEvent } from 'react'
import { useRouter } from 'next/navigation'
import Card from '@/app/components/Card'
import Button from '@/app/components/Button'

interface CollectionActionRow {
  customer_source_id: string
  customer_name: string
  customer_email: string | null
  overdue_outstanding: number
  total_outstanding: number
  overdue_invoices_count: number
  open_invoices_count: number
  weighted_avg_overdue_days: number
  last_payment_date: string | null
  override_level: OverrideLevel
  override_multiplier: number
  base_score: number
  final_score: number
  priority_score: number
  recommended_action: 'Call immediately' | 'Email reminder' | 'Monitor' | 'No action'
  reason: string
  score_breakdown_lines: string[]
  currency_code: string | null
  last_action_type: 'called' | 'emailed' | 'postponed' | null
  last_action_outcome: 'no_response' | 'spoke_to_customer' | 'promised_to_pay' | 'disputed' | null
  last_action_timestamp: string | null
}

interface CollectionActionsApiResponse {
  ok?: boolean
  code?: string
  entitlement?: ActionsEntitlement
  rows?: CollectionActionRow[]
  actionsTakenByCustomerId?: Record<string, ActionTakenLog>
  queue?: CollectionQueueInfo
  error?: string
}

type CollectionQueueStatus =
  | 'ready'
  | 'no_mapped_data'
  | 'no_overdue_customers'
  | 'no_eligible_customers'
  | 'complete_today'

interface CollectionQueueInfo {
  status: CollectionQueueStatus
  mappedCustomerCount: number
  mappedInvoiceCount: number
  mappedPaymentCount: number
  eligibleCustomerCount: number
  suppressedCustomerCount: number
  actionedTodayCount: number
  remainingCustomerCount: number
  returnedCustomerCount: number
}

interface ActionsEntitlement {
  plan: 'free' | 'paid'
  isPaid: boolean
  tenantId: string | null
  usageDaysConsumed: number
  usageDaysRemaining: number | null
  freeUsageDaysLimit: number
  hasActionsAccess: boolean
}

interface CollectionOverrideApiResponse {
  ok?: boolean
  error?: string
}

interface CollectionActionMutationApiResponse {
  ok?: boolean
  action_id?: string
  error?: string
}

interface CollectionActionsClientProps {
  embedded?: boolean
  showHeader?: boolean
  showFilters?: boolean
  showQueue?: boolean
  showTable?: boolean
  loginNextPath?: string
  tenantId?: string | null
}

type ActionType = 'called' | 'emailed' | 'postponed'
type ActionOutcome = 'no_response' | 'spoke_to_customer' | 'promised_to_pay' | 'disputed'
type DetailPanel = 'none' | 'call_outcome' | 'detail_postpone'
type OverrideLevel = 'safe' | 'normal' | 'priority' | 'do_not_chase'

interface ActionTakenLog {
  type: ActionType
  takenAtIso: string
  outcome: ActionOutcome | null
  nextActionDate: string | null
  actionId: string
}

interface LastActionState {
  actionId: string
  customerSourceId: string
}

interface QuickDatePickerProps {
  selectedDate: string | null
  customDateValue: string
  onCustomDateChange: (value: string) => void
  onSelectDate: (dateIso: string) => void
  disabled?: boolean
  customButtonLabel?: string
}

const OUTCOME_OPTIONS: Array<{
  value: ActionOutcome
  label: string
}> = [
  { value: 'no_response', label: 'No response' },
  { value: 'spoke_to_customer', label: 'Spoke to customer' },
  { value: 'promised_to_pay', label: 'Promised to pay' },
  { value: 'disputed', label: 'Disputed' },
]

const OVERRIDE_OPTIONS: Array<{ value: OverrideLevel; label: string }> = [
  { value: 'safe', label: 'Safe' },
  { value: 'normal', label: 'Normal' },
  { value: 'priority', label: 'Priority' },
  { value: 'do_not_chase', label: 'Do not chase' },
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
  if (action === 'Call immediately') {
    return 'bg-red-100 text-red-700'
  }

  if (action === 'Email reminder') {
    return 'bg-amber-100 text-amber-800'
  }

  if (action === 'Monitor') {
    return 'bg-blue-100 text-blue-700'
  }

  return 'bg-gray-100 text-gray-700'
}

function getOverridePillClasses(selected: boolean) {
  if (selected) {
    return 'bg-gray-100 text-gray-900'
  }

  return 'bg-white text-gray-600 hover:bg-gray-50'
}

function getActionLabel(actionType: ActionType) {
  if (actionType === 'called') return 'Called'
  if (actionType === 'emailed') return 'Emailed'
  return 'Postponed'
}

function getOutcomeLabel(outcome: ActionOutcome) {
  if (outcome === 'no_response') return 'No response'
  if (outcome === 'spoke_to_customer') return 'Spoke to customer'
  if (outcome === 'promised_to_pay') return 'Promised to pay'
  return 'Disputed'
}

function formatLocalDateIso(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getDateOffsetIso(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return formatLocalDateIso(date)
}

function getQuickDateButtonClasses(selected: boolean) {
  if (selected) {
    return 'rounded-md border border-gray-900 bg-gray-100 px-2 py-1 text-xs font-medium text-gray-900'
  }

  return 'rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50'
}

function QuickDatePicker({
  selectedDate,
  customDateValue,
  onCustomDateChange,
  onSelectDate,
  disabled = false,
  customButtonLabel = 'Use custom date',
}: QuickDatePickerProps) {
  const tomorrowIso = getDateOffsetIso(1)
  const nextWeekIso = getDateOffsetIso(7)
  const todayIso = getDateOffsetIso(0)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={getQuickDateButtonClasses(selectedDate === tomorrowIso)}
          onClick={() => onSelectDate(tomorrowIso)}
          disabled={disabled}
        >
          Tomorrow
        </button>
        <button
          type="button"
          className={getQuickDateButtonClasses(selectedDate === nextWeekIso)}
          onClick={() => onSelectDate(nextWeekIso)}
          disabled={disabled}
        >
          Next week
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          min={todayIso}
          value={customDateValue}
          onChange={(event) => onCustomDateChange(event.target.value)}
          disabled={disabled}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            if (!customDateValue) return
            onSelectDate(customDateValue)
          }}
          disabled={disabled || !customDateValue}
        >
          {customButtonLabel}
        </Button>
      </div>
    </div>
  )
}

export default function CollectionActionsClient({
  embedded = false,
  showHeader,
  showFilters,
  showQueue,
  showTable = true,
  loginNextPath,
  tenantId = null,
}: CollectionActionsClientProps) {
  const router = useRouter()
  const [rows, setRows] = useState<CollectionActionRow[]>([])
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [expandedReasonId, setExpandedReasonId] = useState<string | null>(null)
  const [actionsTakenByCustomerId, setActionsTakenByCustomerId] = useState<Record<string, ActionTakenLog>>({})
  const [updatingOverrideByCustomerId, setUpdatingOverrideByCustomerId] = useState<
    Record<string, boolean>
  >({})
  const [queueCardIndex, setQueueCardIndex] = useState(0)
  const [queueFeedback, setQueueFeedback] = useState<string | null>(null)
  const [touchStartX, setTouchStartX] = useState<number | null>(null)
  const [detailPanel, setDetailPanel] = useState<DetailPanel>('none')
  const [selectedOutcome, setSelectedOutcome] = useState<ActionOutcome | null>(null)
  const [selectedOutcomeDate, setSelectedOutcomeDate] = useState<string | null>(null)
  const [customDateValue, setCustomDateValue] = useState<string>(() => getDateOffsetIso(1))
  const [submittingAction, setSubmittingAction] = useState(false)
  const [undoingAction, setUndoingAction] = useState(false)
  const [lastAction, setLastAction] = useState<LastActionState | null>(null)
  const [restoreCustomerSourceId, setRestoreCustomerSourceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [entitlement, setEntitlement] = useState<ActionsEntitlement | null>(null)
  const [usageLimitReached, setUsageLimitReached] = useState(false)
  const [queueInfo, setQueueInfo] = useState<CollectionQueueInfo | null>(null)
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

  const resetActionPanel = useCallback(() => {
    setDetailPanel('none')
    setSelectedOutcome(null)
    setSelectedOutcomeDate(null)
    setCustomDateValue(getDateOffsetIso(1))
  }, [])

  const loadRows = useCallback(
    async (manualRefresh: boolean) => {
      if (manualRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }

      setError(null)

      try {
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

        if (response.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(effectiveLoginNextPath)}`)
          return
        }

        const payload = (await response.json().catch(() => null)) as CollectionActionsApiResponse | null
        if (payload?.entitlement) {
          setEntitlement(payload.entitlement)
        }

        if (payload?.code === 'ACTION_USAGE_LIMIT_REACHED') {
          setRows([])
          setActionsTakenByCustomerId({})
          setQueueInfo(null)
          setUsageLimitReached(true)
          return
        }

        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || 'Failed to load collection actions.')
        }

        setUsageLimitReached(false)
        const nextRows = payload.rows ?? []
        setRows(
          effectiveOverdueOnly
            ? nextRows.filter((row) => row.overdue_invoices_count > 0 || row.overdue_outstanding > 0)
            : nextRows
        )
        setActionsTakenByCustomerId(payload.actionsTakenByCustomerId ?? {})
        setQueueInfo(payload.queue ?? null)
      } catch (fetchError) {
        setError(
          fetchError instanceof Error ? fetchError.message : 'Failed to load collection actions.'
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [effectiveLoginNextPath, effectiveOverdueOnly, router, tenantId]
  )

  useEffect(() => {
    void loadRows(false)
  }, [loadRows])

  const queueRows = useMemo(
    () => rows.filter((row) => !actionsTakenByCustomerId[row.customer_source_id]),
    [actionsTakenByCustomerId, rows]
  )
  const todayActionSummary = useMemo(() => {
    const summary: Record<ActionType, number> = {
      called: 0,
      emailed: 0,
      postponed: 0,
    }

    for (const action of Object.values(actionsTakenByCustomerId)) {
      summary[action.type] += 1
    }

    return {
      called: summary.called,
      emailed: summary.emailed,
      postponed: summary.postponed,
      total: summary.called + summary.emailed + summary.postponed,
    }
  }, [actionsTakenByCustomerId])

  const currentQueueRow = queueRows[queueCardIndex] ?? null
  const queuePosition = currentQueueRow ? queueCardIndex + 1 : 0
  const currentQueueRowLastActionRelativeTime = formatRelativeTimeFromNow(
    currentQueueRow?.last_action_timestamp ?? null
  )

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

  const logAction = useCallback(
    async ({
      customerSourceId,
      actionType,
      outcome,
      nextActionDate,
      useOutcomeRoute,
    }: {
      customerSourceId: string
      actionType: ActionType
      outcome: ActionOutcome | null
      nextActionDate: string | null
      useOutcomeRoute: boolean
    }) => {
      const requestBody: Record<string, unknown> = {
        customer_source_id: customerSourceId,
        action_type: actionType,
      }

      if (tenantId) {
        requestBody.tenant_id = tenantId
      }

      if (useOutcomeRoute && outcome) {
        requestBody.outcome = outcome
      }

      if (nextActionDate) {
        requestBody.next_action_date = nextActionDate
      }

      const response = await fetch(
        useOutcomeRoute ? '/api/collections/action-with-outcome' : '/api/collections/action',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify(requestBody),
        }
      )

      if (response.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(effectiveLoginNextPath)}`)
        throw new Error('Unauthorized')
      }

      const payload =
        (await response.json().catch(() => null)) as CollectionActionMutationApiResponse | null

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'Failed to log action.')
      }

      if (typeof payload.action_id !== 'string') {
        throw new Error('Action logged without an action id.')
      }

      return payload.action_id
    },
    [effectiveLoginNextPath, router, tenantId]
  )

  const applyLoggedAction = useCallback(
    ({
      customerSourceId,
      customerName,
      actionType,
      outcome,
      nextActionDate,
      actionId,
    }: {
      customerSourceId: string
      customerName: string
      actionType: ActionType
      outcome: ActionOutcome | null
      nextActionDate: string | null
      actionId: string
    }) => {
      setActionsTakenByCustomerId((prev) => ({
        ...prev,
        [customerSourceId]: {
          type: actionType,
          takenAtIso: new Date().toISOString(),
          outcome,
          nextActionDate,
          actionId,
        },
      }))
      setQueueInfo((prev) => {
        if (!prev) return prev

        const remainingCustomerCount = Math.max(0, prev.remainingCustomerCount - 1)
        return {
          ...prev,
          status:
            prev.eligibleCustomerCount > 0 && remainingCustomerCount === 0
              ? 'complete_today'
              : prev.status,
          actionedTodayCount: prev.actionedTodayCount + 1,
          remainingCustomerCount,
        }
      })

      setLastAction({
        actionId,
        customerSourceId,
      })

      const baseLabel = getActionLabel(actionType)
      const outcomeSuffix = outcome ? ` (${getOutcomeLabel(outcome)})` : ''
      const dateSuffix = nextActionDate ? ` Next action ${formatDate(nextActionDate)}.` : ''
      setQueueFeedback(`Logged ${baseLabel}${outcomeSuffix} for ${customerName}.${dateSuffix}`)

      setExpandedReasonId((prev) => (prev === customerSourceId ? null : prev))
      setQueueCardIndex((prev) => Math.max(0, Math.min(prev, queueRows.length - 2)))
      setRestoreCustomerSourceId(null)
      resetActionPanel()
    },
    [queueRows.length, resetActionPanel]
  )

  const handleFastAction = useCallback(
    async (actionType: 'called' | 'emailed') => {
      if (!currentQueueRow || submittingAction || undoingAction) return

      setSubmittingAction(true)
      setError(null)

      try {
        const actionId = await logAction({
          customerSourceId: currentQueueRow.customer_source_id,
          actionType,
          outcome: null,
          nextActionDate: null,
          useOutcomeRoute: false,
        })

        applyLoggedAction({
          customerSourceId: currentQueueRow.customer_source_id,
          customerName: currentQueueRow.customer_name,
          actionType,
          outcome: null,
          nextActionDate: null,
          actionId,
        })
      } catch (createError) {
        setError(createError instanceof Error ? createError.message : 'Failed to log action.')
      } finally {
        setSubmittingAction(false)
      }
    },
    [applyLoggedAction, currentQueueRow, logAction, submittingAction, undoingAction]
  )

  const handlePostponeWithDate = useCallback(
    async (nextActionDate: string) => {
      if (!currentQueueRow || submittingAction || undoingAction) return

      setSubmittingAction(true)
      setError(null)

      try {
        const actionId = await logAction({
          customerSourceId: currentQueueRow.customer_source_id,
          actionType: 'postponed',
          outcome: null,
          nextActionDate,
          useOutcomeRoute: false,
        })

        applyLoggedAction({
          customerSourceId: currentQueueRow.customer_source_id,
          customerName: currentQueueRow.customer_name,
          actionType: 'postponed',
          outcome: null,
          nextActionDate,
          actionId,
        })
      } catch (createError) {
        setError(createError instanceof Error ? createError.message : 'Failed to log action.')
      } finally {
        setSubmittingAction(false)
      }
    },
    [applyLoggedAction, currentQueueRow, logAction, submittingAction, undoingAction]
  )

  const selectedOutcomeActionType: 'called' | null =
    detailPanel === 'call_outcome' ? 'called' : null

  const handleSubmitActionWithOutcome = useCallback(async () => {
    if (
      !currentQueueRow ||
      !selectedOutcomeActionType ||
      !selectedOutcome ||
      submittingAction ||
      undoingAction
    ) {
      return
    }

    if (selectedOutcome === 'promised_to_pay' && !selectedOutcomeDate) {
      setError('Select a promised to pay date before continuing.')
      return
    }

    setSubmittingAction(true)
    setError(null)

    try {
      const nextActionDate = selectedOutcome === 'promised_to_pay' ? selectedOutcomeDate : null
      const actionId = await logAction({
        customerSourceId: currentQueueRow.customer_source_id,
        actionType: selectedOutcomeActionType,
        outcome: selectedOutcome,
        nextActionDate,
        useOutcomeRoute: true,
      })

      applyLoggedAction({
        customerSourceId: currentQueueRow.customer_source_id,
        customerName: currentQueueRow.customer_name,
        actionType: selectedOutcomeActionType,
        outcome: selectedOutcome,
        nextActionDate,
        actionId,
      })
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to log action.')
    } finally {
      setSubmittingAction(false)
    }
  }, [
    applyLoggedAction,
    currentQueueRow,
    logAction,
    selectedOutcome,
    selectedOutcomeActionType,
    selectedOutcomeDate,
    submittingAction,
    undoingAction,
  ])

  const handleUndoLastAction = useCallback(async () => {
    if (!lastAction || submittingAction || undoingAction) return

    setUndoingAction(true)
    setError(null)

    try {
      const response = await fetch('/api/collections/action', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          action_id: lastAction.actionId,
        }),
      })

      if (response.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(effectiveLoginNextPath)}`)
        return
      }

      const payload = (await response.json().catch(() => null)) as CollectionActionMutationApiResponse | null

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'Failed to undo action.')
      }

      const restoredCustomerName =
        rows.find((row) => row.customer_source_id === lastAction.customerSourceId)?.customer_name ??
        null

      setActionsTakenByCustomerId((prev) => {
        const next = { ...prev }
        delete next[lastAction.customerSourceId]
        return next
      })
      setQueueInfo((prev) =>
        prev
          ? {
              ...prev,
              status: 'ready',
              actionedTodayCount: Math.max(0, prev.actionedTodayCount - 1),
              remainingCustomerCount: prev.remainingCustomerCount + 1,
            }
          : prev
      )

      setRestoreCustomerSourceId(lastAction.customerSourceId)
      setQueueFeedback(
        restoredCustomerName
          ? `Undid last action for ${restoredCustomerName}.`
          : 'Undid last action.'
      )
      setLastAction(null)
      resetActionPanel()
    } catch (undoError) {
      setError(undoError instanceof Error ? undoError.message : 'Failed to undo action.')
    } finally {
      setUndoingAction(false)
    }
  }, [effectiveLoginNextPath, lastAction, resetActionPanel, router, rows, submittingAction, undoingAction])

  const handleOverrideChange = useCallback(
    async (
      customerSourceId: string,
      overrideLevel: OverrideLevel,
      currentOverrideLevel: OverrideLevel
    ) => {
      if (overrideLevel === currentOverrideLevel) return

      if (overrideLevel === 'do_not_chase' && currentOverrideLevel !== 'do_not_chase') {
        const confirmed = window.confirm(
          'Mark this customer as "Do not chase"? This sets their priority score to 0 and moves them to the bottom.'
        )
        if (!confirmed) return
      }

      setUpdatingOverrideByCustomerId((prev) => ({
        ...prev,
        [customerSourceId]: true,
      }))
      setError(null)

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
          }),
        })

        if (response.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(effectiveLoginNextPath)}`)
          return
        }

        const payload = (await response.json().catch(() => null)) as CollectionOverrideApiResponse | null

        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || 'Failed to update customer override.')
        }

        await loadRows(true)
      } catch (updateError) {
        setError(
          updateError instanceof Error ? updateError.message : 'Failed to update customer override.'
        )
      } finally {
        setUpdatingOverrideByCustomerId((prev) => {
          const next = { ...prev }
          delete next[customerSourceId]
          return next
        })
      }
    },
    [effectiveLoginNextPath, loadRows, router, tenantId]
  )

  const customersHref = tenantId
    ? `/customers?tenantId=${encodeURIComponent(tenantId)}`
    : '/customers'
  const disputesHref = tenantId
    ? `/disputes?tenantId=${encodeURIComponent(tenantId)}`
    : '/disputes'
  const accountHref = tenantId
    ? `/account?tenantId=${encodeURIComponent(tenantId)}`
    : '/account'
  const freeUsageIndicator =
    entitlement && !entitlement.isPaid && !usageLimitReached
      ? `Free collection days used: ${entitlement.usageDaysConsumed} / ${entitlement.freeUsageDaysLimit}`
      : null

  const disableQueueActions = submittingAction || undoingAction

  return (
    <section id={embedded ? 'collection-actions' : undefined} className="space-y-6">
      {showHeaderSection && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Today&apos;s Collection Actions</h1>
            <p className="mt-1 text-sm text-gray-600">
              Prioritised customer-level actions ranked by exposure, urgency, and recent payment behaviour.
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

      {freeUsageIndicator && (
        <p className="text-xs font-medium text-gray-500">{freeUsageIndicator}</p>
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

      {showFiltersSection && !usageLimitReached && (
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

      {showQueueSection && !usageLimitReached && (
        <Card>
          <div className="space-y-4">
            {!loading && queueRows.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Next to chase</h3>
                  <p className="text-sm text-gray-600">{`${queueRows.length} remaining in your queue`}</p>
                </div>
                <Button
                  onClick={() => void loadRows(true)}
                  variant="secondary"
                  size="sm"
                  disabled={refreshing}
                >
                  {refreshing ? 'Refreshing…' : 'Refresh'}
                </Button>
                <div className="flex items-center gap-2">
                  {queueRows.length > 1 && (
                    <p className="text-xs text-gray-500">
                      Card {queuePosition} of {queueRows.length}
                    </p>
                  )}
                  {!loading && lastAction && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleUndoLastAction()}
                      disabled={disableQueueActions}
                    >
                      {undoingAction ? 'Undoing…' : 'Undo'}
                    </Button>
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
            ) : !loading && queueInfo?.status === 'complete_today' ? (
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Queue complete</h3>
                <p className="text-sm text-gray-600">
                  All eligible customers are actioned or deferred for today.
                </p>
              </div>
            ) : !loading && queueInfo?.status === 'no_mapped_data' ? (
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Collections data not ready</h3>
                <p className="text-sm text-gray-600">
                  Sync Xero to load and map customer and invoice data.
                </p>
              </div>
            ) : !loading && queueInfo?.status === 'no_overdue_customers' ? (
              <div>
                <h3 className="text-lg font-semibold text-gray-900">No overdue customers</h3>
                <p className="text-sm text-gray-600">
                  No mapped customers currently have overdue receivables.
                </p>
              </div>
            ) : !loading && queueInfo?.status === 'no_eligible_customers' ? (
              <div>
                <h3 className="text-lg font-semibold text-gray-900">No eligible customers</h3>
                <p className="text-sm text-gray-600">
                  No mapped customers currently meet the collection queue criteria.
                </p>
              </div>
            ) : !loading ? (
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  No collection actions available
                </h3>
                <p className="text-sm text-gray-600">Refresh to check for queue updates.</p>
              </div>
            ) : null}

            {loading && <p className="text-sm text-gray-600">Loading next customer…</p>}

            {!loading && !currentQueueRow && queueInfo?.status === 'complete_today' && (
              <div className="space-y-3 rounded-md border border-green-200 bg-green-50 px-3 py-3 text-sm text-green-900">
                <div className="rounded-md border border-green-200 bg-white/80 px-2.5 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-green-700">
                    Today&apos;s action summary
                  </p>
                  <p className="mt-1 text-xs text-green-900">
                    Called <span className="font-semibold">{todayActionSummary.called}</span> · Emailed{' '}
                    <span className="font-semibold">{todayActionSummary.emailed}</span> · Postponed{' '}
                    <span className="font-semibold">{todayActionSummary.postponed}</span> · Total{' '}
                    <span className="font-semibold">{todayActionSummary.total}</span>
                  </p>
                </div>

                <div className="space-y-3 rounded-md border border-green-300 bg-white px-3 py-3">
                  <p className="text-base font-semibold text-green-900">Next steps</p>
                  <p className="text-sm text-green-800">
                    Review customer summary and disputes section before ending today&apos;s run.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Link
                      href={customersHref}
                      className="inline-flex min-h-11 items-center justify-center rounded-md border border-green-400 bg-green-50 px-3 py-2 text-sm font-semibold text-green-900 hover:bg-green-100"
                    >
                      Review customer summary
                    </Link>
                    <Link
                      href={disputesHref}
                      className="inline-flex min-h-11 items-center justify-center rounded-md border border-green-400 bg-green-50 px-3 py-2 text-sm font-semibold text-green-900 hover:bg-green-100"
                    >
                      Review disputes section
                    </Link>
                  </div>
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
                    {currentQueueRow.last_action_type && (
                      <div className="pt-1 text-xs text-gray-500">
                        <p>
                          Last action:{' '}
                          <span className="font-medium text-gray-700">
                            {getActionLabel(currentQueueRow.last_action_type)}
                          </span>
                          {currentQueueRowLastActionRelativeTime
                            ? ` (${currentQueueRowLastActionRelativeTime})`
                            : ''}
                        </p>
                        {currentQueueRow.last_action_outcome && (
                          <p>
                            Outcome:{' '}
                            <span className="font-medium text-gray-700">
                              {getOutcomeLabel(currentQueueRow.last_action_outcome)}
                            </span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div>
                    <span
                      className={`inline-flex rounded-full px-3 py-1.5 text-sm font-semibold ${getRecommendedActionClasses(currentQueueRow.recommended_action)}`}
                    >
                      {currentQueueRow.recommended_action}
                    </span>
                  </div>
                </div>

                <div className="flex w-full items-center text-sm text-gray-600">
                  <p className="flex-1">
                    <span className="font-medium text-gray-900">
                      {formatMoney(currentQueueRow.overdue_outstanding, currentQueueRow.currency_code)}
                    </span>{' '}
                    overdue
                  </p>
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

                <div className="grid gap-3 pt-2 sm:grid-cols-2">
                  <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Fast actions</p>
                    <Button
                      onClick={() => void handleFastAction('called')}
                      variant="primary"
                      size="md"
                      className="w-full"
                      disabled={disableQueueActions}
                    >
                      {submittingAction ? 'Saving…' : 'Called'}
                    </Button>
                    <Button
                      onClick={() => void handleFastAction('emailed')}
                      variant="primary"
                      size="md"
                      className="w-full"
                      disabled={disableQueueActions}
                    >
                      {submittingAction ? 'Saving…' : 'Emailed'}
                    </Button>
                    <Button
                      onClick={() => {
                        void handlePostponeWithDate(getDateOffsetIso(1))
                      }}
                      variant="ghost"
                      size="sm"
                      className="w-full justify-center"
                      disabled={disableQueueActions}
                    >
                      Postpone 1 day
                    </Button>
                  </div>

                  <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">With detail</p>
                    <Button
                      onClick={() => {
                        if (disableQueueActions) return
                        setDetailPanel((prev) =>
                          prev === 'call_outcome' ? 'none' : 'call_outcome'
                        )
                        setSelectedOutcome(null)
                        setSelectedOutcomeDate(null)
                        setCustomDateValue(getDateOffsetIso(1))
                      }}
                      variant="secondary"
                      size="md"
                      className="w-full"
                      disabled={disableQueueActions}
                    >
                      Call + outcome
                    </Button>
                    <Button
                      onClick={() => {
                        if (disableQueueActions) return
                        setDetailPanel((prev) =>
                          prev === 'detail_postpone' ? 'none' : 'detail_postpone'
                        )
                        setSelectedOutcome(null)
                        setSelectedOutcomeDate(null)
                        setCustomDateValue(getDateOffsetIso(1))
                      }}
                      variant="secondary"
                      size="sm"
                      className="w-full justify-center"
                      disabled={disableQueueActions}
                    >
                      Postpone + date
                    </Button>
                  </div>
                </div>

                {detailPanel === 'detail_postpone' && (
                  <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Postpone + date</p>
                      <p className="text-xs text-gray-600">Choose the next action date.</p>
                    </div>
                    <QuickDatePicker
                      selectedDate={null}
                      customDateValue={customDateValue}
                      onCustomDateChange={setCustomDateValue}
                      onSelectDate={(dateIso) => {
                        void handlePostponeWithDate(dateIso)
                      }}
                      disabled={disableQueueActions}
                      customButtonLabel="Postpone to date"
                    />
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={resetActionPanel}
                        disabled={disableQueueActions}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {detailPanel === 'call_outcome' && (
                  <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Call + outcome</p>
                      <p className="text-xs text-gray-600">
                        Optional structured detail. Choose an outcome and continue.
                      </p>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      {OUTCOME_OPTIONS.map((option) => {
                        const selected = selectedOutcome === option.value

                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                              setSelectedOutcome(option.value)
                              if (option.value !== 'promised_to_pay') {
                                setSelectedOutcomeDate(null)
                              } else {
                                setSelectedOutcomeDate(getDateOffsetIso(1))
                              }
                            }}
                            disabled={disableQueueActions}
                            className={`rounded-md border px-3 py-2 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                              selected
                                ? 'border-gray-900 bg-white text-gray-900'
                                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            {option.label}
                          </button>
                        )
                      })}
                    </div>

                    {selectedOutcome === 'promised_to_pay' && (
                      <div className="space-y-2 rounded-md border border-gray-200 bg-white p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Promised to pay date (required)
                        </p>
                        <QuickDatePicker
                          selectedDate={selectedOutcomeDate}
                          customDateValue={customDateValue}
                          onCustomDateChange={setCustomDateValue}
                          onSelectDate={(dateIso) => {
                            setSelectedOutcomeDate(dateIso)
                          }}
                          disabled={disableQueueActions}
                        />
                        {selectedOutcomeDate && (
                          <p className="text-xs text-gray-600">
                            Selected date: {formatDate(selectedOutcomeDate)}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={resetActionPanel}
                        disabled={disableQueueActions}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => void handleSubmitActionWithOutcome()}
                        disabled={
                          disableQueueActions ||
                          !selectedOutcome ||
                          (selectedOutcome === 'promised_to_pay' && !selectedOutcomeDate)
                        }
                      >
                        {submittingAction ? 'Saving…' : 'Log action'}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="space-y-1 pt-0.5">
                  <p className="text-xs text-gray-500">Adjust priority</p>
                  <div className="flex items-center gap-1">
                    {OVERRIDE_OPTIONS.map((option) => {
                      const selected = currentQueueRow.override_level === option.value
                      const updating = Boolean(
                        updatingOverrideByCustomerId[currentQueueRow.customer_source_id]
                      )

                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() =>
                            void handleOverrideChange(
                              currentQueueRow.customer_source_id,
                              option.value,
                              currentQueueRow.override_level
                            )
                          }
                          disabled={updating}
                          className={`inline-flex flex-1 items-center justify-center rounded px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${getOverridePillClasses(selected)}`}
                        >
                          {option.label}
                        </button>
                      )
                    })}
                  </div>
                  <p className="min-h-4 text-xs text-gray-500">
                    {updatingOverrideByCustomerId[currentQueueRow.customer_source_id]
                      ? 'Updating priority…'
                      : ' '}
                  </p>
                </div>
              </div>
            )}

            {queueFeedback && <p className="text-sm text-green-700">{queueFeedback}</p>}
          </div>
        </Card>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {showTable && !usageLimitReached && !error && !loading && rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-gray-700">
              <tr>
                <th className="px-4 py-3 font-medium">Customer name</th>
                <th className="px-4 py-3 font-medium">Overdue outstanding</th>
                <th className="px-4 py-3 font-medium">Overdue invoices</th>
                <th className="px-4 py-3 font-medium">Weighted avg days late</th>
                <th className="px-4 py-3 font-medium">Last payment date</th>
                <th className="px-4 py-3 font-medium">Priority score</th>
                <th className="px-4 py-3 font-medium">Recommended action</th>
                <th className="px-4 py-3 font-medium">Override</th>
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
                    </td>
                    <td className="px-4 py-3">
                      {formatMoney(row.overdue_outstanding, row.currency_code)}
                    </td>
                    <td className="px-4 py-3">{row.overdue_invoices_count}</td>
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
                        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
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
                        {OVERRIDE_OPTIONS.map((option) => (
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
                              {row.score_breakdown_lines.map((line) => (
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
