export const ACTION_HISTORY_OUTCOMES = [
  'no_response',
  'message_sent',
  'responded_no_commitment',
  'reviewed_no_chase',
] as const

export type ActionHistoryOutcome = (typeof ACTION_HISTORY_OUTCOMES)[number]
export const ACTION_HISTORY_SOURCE_SYSTEM = 'xero'
export const ACTION_HISTORY_MAX_NOTE_LENGTH = 2000
export const ACTION_HISTORY_MAX_PAGE_SIZE = 50

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class ActionHistoryInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActionHistoryInputError'
  }
}

export function identity(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 255) {
    throw new ActionHistoryInputError(`Invalid ${name}`)
  }
  return value
}

export function uuid(value: unknown, name: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new ActionHistoryInputError(`Invalid ${name}`)
  return value.toLowerCase()
}

export function sourceSystem(value: unknown): 'xero' {
  if (value !== ACTION_HISTORY_SOURCE_SYSTEM) throw new ActionHistoryInputError('Unsupported source_system')
  return value
}

export function outcome(value: unknown): ActionHistoryOutcome {
  if (!ACTION_HISTORY_OUTCOMES.includes(value as ActionHistoryOutcome)) {
    throw new ActionHistoryInputError('Unsupported outcome')
  }
  return value as ActionHistoryOutcome
}

export function note(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || Array.from(value).length > ACTION_HISTORY_MAX_NOTE_LENGTH) {
    throw new ActionHistoryInputError('Invalid note')
  }
  return value.trim() ? value : null
}

export function dateOnly(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ActionHistoryInputError('Invalid next_action_date')
  }
  const time = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    throw new ActionHistoryInputError('Invalid next_action_date')
  }
  return value
}

/** Date-only scheduling uses the organisation's calendar; UTC is the defined fallback. */
export function followUpDate(requested: unknown, timezone: string | null, now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new ActionHistoryInputError('Invalid current time')
  let effectiveTimezone = timezone ?? 'UTC'
  let today: string
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: effectiveTimezone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit',
    })
    const parts = formatter.formatToParts(now)
    const part = (type: string) => parts.find((item) => item.type === type)?.value
    today = `${part('year')?.padStart(4, '0')}-${part('month')}-${part('day')}`
    dateOnly(today)
  } catch {
    effectiveTimezone = 'UTC'
    today = now.toISOString().slice(0, 10)
  }
  if (requested !== undefined && requested !== null) {
    const explicit = dateOnly(requested)
    if (explicit <= today) throw new ActionHistoryInputError('next_action_date must be after today')
    return { date: explicit, today, timezone: effectiveTimezone }
  }
  // Add a calendar day to the local date, never 24 hours to the instant.
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  return { date: tomorrow, today, timezone: effectiveTimezone }
}

/** Server-generated calendar presets for the recording UI. */
export function followUpPresets(timezone: string | null, now = new Date()) {
  const schedule = followUpDate(undefined, timezone, now)
  const offset = (days: number) => new Date(
    Date.parse(`${schedule.today}T00:00:00Z`) + days * 86_400_000
  ).toISOString().slice(0, 10)
  return {
    today: schedule.today,
    tomorrow: schedule.date,
    inTwoDays: offset(2),
    inThreeDays: offset(3),
    nextWeek: offset(7),
    timezone: schedule.timezone,
  }
}

export function pageSize(value: unknown) {
  if (value === undefined || value === null) return 20
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) throw new ActionHistoryInputError('Invalid limit')
  return Math.min(Number(value), ACTION_HISTORY_MAX_PAGE_SIZE)
}

export interface HistoryCursor { actionTimestamp: string; id: string }

export function encodeHistoryCursor(cursor: HistoryCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

export function decodeHistoryCursor(value: unknown): HistoryCursor | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.length > 400 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ActionHistoryInputError('Invalid cursor')
  }
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as HistoryCursor
    const id = uuid(decoded.id, 'cursor')
    const parsed = new Date(decoded.actionTimestamp)
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== decoded.actionTimestamp) throw Error()
    return { actionTimestamp: parsed.toISOString(), id }
  } catch {
    throw new ActionHistoryInputError('Invalid cursor')
  }
}
