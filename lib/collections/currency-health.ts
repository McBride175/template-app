import {
  compareDecimalValues,
  normalizeCurrencyCode,
  normalizeDecimalValue,
  type CurrencyConversionFailureReason,
  type CurrencyConversionStatus,
  type DecimalInput,
} from '@/lib/money/currency'
import { isPotentialCollectionsReceivable } from '@/lib/collections/currency-context'

export type CollectionsCurrencyHealthStatus = 'healthy' | 'degraded' | 'unavailable'
export type CollectionsRankingStatus = 'complete' | 'provisional' | 'unavailable'

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
  rankingStatus: CollectionsRankingStatus
  affectedInvoiceCount: number
  affectedCustomerCount: number
  failureReasons: Partial<Record<CollectionsCurrencyFailureReason, number>>
}

export interface CollectionsCurrencyIssue {
  invoiceSourceId: string
  customerSourceId: string
  transactionCurrencyCode: string | null
  organisationBaseCurrencyCode: string | null
  conversionStatus: string | null
  failureReason: CollectionsCurrencyFailureReason
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
  affectedCustomerSourceIds: string[]
  currencyIssues: CollectionsCurrencyIssue[]
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
  return isPotentialCollectionsReceivable(invoice)
}

/**
 * Currency correctness classifier for the collections domain. Systemic
 * organisation-currency failures make ranking unavailable; isolated invoice
 * failures identify customers that must be removed from normal scoring.
 * Historical paid invoices are deliberately outside this monetary gate because
 * the current historical model uses dates, not cross-invoice monetary weighting.
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
  const affectedCustomerIds = new Set<string>()
  const currencyIssues: CollectionsCurrencyIssue[] = []

  const failInvoice = (
    invoice: CollectionsInvoiceCurrencyRow,
    reason: CollectionsCurrencyFailureReason
  ) => {
    const customerSourceId = invoice.customer_source_id?.trim() ?? ''
    if (customerSourceId) affectedCustomerIds.add(customerSourceId)
    currencyIssues.push({
      invoiceSourceId: invoice.source_id,
      customerSourceId,
      transactionCurrencyCode: normalizeCurrencyCode(invoice.transaction_currency_code),
      organisationBaseCurrencyCode: organisationBaseCurrency,
      conversionStatus: invoice.currency_conversion_status,
      failureReason: reason,
    })
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

  if (globalReason && currencyIssues.length === 0) {
    addReason(failureReasons, globalReason)
  }

  const status: CollectionsCurrencyHealthStatus =
    globalReason ? 'unavailable' : currencyIssues.length > 0 ? 'degraded' : 'healthy'
  const rankingStatus: CollectionsRankingStatus =
    status === 'healthy' ? 'complete' : status === 'degraded' ? 'provisional' : 'unavailable'

  return {
    organisationBaseCurrency,
    currencyHealth: {
      status,
      rankingStatus,
      affectedInvoiceCount: currencyIssues.length,
      affectedCustomerCount: affectedCustomerIds.size,
      failureReasons,
    },
    affectedCustomerSourceIds: Array.from(affectedCustomerIds).sort(),
    currencyIssues,
  }
}

/**
 * Emits identifiers and conversion state needed to diagnose degraded collections
 * data without logging customer names, raw Xero payloads, credentials, or tokens.
 */
export function logCollectionsCurrencyHealth(params: {
  route: string
  accountId: string
  tenantId: string
  evaluation: CollectionsCurrencyEvaluation
}) {
  const { currencyHealth, currencyIssues } = params.evaluation
  if (currencyHealth.status === 'healthy') return

  console.warn('[collections.currency_health] Currency data requires attention', {
    route: params.route,
    timestamp: new Date().toISOString(),
    account_id: params.accountId,
    tenant_id: params.tenantId,
    status: currencyHealth.status,
    ranking_status: currencyHealth.rankingStatus,
    affected_invoice_count: currencyHealth.affectedInvoiceCount,
    affected_customer_count: currencyHealth.affectedCustomerCount,
    failure_reasons: currencyHealth.failureReasons,
    issues: currencyIssues.map((issue) => ({
      invoice_source_id: issue.invoiceSourceId,
      customer_source_id: issue.customerSourceId,
      transaction_currency_code: issue.transactionCurrencyCode,
      organisation_base_currency_code: issue.organisationBaseCurrencyCode,
      conversion_status: issue.conversionStatus,
      failure_reason: issue.failureReason,
    })),
  })
}
