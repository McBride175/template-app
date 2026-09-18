import type { CustomerOverrideLevel } from '@/lib/collections/prioritization'

export type FounderContextLevel = CustomerOverrideLevel

export const DEFAULT_FOUNDER_CONTEXT_LEVEL: FounderContextLevel = 'normal'

export const FOUNDER_CONTEXT_OPTIONS: ReadonlyArray<{
  value: FounderContextLevel
  label: string
  description: string
}> = [
  {
    value: 'priority',
    label: 'Priority',
    description: 'Increase this customer’s priority using context that is not in Xero.',
  },
  {
    value: 'normal',
    label: 'Normal',
    description: 'Use Yuohme’s accounting-data recommendation with no adjustment.',
  },
  {
    value: 'safe',
    label: 'Safe',
    description: 'Reduce this customer’s priority using context that is not in Xero.',
  },
  {
    value: 'do_not_chase',
    label: 'Do not chase',
    description: 'Keep this customer out of the chase queue until you change this setting.',
  },
] as const

export interface FounderContextQueueRow {
  customer_source_id: string
  customer_name: string
  override_level: FounderContextLevel
  recommended_action: 'Review now' | 'Follow up' | 'Monitor' | 'No action'
}

export function selectActionableFounderContextRows<T extends FounderContextQueueRow>(
  rows: T[],
  actionsTakenByCustomerId: Record<string, unknown>
) {
  return rows.filter(
    (row) =>
      !actionsTakenByCustomerId[row.customer_source_id] &&
      row.override_level !== 'do_not_chase' &&
      row.recommended_action !== 'No action'
  )
}

export function resolveFounderContextQueueIndex({
  customerSourceId,
  previousIndex,
  nextQueueRows,
}: {
  customerSourceId: string
  previousIndex: number
  nextQueueRows: FounderContextQueueRow[]
}) {
  if (nextQueueRows.length === 0) return 0

  const updatedCustomerIndex = nextQueueRows.findIndex(
    (row) => row.customer_source_id === customerSourceId
  )
  if (updatedCustomerIndex >= 0) {
    // When the current first priority moves down, reveal the newly authoritative first
    // customer. In every other case, keep the adjusted customer in context.
    if (previousIndex === 0 && updatedCustomerIndex > 0) return 0
    return updatedCustomerIndex
  }

  return Math.min(Math.max(0, previousIndex), nextQueueRows.length - 1)
}

export function buildFounderContextConsequence({
  customerName,
  level,
  previousPosition,
  nextPosition,
}: {
  customerName: string
  level: FounderContextLevel
  previousPosition: number | null
  nextPosition: number | null
}) {
  if (level === 'do_not_chase') {
    return `Marked Do not chase — ${customerName} has been removed from the chase queue until you change this setting.`
  }

  if (level === 'normal') {
    const movement = describePositionMovement(previousPosition, nextPosition)
    return `Returned to Normal — Yuohme is ranking ${customerName} from the accounting data alone${movement}.`
  }

  if (level === 'priority' && nextPosition === 1 && previousPosition !== 1) {
    return `Marked Priority — ${customerName} is now your first priority.`
  }

  const movement = describePositionMovement(previousPosition, nextPosition)
  if (movement) {
    return `Marked ${level === 'priority' ? 'Priority' : 'Safe'} — ${customerName}${movement}.`
  }

  return `Marked ${level === 'priority' ? 'Priority' : 'Safe'} — saved for ${customerName}.`
}

function describePositionMovement(
  previousPosition: number | null,
  nextPosition: number | null
) {
  if (
    previousPosition === null ||
    nextPosition === null ||
    previousPosition === nextPosition
  ) {
    return ''
  }

  return ` moved from #${previousPosition} to #${nextPosition}`
}
