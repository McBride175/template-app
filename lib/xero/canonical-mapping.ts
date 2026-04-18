import 'server-only'

const XERO_JSON_DATE_REGEX = /^\/Date\((-?\d+)([-+]\d{4})?\)\/$/
const YYYY_MM_DD_REGEX = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATE_PREFIX_REGEX = /^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/
const ISO_DATE_TIME_NO_TZ_REGEX =
  /^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)$/
const INTEGER_STRING_REGEX = /^-?\d+$/

function parseXeroJsonDateMilliseconds(value: string) {
  const match = XERO_JSON_DATE_REGEX.exec(value.trim())
  if (!match) return null

  const timestamp = Number.parseInt(match[1], 10)
  if (!Number.isFinite(timestamp)) return null

  return timestamp
}

function toIsoDate(value: Date) {
  if (Number.isNaN(value.getTime())) return null
  return value.toISOString().slice(0, 10)
}

function toIsoDateTime(value: Date) {
  if (Number.isNaN(value.getTime())) return null
  return value.toISOString()
}

export function parseXeroDate(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    // Xero commonly sends date-only or "YYYY-MM-DDTHH:mm:ss" values.
    // Preserve the date portion directly to avoid timezone shifts.
    const datePrefixMatch = ISO_DATE_PREFIX_REGEX.exec(trimmed)
    if (datePrefixMatch) {
      return datePrefixMatch[1]
    }

    if (YYYY_MM_DD_REGEX.test(trimmed)) {
      return trimmed
    }

    const jsonDateMs = parseXeroJsonDateMilliseconds(trimmed)
    if (jsonDateMs !== null) {
      return toIsoDate(new Date(jsonDateMs))
    }

    if (INTEGER_STRING_REGEX.test(trimmed)) {
      const epoch = Number.parseInt(trimmed, 10)
      if (Number.isFinite(epoch)) {
        return toIsoDate(new Date(epoch))
      }
    }

    const parsed = new Date(trimmed)
    return toIsoDate(parsed)
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toIsoDate(value)
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return toIsoDate(new Date(value))
  }

  return null
}

export function parseXeroDateTime(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    const jsonDateMs = parseXeroJsonDateMilliseconds(trimmed)
    if (jsonDateMs !== null) {
      return toIsoDateTime(new Date(jsonDateMs))
    }

    if (INTEGER_STRING_REGEX.test(trimmed)) {
      const epoch = Number.parseInt(trimmed, 10)
      if (Number.isFinite(epoch)) {
        return toIsoDateTime(new Date(epoch))
      }
    }

    if (YYYY_MM_DD_REGEX.test(trimmed)) {
      return `${trimmed}T00:00:00.000Z`
    }

    const noTimezoneDateTimeMatch = ISO_DATE_TIME_NO_TZ_REGEX.exec(trimmed)
    if (noTimezoneDateTimeMatch) {
      return `${noTimezoneDateTimeMatch[1]}T${noTimezoneDateTimeMatch[2]}Z`
    }

    const parsed = new Date(trimmed)
    return toIsoDateTime(parsed)
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toIsoDateTime(value)
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return toIsoDateTime(new Date(value))
  }

  return null
}

export function safeNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    // Keep valid zero-like values ("0", "0.00") as numeric 0.
    const parsed = Number.parseFloat(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}
