import { normalizeDecimalValue } from '@/lib/money/currency'

/** Public Promise presentation only; accounting evidence and baselines never enter the UI. */
export interface PromiseView {
  id: string
  invoiceSourceId?: string
  currencyCode?: string
  status: 'active' | 'kept' | 'missed' | 'unclear' | 'cancelled'
  revision?: string
  promisedAmountNative: string | null
  promisedDate?: string
  qualifyingPaidAmountNative: string | null
  note?: string | null
  createdAt?: string
  resolvedAt?: string | null
}
export interface PromiseEventView {
  id: string
  sequence: string
  type: 'created' | 'changed' | 'note_changed' | 'cancelled' | 'kept' | 'missed' | 'unclear'
  occurredAt: string
  effectiveAt: string | null
  beforeTerms: unknown
  afterTerms: unknown
}
export function promiseMoney(value: string | null | undefined, currency: string | null) {
  if (value == null) return 'Unavailable'
  if (!currency) return value
  try {
    const exact = normalizeDecimalValue(value)
    if (exact === null) return 'Unavailable'
    const [whole, fraction = ''] = exact.split('.')
    const defaults = new Intl.NumberFormat('en-GB', { style: 'currency', currency }).resolvedOptions()
    const digits = Math.max(defaults.minimumFractionDigits ?? 0, fraction.length)
    // Format the integer with BigInt and insert the exact decimal digits. Display
    // must not round a large commitment through a JavaScript number either.
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: Math.max(8, digits) })
      .formatToParts(BigInt(whole)).map(part => part.type === 'fraction' ? fraction.padEnd(digits, '0') : part.value).join('')
  } catch { return `${value} ${currency}` }
}
export function promiseDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}
export const promiseOutcome = {
  active: 'Active promise', kept: 'Promise kept', missed: 'Promise missed',
  unclear: 'Promise outcome unclear', cancelled: 'Promise cancelled',
} as const
function terms(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  return row.version === 1 && typeof row.promised_amount_native === 'string' && typeof row.promised_date === 'string'
    ? { amount: row.promised_amount_native, date: row.promised_date, note: typeof row.note === 'string' ? row.note : null } : null
}
export function promiseEventText(event: PromiseEventView, currency: string | null) {
  const before = terms(event.beforeTerms), after = terms(event.afterTerms)
  const commitment = (value: NonNullable<ReturnType<typeof terms>>) => `${promiseMoney(value.amount, currency)} by ${promiseDate(value.date)}`
  if (event.type === 'created') return after ? `Promised ${commitment(after)}` : 'Promise created'
  if (event.type === 'changed') return before && after ? `Promise changed from ${commitment(before)} to ${commitment(after)}` : 'Promise changed'
  if (event.type === 'note_changed') return after?.note ? `Note changed: ${after.note}` : 'Promise note cleared'
  return promiseOutcome[event.type]
}
