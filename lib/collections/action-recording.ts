import type { ActionHistoryOutcome } from '@/lib/collections/action-history'

export interface RecordingDraft {
  tenantId: string
  customerSourceId: string
  outcome: ActionHistoryOutcome
  nextActionDate: string | null
  note: string | null
}

export interface RecordingAttempt extends RecordingDraft {
  actionId: string
}

/** Uncertain retries reuse the ID only when the requested action is identical. */
export function recordingAttempt(
  previous: RecordingAttempt | null,
  draft: RecordingDraft,
  makeId: () => string
): RecordingAttempt {
  if (previous && previous.tenantId === draft.tenantId &&
    previous.customerSourceId === draft.customerSourceId &&
    previous.outcome === draft.outcome &&
    previous.nextActionDate === draft.nextActionDate &&
    previous.note === draft.note) return previous
  return { ...draft, actionId: makeId() }
}

export function createActionBody(attempt: RecordingAttempt) {
  return {
    action_id: attempt.actionId,
    tenant_id: attempt.tenantId,
    source_system: 'xero' as const,
    customer_source_id: attempt.customerSourceId,
    outcome: attempt.outcome,
    ...(attempt.nextActionDate ? { next_action_date: attempt.nextActionDate } : {}),
    ...(attempt.note ? { note: attempt.note } : {}),
  }
}

export function deleteActionBody(action: { actionId: string; tenantId: string; customerSourceId: string }) {
  return {
    action_id: action.actionId,
    tenant_id: action.tenantId,
    source_system: 'xero' as const,
    customer_source_id: action.customerSourceId,
  }
}

export function restoredCustomerIndex<T extends { customer_source_id: string }>(
  eligibleRows: readonly T[], customerSourceId: string
) {
  return eligibleRows.findIndex((row) => row.customer_source_id === customerSourceId)
}
