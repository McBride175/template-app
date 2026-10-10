import type { CustomerCollectionsSummaryRow } from './customer-workspace-types'

export function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString()
}

export function formatMoney(amount: number | null, currencyCode: string | null) {
  if (amount === null) return 'Base amount unavailable'
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

export function formatInvoicedAmount(amount: string, currencyCode: string) {
  const numericAmount = Number(amount)
  if (!Number.isFinite(numericAmount)) return `${currencyCode} ${amount}`
  return `${formatMoney(numericAmount, currencyCode)} ${currencyCode}`
}

export function formatInvoicedBreakdown(
  breakdown: CustomerCollectionsSummaryRow['native_currency_breakdown'],
  amountField: 'total_outstanding_native' | 'overdue_outstanding_native'
) {
  return breakdown
    .filter((entry) => Number(entry[amountField]) > 0)
    .map((entry) => formatInvoicedAmount(entry[amountField], entry.currency_code))
    .join(' · ')
}

export function formatCurrencyFailureReason(reason: string) {
  return reason.replaceAll('_', ' ')
}

export function getStatusLabel(row: CustomerCollectionsSummaryRow) {
  if (row.status?.trim()) return row.status
  if (row.is_customer === true) return 'customer'
  if (row.is_supplier === true) return 'supplier'
  return 'contact'
}
