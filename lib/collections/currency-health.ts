import {
  compareDecimalValues,
  normalizeCurrencyCode,
  normalizeDecimalValue,
  type CurrencyConversionFailureReason,
  type CurrencyConversionStatus,
  type DecimalInput,
} from '@/lib/money/currency'

export type CollectionsCurrencyHealthStatus = 'complete' | 'incomplete'

export type CollectionsCurrencyFailureReason =
  | CurrencyConversionFailureReason
  | 'missing_organisation_base_currency'
  | 'conflicting_organisation_base_currency'
  | 'missing_native_amount'
  | 'invalid_conversion_status'
  | 'invoice_base_currency_mismatch'
  | 'missing_base_amount'
  | 'invalid_base_amount'

export interface CollectionsCurrencyHealth {
  status: CollectionsCurrencyHealthStatus
  affectedInvoiceCount: number
  affectedCustomerCount: number
  failureReasons: Partial<Record<CollectionsCurrencyFailureReason, number>>
}

export interface CollectionsOrganisationCurrencyRow {
  base_currency_code: string | null
}

export interface CollectionsInvoiceCurrencyRow {
  source_id: string
  customer_source_id: string | null
  type: string | null
  status: string | null
  transaction_currency_code: string | null
  organisation_base_currency_code: string | null
  amount_due_native: DecimalInput
  amount_due_base: DecimalInput
  currency_conversion_status: CurrencyConversionStatus | string | null
  currency_conversion_failure_reason: CurrencyConversionFailureReason | string | null
}

export interface CollectionsCurrencyEvaluation {
  organisationBaseCurrency: string | null
  currencyHealth: CollectionsCurrencyHealth
}

const RECEIVABLE_INVOICE_TYPE = 'ACCREC'
const OPEN_INVOICE_STATUS = 'AUTHORISED'

function normalizeAccountingValue(value: string | null) {
  const normalized = value?.trim().toUpperCase()
  return normalized || null
}

function addReason(
  reasons: Partial<Record<CollectionsCurrencyFailureReason, number>>,
  reason: CollectionsCurrencyFailureReason
) {
  reasons[reason] = (reasons[reason] ?? 0) + 1
}

function canonicalFailureReason(value: string | null): CollectionsCurrencyFailureReason {
  if (
    value === 'missing_transaction_currency' ||
    value === 'invalid_transaction_currency' ||
    value === 'missing_base_currency' ||
    value === 'invalid_base_currency' ||
    value === 'missing_rate' ||
    value === 'invalid_rate'
  ) {
    return value
  }
  return 'invalid_conversion_status'
}

function isPotentiallyRelevantInvoice(invoice: CollectionsInvoiceCurrencyRow) {
  return (
    normalizeAccountingValue(invoice.type) === RECEIVABLE_INVOICE_TYPE &&
    normalizeAccountingValue(invoice.status) === OPEN_INVOICE_STATUS &&
    !!invoice.customer_source_id?.trim()
  )
}

/**
 * Currency correctness gate for the collections domain. Historical paid
 * invoices are deliberately outside this monetary gate because the current
 * historical model uses dates, not cross-invoice monetary weighting.
 */
export function evaluateCollectionsCurrencyHealth(params: {
  organisations: readonly CollectionsOrganisationCurrencyRow[]
  invoices: readonly CollectionsInvoiceCurrencyRow[]
}): CollectionsCurrencyEvaluation {
  const normalisedOrganisationCurrencies = params.organisations.map((organisation) =>
    normalizeCurrencyCode(organisation.base_currency_code)
  )
  const organisationBaseCurrencies = new Set(
    normalisedOrganisationCurrencies.filter((value): value is string => value !== null)
  )
  const hasInvalidOrganisationCurrency = normalisedOrganisationCurrencies.some(
    (value) => value === null
  )
  const organisationBaseCurrency =
    organisationBaseCurrencies.size === 1
      ? Array.from(organisationBaseCurrencies)[0]
      : null
  const globalReason: CollectionsCurrencyFailureReason | null =
    params.organisations.length === 0 || organisationBaseCurrencies.size === 0
      ? 'missing_organisation_base_currency'
      : params.organisations.length !== 1 ||
          organisationBaseCurrencies.size > 1 ||
          hasInvalidOrganisationCurrency
        ? 'conflicting_organisation_base_currency'
        : null

  const failureReasons: Partial<Record<CollectionsCurrencyFailureReason, number>> = {}
  const affectedInvoiceIds = new Set<string>()
  const affectedCustomerIds = new Set<string>()

  const failInvoice = (
    invoice: CollectionsInvoiceCurrencyRow,
    reason: CollectionsCurrencyFailureReason
  ) => {
    affectedInvoiceIds.add(invoice.source_id)
    const customerSourceId = invoice.customer_source_id?.trim()
    if (customerSourceId) affectedCustomerIds.add(customerSourceId)
    addReason(failureReasons, reason)
  }

  for (const invoice of params.invoices) {
    if (!isPotentiallyRelevantInvoice(invoice)) continue

    const nativeAmount = normalizeDecimalValue(invoice.amount_due_native)
    if (nativeAmount === null) {
      failInvoice(invoice, 'missing_native_amount')
      continue
    }

    const nativeAmountComparison = compareDecimalValues(nativeAmount, '0')
    if (nativeAmountComparison === null) {
      failInvoice(invoice, 'missing_native_amount')
      continue
    }
    if (nativeAmountComparison <= 0) continue

    if (globalReason) {
      failInvoice(invoice, globalReason)
      continue
    }

    if (invoice.currency_conversion_status === 'incomplete') {
      failInvoice(
        invoice,
        canonicalFailureReason(invoice.currency_conversion_failure_reason)
      )
      continue
    }
    if (
      invoice.currency_conversion_status !== 'identity' &&
      invoice.currency_conversion_status !== 'converted'
    ) {
      failInvoice(invoice, 'invalid_conversion_status')
      continue
    }

    const transactionCurrency = normalizeCurrencyCode(invoice.transaction_currency_code)
    if (!transactionCurrency) {
      failInvoice(invoice, 'invalid_transaction_currency')
      continue
    }

    const invoiceBaseCurrency = normalizeCurrencyCode(
      invoice.organisation_base_currency_code
    )
    if (invoiceBaseCurrency !== organisationBaseCurrency) {
      failInvoice(invoice, 'invoice_base_currency_mismatch')
      continue
    }
    if (
      (invoice.currency_conversion_status === 'identity' &&
        transactionCurrency !== organisationBaseCurrency) ||
      (invoice.currency_conversion_status === 'converted' &&
        transactionCurrency === organisationBaseCurrency)
    ) {
      failInvoice(invoice, 'invalid_conversion_status')
      continue
    }

    const baseAmount = normalizeDecimalValue(invoice.amount_due_base)
    if (baseAmount === null) {
      failInvoice(invoice, 'missing_base_amount')
      continue
    }
    const baseAmountComparison = compareDecimalValues(baseAmount, '0')
    if (baseAmountComparison === null || baseAmountComparison <= 0) {
      failInvoice(invoice, 'invalid_base_amount')
    }
  }

  if (globalReason && affectedInvoiceIds.size === 0) {
    addReason(failureReasons, globalReason)
  }

  const status: CollectionsCurrencyHealthStatus =
    globalReason || affectedInvoiceIds.size > 0 ? 'incomplete' : 'complete'

  return {
    organisationBaseCurrency,
    currencyHealth: {
      status,
      affectedInvoiceCount: affectedInvoiceIds.size,
      affectedCustomerCount: affectedCustomerIds.size,
      failureReasons,
    },
  }
}
