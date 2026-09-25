import {
  compareDecimalValues,
  convertCurrencyAmounts,
  normalizeCurrencyCode,
  normalizeDecimalValue,
  sumDecimalValues,
  type DecimalInput,
} from '@/lib/money/currency'
import {
  isPotentialCollectionsReceivable,
  isRelevantOpenCollectionsReceivable,
} from '@/lib/collections/currency-context'

export type InvoiceDisputeMode = 'full' | 'partial'
export type DisputeInvoiceState = 'open' | 'settled' | 'unavailable' | 'invalid'

export interface InvoiceDisputeRecord {
  id: string
  user_id: string
  tenant_id: string
  source_system: string
  invoice_source_id: string
  dispute_mode: InvoiceDisputeMode
  recorded_disputed_amount_native: DecimalInput
  amount_due_at_last_review_native: DecimalInput
  note: string | null
  is_active: boolean
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export interface DisputeAccountingInvoice {
  user_id: string
  tenant_id: string
  source_id: string
  source_system: string
  customer_source_id: string | null
  type: string | null
  status: string | null
  amount_due_native: DecimalInput
  amount_due_base: DecimalInput
  transaction_currency_code: string | null
  organisation_base_currency_code: string | null
  xero_currency_rate: DecimalInput
}

export interface DerivedInvoiceDispute {
  invoiceState: DisputeInvoiceState
  disputeMode: InvoiceDisputeMode | null
  isActive: boolean
  isResolved: boolean
  isOperationallySettled: boolean
  needsReview: boolean
  currentAmountDueNative: string | null
  recordedDisputedAmountNative: string | null
  effectiveDisputedAmountNative: string | null
  collectibleAmountNative: string | null
  grossOpenAmountBase: string | null
  effectiveDisputedAmountBase: string | null
  collectibleAmountBase: string | null
  hasCollectibleBalance: boolean
}

export class InvoiceDisputeDomainError extends Error {
  constructor(readonly code: 'invalid_amount' | 'invalid_invoice' | 'identity_mismatch') {
    super(code)
    this.name = 'InvoiceDisputeDomainError'
  }
}

function isOpenReceivable(invoice: DisputeAccountingInvoice, due: string) {
  return isRelevantOpenCollectionsReceivable({
    type: invoice.type,
    status: invoice.status,
    customer_source_id: invoice.customer_source_id,
    transaction_currency_code: invoice.transaction_currency_code,
    amount_due_native: due,
  })
}

/** Validate a fresh user-entered partial amount; old amounts are never rewritten. */
export function validateNewPartialDisputedAmount(
  amount: DecimalInput,
  currentAmountDueNative: DecimalInput
) {
  const recorded = normalizeDecimalValue(amount)
  const due = normalizeDecimalValue(currentAmountDueNative)
  if (!recorded || !due || compareDecimalValues(recorded, '0') !== 1 ||
      compareDecimalValues(due, '0') !== 1 || compareDecimalValues(recorded, due) === 1) {
    throw new InvoiceDisputeDomainError('invalid_amount')
  }
  return recorded
}

/** The same current-open eligibility used by collections, plus valid native currency. */
export function validateDisputableInvoice(invoice: DisputeAccountingInvoice) {
  const due = normalizeDecimalValue(invoice.amount_due_native)
  if (!due || !isOpenReceivable(invoice, due) ||
      !normalizeCurrencyCode(invoice.transaction_currency_code)) {
    throw new InvoiceDisputeDomainError('invalid_invoice')
  }
  return due
}

function deriveBaseAmounts(invoice: DisputeAccountingInvoice, gross: string, collectible: string) {
  const canonicalGrossBase = normalizeDecimalValue(invoice.amount_due_base)
  if (!canonicalGrossBase || compareDecimalValues(canonicalGrossBase, '0') !== 1) return null

  const conversion = convertCurrencyAmounts({
    transactionCurrency: invoice.transaction_currency_code,
    organisationBaseCurrency: invoice.organisation_base_currency_code,
    xeroCurrencyRate: invoice.xero_currency_rate,
    amounts: { gross, collectible },
  })
  if (conversion.status === 'incomplete' ||
      compareDecimalValues(conversion.amounts.gross.base, canonicalGrossBase) !== 0 ||
      conversion.amounts.collectible.base === null) return null

  const effective = sumDecimalValues([
    canonicalGrossBase,
    `-${conversion.amounts.collectible.base}`,
  ])
  if (!effective || compareDecimalValues(effective, '0') === -1) return null
  return {
    gross: canonicalGrossBase,
    effective,
    collectible: conversion.amounts.collectible.base,
  }
}

/** Single derived representation for future scoring, mutation responses and UI. */
export function deriveInvoiceDispute(
  invoice: DisputeAccountingInvoice | null,
  dispute: InvoiceDisputeRecord | null
): DerivedInvoiceDispute {
  if (invoice && dispute && (
    invoice.user_id !== dispute.user_id ||
    invoice.tenant_id !== dispute.tenant_id ||
    invoice.source_system !== dispute.source_system ||
    invoice.source_id !== dispute.invoice_source_id
  )) {
    throw new InvoiceDisputeDomainError('identity_mismatch')
  }

  const recorded = dispute
    ? normalizeDecimalValue(dispute.recorded_disputed_amount_native)
    : null
  const common = {
    disputeMode: dispute?.dispute_mode ?? null,
    isActive: dispute?.is_active ?? false,
    isResolved: Boolean(dispute && !dispute.is_active),
    recordedDisputedAmountNative: recorded,
  }

  if (!invoice) {
    return {
      ...common, invoiceState: 'unavailable', isOperationallySettled: false,
      needsReview: false, currentAmountDueNative: null,
      effectiveDisputedAmountNative: '0', collectibleAmountNative: '0',
      grossOpenAmountBase: null, effectiveDisputedAmountBase: null,
      collectibleAmountBase: null, hasCollectibleBalance: false,
    }
  }

  const due = normalizeDecimalValue(invoice.amount_due_native)
  if (!isPotentialCollectionsReceivable(invoice)) {
    return {
      ...common, invoiceState: 'settled', isOperationallySettled: true,
      needsReview: false, currentAmountDueNative: due,
      effectiveDisputedAmountNative: '0', collectibleAmountNative: '0',
      grossOpenAmountBase: '0', effectiveDisputedAmountBase: '0',
      collectibleAmountBase: '0', hasCollectibleBalance: false,
    }
  }
  if (!due || compareDecimalValues(due, '0') === -1) {
    return {
      ...common, invoiceState: 'invalid', isOperationallySettled: false,
      needsReview: false, currentAmountDueNative: due,
      effectiveDisputedAmountNative: null, collectibleAmountNative: null,
      grossOpenAmountBase: null, effectiveDisputedAmountBase: null,
      collectibleAmountBase: null, hasCollectibleBalance: false,
    }
  }

  if (!isOpenReceivable(invoice, due)) {
    return {
      ...common, invoiceState: 'settled', isOperationallySettled: true,
      needsReview: false, currentAmountDueNative: due,
      effectiveDisputedAmountNative: '0', collectibleAmountNative: '0',
      grossOpenAmountBase: '0', effectiveDisputedAmountBase: '0',
      collectibleAmountBase: '0', hasCollectibleBalance: false,
    }
  }

  const effective = !dispute?.is_active ? '0' :
    dispute.dispute_mode === 'full' ? due :
    recorded && compareDecimalValues(recorded, due) === 1 ? due : recorded
  if (effective === null) throw new InvoiceDisputeDomainError('invalid_amount')
  const collectible = sumDecimalValues([due, `-${effective}`])
  if (!collectible || compareDecimalValues(collectible, '0') === -1) {
    throw new InvoiceDisputeDomainError('invalid_amount')
  }
  const base = deriveBaseAmounts(invoice, due, collectible)

  return {
    ...common, invoiceState: 'open', isOperationallySettled: false,
    needsReview: Boolean(dispute?.is_active &&
      compareDecimalValues(due, dispute.amount_due_at_last_review_native) !== 0),
    currentAmountDueNative: due,
    effectiveDisputedAmountNative: effective,
    collectibleAmountNative: collectible,
    grossOpenAmountBase: base?.gross ?? null,
    effectiveDisputedAmountBase: base?.effective ?? null,
    collectibleAmountBase: base?.collectible ?? null,
    hasCollectibleBalance: compareDecimalValues(collectible, '0') === 1,
  }
}
