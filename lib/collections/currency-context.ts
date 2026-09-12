import {
  compareDecimalValues,
  normalizeCurrencyCode,
  normalizeDecimalValue,
  type DecimalInput,
} from '@/lib/money/currency'

const RECEIVABLE_INVOICE_TYPE = 'ACCREC'
const OPEN_INVOICE_STATUS = 'AUTHORISED'

export type CollectionsCurrencyMode = 'single_currency' | 'multi_currency'

export interface CollectionsCurrencyContext {
  mode: CollectionsCurrencyMode
  invoicedCurrencies: string[]
  relevantInvoiceCount: number
}

export interface CollectionsCurrencyContextInvoice {
  type: string | null
  status: string | null
  customer_source_id: string | null
  transaction_currency_code: string | null
  amount_due_native: DecimalInput
}

function normalizeAccountingValue(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? ''
}

export function isPotentialCollectionsReceivable(
  invoice: Pick<
    CollectionsCurrencyContextInvoice,
    'type' | 'status' | 'customer_source_id'
  >
) {
  return (
    normalizeAccountingValue(invoice.type) === RECEIVABLE_INVOICE_TYPE &&
    normalizeAccountingValue(invoice.status) === OPEN_INVOICE_STATUS &&
    Boolean(invoice.customer_source_id?.trim())
  )
}

export function isRelevantOpenCollectionsReceivable(
  invoice: CollectionsCurrencyContextInvoice
) {
  if (!isPotentialCollectionsReceivable(invoice)) return false

  const amountDueNative = normalizeDecimalValue(invoice.amount_due_native)
  return amountDueNative !== null && compareDecimalValues(amountDueNative, '0') === 1
}

/**
 * Product access depends only on currencies present in the current, positive,
 * open receivables population. Historical/settled invoices and Xero's
 * UseMulticurrency capability are deliberately irrelevant.
 */
export function deriveCollectionsCurrencyContext(
  invoices: readonly CollectionsCurrencyContextInvoice[]
): CollectionsCurrencyContext {
  const invoicedCurrencies = new Set<string>()
  let relevantInvoiceCount = 0

  for (const invoice of invoices) {
    if (!isRelevantOpenCollectionsReceivable(invoice)) continue
    relevantInvoiceCount += 1

    const currencyCode = normalizeCurrencyCode(invoice.transaction_currency_code)
    if (currencyCode) invoicedCurrencies.add(currencyCode)
  }

  const currencies = Array.from(invoicedCurrencies).sort()
  return {
    mode: currencies.length > 1 ? 'multi_currency' : 'single_currency',
    invoicedCurrencies: currencies,
    relevantInvoiceCount,
  }
}
