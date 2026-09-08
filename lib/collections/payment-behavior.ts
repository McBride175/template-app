const MS_PER_DAY = 86_400_000

export const MINIMUM_HISTORICAL_PAYMENT_INVOICES = 3
export const HISTORICAL_PAYMENT_WINDOW_MONTHS = 6
export const MAX_IMMATERIAL_CREDIT_AMOUNT = 0.01

export interface HistoricalPaymentInvoice {
  type: unknown
  status: unknown
  due_date: unknown
  fully_paid_date: unknown
  total: unknown
  amount_paid: unknown
  amount_due: unknown
  amount_credited: unknown
}

export interface HistoricalPaymentBaseline {
  usableInvoiceCount: number
  daysLateObservations: number[]
  meanDaysLate: number | null
  normalDaysLate: number | null
}

export interface HistoricalPaymentBaselineOptions {
  evaluationDate: string
  minimumHistory?: number
}

function normalizeAccountingValue(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return normalized.length > 0 ? normalized : null
}

function parseFiniteNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function parseIsoDateUtc(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null
  }

  const [yearRaw, monthRaw, dayRaw] = value.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)
  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(year, month - 1, day)

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return date.getTime()
}

function formatIsoDateUtc(dateUtc: number) {
  return new Date(dateUtc).toISOString().slice(0, 10)
}

export function calculateHistoricalPaymentWindowCutoff(evaluationDate: unknown) {
  const evaluationDateUtc = parseIsoDateUtc(evaluationDate)
  if (evaluationDateUtc === null) return null

  const evaluation = new Date(evaluationDateUtc)
  const evaluationYear = evaluation.getUTCFullYear()
  const evaluationMonth = evaluation.getUTCMonth()
  const evaluationDay = evaluation.getUTCDate()
  const targetMonthIndex =
    evaluationYear * 12 + evaluationMonth - HISTORICAL_PAYMENT_WINDOW_MONTHS
  const targetYear = Math.floor(targetMonthIndex / 12)
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0)
  ).getUTCDate()
  const targetDay = Math.min(evaluationDay, lastDayOfTargetMonth)

  return formatIsoDateUtc(Date.UTC(targetYear, targetMonth, targetDay))
}

export function calculateHistoricalDaysLate(invoice: HistoricalPaymentInvoice) {
  const dueDateUtc = parseIsoDateUtc(invoice.due_date)
  const fullyPaidDateUtc = parseIsoDateUtc(invoice.fully_paid_date)

  if (dueDateUtc === null || fullyPaidDateUtc === null) return null
  return Math.round((fullyPaidDateUtc - dueDateUtc) / MS_PER_DAY)
}

export function isEligibleHistoricalPaymentInvoice(invoice: HistoricalPaymentInvoice) {
  if (normalizeAccountingValue(invoice.type) !== 'ACCREC') return false
  if (normalizeAccountingValue(invoice.status) !== 'PAID') return false
  if (calculateHistoricalDaysLate(invoice) === null) return false

  const total = parseFiniteNumber(invoice.total)
  const amountPaid = parseFiniteNumber(invoice.amount_paid)
  const amountDue = parseFiniteNumber(invoice.amount_due)
  if (total === null || total <= 0) return false
  if (amountPaid === null || amountPaid <= 0) return false
  if (amountDue === null || amountDue !== 0) return false

  if (invoice.amount_credited === null || invoice.amount_credited === undefined) {
    return true
  }

  const amountCredited = parseFiniteNumber(invoice.amount_credited)
  return (
    amountCredited !== null &&
    Math.abs(amountCredited) <= MAX_IMMATERIAL_CREDIT_AMOUNT
  )
}

function calculateMedian(sortedValues: number[]) {
  const midpoint = Math.floor(sortedValues.length / 2)
  if (sortedValues.length % 2 === 1) return sortedValues[midpoint]
  return (sortedValues[midpoint - 1] + sortedValues[midpoint]) / 2
}

export function calculateHistoricalPaymentBaseline(
  invoices: HistoricalPaymentInvoice[],
  options: HistoricalPaymentBaselineOptions
): HistoricalPaymentBaseline {
  const evaluationDateUtc = parseIsoDateUtc(options.evaluationDate)
  const cutoffDate = calculateHistoricalPaymentWindowCutoff(options.evaluationDate)
  const cutoffDateUtc = parseIsoDateUtc(cutoffDate)
  const minimumHistory =
    options.minimumHistory ?? MINIMUM_HISTORICAL_PAYMENT_INVOICES

  if (evaluationDateUtc === null || cutoffDateUtc === null) {
    return {
      usableInvoiceCount: 0,
      daysLateObservations: [],
      meanDaysLate: null,
      normalDaysLate: null,
    }
  }

  const daysLateObservations = invoices
    .filter(isEligibleHistoricalPaymentInvoice)
    .filter((invoice) => {
      const fullyPaidDateUtc = parseIsoDateUtc(invoice.fully_paid_date)
      return (
        fullyPaidDateUtc !== null &&
        fullyPaidDateUtc >= cutoffDateUtc &&
        fullyPaidDateUtc <= evaluationDateUtc
      )
    })
    .map(calculateHistoricalDaysLate)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right)

  const usableInvoiceCount = daysLateObservations.length
  const meanDaysLate =
    usableInvoiceCount > 0
      ? daysLateObservations.reduce((sum, value) => sum + value, 0) / usableInvoiceCount
      : null
  const normalDaysLate =
    usableInvoiceCount >= minimumHistory ? calculateMedian(daysLateObservations) : null

  return {
    usableInvoiceCount,
    daysLateObservations,
    meanDaysLate,
    normalDaysLate,
  }
}

export function calculateRelativeLatenessDays(
  currentLatenessDays: number,
  historicalNormalDaysLate: number | null
) {
  if (!Number.isFinite(currentLatenessDays)) return null
  if (historicalNormalDaysLate === null || !Number.isFinite(historicalNormalDaysLate)) {
    return null
  }

  return currentLatenessDays - historicalNormalDaysLate
}
