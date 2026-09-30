import type { CustomerOverrideLevel } from '@/lib/collections/prioritization'

export type QueueEligibilityReason =
  | 'eligible'
  | 'v1_deferred'
  | 'legacy_postponed'
  | 'legacy_actioned_today'
  | 'do_not_chase'
  | 'no_actionable_amount'
  | 'no_action'

export interface QueueEligibilityDecision {
  eligible: boolean
  reason: QueueEligibilityReason
  nextReturnDate: string | null
}

export function resolveQueueEligibility(input: {
  v1NextActionDate?: string | null
  legacyActionType?: string | null
  legacyNextActionDate?: string | null
  legacyActionedToday: boolean
  organisationToday: string
  legacyToday: string
  overrideLevel: CustomerOverrideLevel
  hasActionableOverdueBalance: boolean
  recommendedAction: string
}): QueueEligibilityDecision {
  let reason: QueueEligibilityReason = 'eligible'
  let nextReturnDate: string | null = null
  const legacyReturnDate = input.legacyActionType === 'postponed' &&
    input.legacyNextActionDate && input.legacyNextActionDate > input.legacyToday
      ? input.legacyNextActionDate : null
  if (input.v1NextActionDate && input.v1NextActionDate > input.organisationToday) {
    reason = 'v1_deferred'
    nextReturnDate = legacyReturnDate && legacyReturnDate > input.v1NextActionDate
      ? legacyReturnDate : input.v1NextActionDate
  } else if (legacyReturnDate) {
    reason = 'legacy_postponed'
    nextReturnDate = legacyReturnDate
  } else if (input.legacyActionedToday) {
    reason = 'legacy_actioned_today'
  } else if (input.overrideLevel === 'do_not_chase') {
    reason = 'do_not_chase'
  } else if (!input.hasActionableOverdueBalance) {
    reason = 'no_actionable_amount'
  } else if (input.recommendedAction === 'No action') {
    reason = 'no_action'
  }
  return { eligible: reason === 'eligible', reason, nextReturnDate }
}

/** Older client fixtures have no server decision; retain their previous filtering. */
export function isEligibleActiveQueueRow(row: {
  customer_source_id: string
  queue_eligibility_reason?: QueueEligibilityReason
  has_actionable_overdue_balance?: boolean
  override_level: CustomerOverrideLevel
  recommended_action: string
}, actionsTakenByCustomerId: Readonly<Record<string, unknown>>) {
  if (row.queue_eligibility_reason) {
    // Keep the existing immediate client response to a legacy contact action;
    // V1 actions never populate this legacy optimistic map.
    return row.queue_eligibility_reason === 'eligible' &&
      !actionsTakenByCustomerId[row.customer_source_id]
  }
  return !actionsTakenByCustomerId[row.customer_source_id] &&
    row.has_actionable_overdue_balance !== false &&
    row.override_level !== 'do_not_chase' &&
    row.recommended_action !== 'No action'
}
