import type { InvoiceDisputeView } from '@/lib/collections/invoice-dispute-view'
import { compareDecimalValues } from '@/lib/money/currency'

/** Presentation selection only: gross open overdue receivables, not actionability. */
export function validInvoiceDate(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value)
}
export function priorityInvoiceContext(invoices: readonly InvoiceDisputeView[], evaluationDate: string | null) {
  const dateKnown = validInvoiceDate(evaluationDate)
  const overdue = dateKnown ? invoices.filter(invoice => invoice.invoiceState === 'open' &&
    compareDecimalValues(invoice.currentAmountDueNative, '0') === 1 && validInvoiceDate(invoice.dueDate) && invoice.dueDate < evaluationDate!)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || a.invoiceSourceId.localeCompare(b.invoiceSourceId)) : []
  const uncertain = invoices.filter(invoice => invoice.invoiceState === 'unavailable' || invoice.invoiceState === 'invalid' ||
    (invoice.invoiceState === 'open' && (!validInvoiceDate(invoice.dueDate) || !invoice.currencyCode ||
      compareDecimalValues(invoice.currentAmountDueNative, '0') === null)))
  return { overdue, uncertain, dateKnown }
}
