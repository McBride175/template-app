function roundForDisplay(value: number) {
  return Math.round(value * 10) / 10
}

function formatDayCount(value: number) {
  const rounded = roundForDisplay(Math.abs(value))
  const formatted = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `${formatted} day${rounded === 1 ? '' : 's'}`
}

export function formatHistoricalPaymentTiming(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'Not enough payment history'

  const rounded = roundForDisplay(value)
  if (rounded === 0) return 'On the due date'
  if (rounded < 0) return `${formatDayCount(rounded)} before due date`
  return `${formatDayCount(rounded)} late`
}

export function formatCurrentOverdueAge(value: number) {
  return Number.isFinite(value) ? formatDayCount(value) : 'Unavailable'
}

export function formatRelativeLateness(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'Not enough history to compare'

  const rounded = roundForDisplay(value)
  if (rounded === 0) return 'About the same as usual'
  if (rounded < 0) return `${formatDayCount(rounded)} earlier than usual`
  return `${formatDayCount(rounded)} later than usual`
}
