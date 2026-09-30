import { promiseEventText, type PromiseEventView } from '@/lib/collections/promise-presentation'

export type CustomerHistoryKind = 'action' | 'legacy' | 'promise' | 'dispute'
export interface CustomerHistoryEvent {
  id: string
  kind: CustomerHistoryKind
  timestamp: string
  label: string
  detail: string | null
  note: string | null
  followUpDate: string | null
  invoiceSourceId: string | null
  invoiceReference: string | null
  deletable: boolean
  actionId: string | null
}
export interface RawCustomerHistoryEvent {
  event_id: string
  event_kind: string
  occurred_at: string
  payload: unknown
}
export interface CustomerHistoryCursor { timestamp: string; id: string }

const EVENT_ID = /^(?:action|legacy|promise|dispute-created|dispute-resolved):[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const DATABASE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
const OUTCOMES: Record<string, string> = {
  no_response: 'No response', message_sent: 'Message sent',
  responded_no_commitment: 'Responded — no commitment',
  reviewed_no_chase: 'Reviewed — no chase needed',
}
const PROMISE_LABELS: Record<string, string> = {
  created: 'Promise recorded', changed: 'Promise changed',
  note_changed: 'Promise note changed', cancelled: 'Promise cancelled',
  kept: 'Promise kept', missed: 'Promise missed', unclear: 'Promise outcome unclear',
}
const LEGACY_LABELS: Record<string, string> = {
  called: 'Called · legacy activity', emailed: 'Emailed · legacy activity',
  postponed: 'Postponed · legacy activity',
}
const LEGACY_OUTCOMES: Record<string, string> = {
  no_response: 'No response', spoke_to_customer: 'Spoke to customer',
  promised_to_pay: 'Promised to pay', disputed: 'Disputed',
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid history event')
  return value as Record<string, unknown>
}
function string(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}
export function encodeCustomerHistoryCursor(cursor: CustomerHistoryCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}
export function decodeCustomerHistoryCursor(value: unknown): CustomerHistoryCursor | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || value.length > 500 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Invalid history cursor')
  }
  try {
    const parsed = object(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
    const timestamp = string(parsed.timestamp), id = string(parsed.id)
    if (!timestamp || !id || !EVENT_ID.test(id) || !DATABASE_TIMESTAMP.test(timestamp) ||
      !Number.isFinite(Date.parse(timestamp))) throw Error()
    return { timestamp, id }
  } catch { throw new Error('Invalid history cursor') }
}

export function projectCustomerHistoryEvent(row: RawCustomerHistoryEvent): CustomerHistoryEvent {
  if (!EVENT_ID.test(row.event_id) || !Number.isFinite(Date.parse(row.occurred_at))) {
    throw new Error('Invalid history event')
  }
  const payload = object(row.payload)
  const base = {
    id: row.event_id, timestamp: row.occurred_at,
    detail: null as string | null, note: null as string | null,
    followUpDate: null as string | null, invoiceSourceId: null as string | null,
    invoiceReference: null as string | null, deletable: false, actionId: null as string | null,
  }
  if (row.event_kind === 'action' && row.event_id.startsWith('action:')) {
    const outcome = string(payload.outcome)
    if (!outcome || !OUTCOMES[outcome]) throw new Error('Invalid Action History outcome')
    return { ...base, kind: 'action', label: OUTCOMES[outcome], note: string(payload.note),
      followUpDate: string(payload.nextActionDate), deletable: true,
      actionId: row.event_id.slice('action:'.length) }
  }
  if (row.event_kind === 'legacy' && row.event_id.startsWith('legacy:')) {
    const actionType = string(payload.actionType)
    if (!actionType || !LEGACY_LABELS[actionType]) throw new Error('Invalid legacy action')
    const outcome = string(payload.outcome)
    return { ...base, kind: 'legacy', label: LEGACY_LABELS[actionType],
      detail: outcome ? `Legacy outcome: ${LEGACY_OUTCOMES[outcome] ?? outcome}` : null,
      followUpDate: actionType === 'postponed' ? string(payload.nextActionDate) : null }
  }
  if (row.event_kind === 'promise' && row.event_id.startsWith('promise:')) {
    const eventType = string(payload.eventType)
    if (!eventType || !PROMISE_LABELS[eventType]) throw new Error('Invalid Promise event')
    const event: PromiseEventView = { id: row.event_id.slice('promise:'.length), sequence: '0',
      type: eventType as PromiseEventView['type'], occurredAt: row.occurred_at, effectiveAt: null,
      beforeTerms: payload.beforeTerms, afterTerms: payload.afterTerms }
    return { ...base, kind: 'promise', label: PROMISE_LABELS[eventType],
      detail: ['created', 'changed', 'note_changed'].includes(eventType)
        ? promiseEventText(event, string(payload.currencyCode)) : null,
      invoiceSourceId: string(payload.invoiceSourceId) }
  }
  if (row.event_kind === 'dispute_created' && row.event_id.startsWith('dispute-created:')) {
    return { ...base, kind: 'dispute', label: 'Dispute raised',
      invoiceSourceId: string(payload.invoiceSourceId) }
  }
  if (row.event_kind === 'dispute_resolved' && row.event_id.startsWith('dispute-resolved:')) {
    return { ...base, kind: 'dispute', label: 'Dispute resolved',
      invoiceSourceId: string(payload.invoiceSourceId) }
  }
  throw new Error('Invalid history event')
}
