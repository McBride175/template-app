import {
  compareDecimalValues,
  convertCurrencyAmounts,
  normalizeCurrencyCode,
  sumDecimalValues,
} from '@/lib/money/currency'
import {
  deriveInvoiceDispute,
  type DerivedInvoiceDispute,
  type DisputeAccountingInvoice,
  type DisputeInvoiceState,
  type InvoiceDisputeRecord,
} from '@/lib/collections/invoice-disputes'
import {
  deriveInvoicePromise,
  InvoicePromiseDomainError,
  type DerivedInvoicePromise,
  type InvoicePromiseRecord,
} from '@/lib/collections/invoice-promises'

export interface DerivedInvoiceActionability {
  invoiceState: DisputeInvoiceState
  transactionCurrencyCode: string | null
  organisationBaseCurrencyCode: string | null
  currentAmountDueNative: string | null
  effectiveDisputedAmountNative: string | null
  postDisputeAmountNative: string | null
  recordedPromisedAmountNative: string | null
  qualifyingPaidAmountNative: string | null
  remainingPromiseCommitmentNative: string | null
  activePromisedCoverageAmountNative: string | null
  toChaseAmountNative: string | null
  grossOpenAmountBase: string | null
  effectiveDisputedAmountBase: string | null
  activePromisedCoverageAmountBase: string | null
  toChaseAmountBase: string | null
  dispute: DerivedInvoiceDispute
  promise: DerivedInvoicePromise
}

function derivePromiseBaseAmounts(
  invoice: DisputeAccountingInvoice,
  dispute: DerivedInvoiceDispute,
  toChase: string
) {
  const postDispute = dispute.collectibleAmountBase
  if (postDispute === null || dispute.grossOpenAmountBase === null) return null
  // Preserve existing canonical values when no split is needed.
  if (toChase === dispute.collectibleAmountNative) return { coverage: '0', toChase: postDispute }
  if (toChase === '0') return { coverage: postDispute, toChase: '0' }
  const conversion = convertCurrencyAmounts({
    transactionCurrency: invoice.transaction_currency_code,
    organisationBaseCurrency: invoice.organisation_base_currency_code,
    xeroCurrencyRate: invoice.xero_currency_rate,
    amounts: { gross: dispute.currentAmountDueNative, toChase },
  })
  const finalBase = conversion.amounts.toChase.base
  if (conversion.status === 'incomplete' || finalBase === null ||
      compareDecimalValues(conversion.amounts.gross.base, dispute.grossOpenAmountBase) !== 0) return null
  const coverage = sumDecimalValues([postDispute, `-${finalBase}`])
  if (coverage === null || compareDecimalValues(coverage, '0') === -1) return null
  return { coverage, toChase: finalBase }
}

/** Canonical actionability only: no clock, evidence inspection, queries or mutations. */
export function deriveInvoiceActionability(
  invoice: DisputeAccountingInvoice | null,
  disputeRecord: InvoiceDisputeRecord | null,
  promiseRecord: InvoicePromiseRecord | null
): DerivedInvoiceActionability {
  const identity = invoice ? {
    user_id: invoice.user_id, tenant_id: invoice.tenant_id,
    source_system: invoice.source_system, invoice_source_id: invoice.source_id,
  } : disputeRecord
  if (identity && promiseRecord && (
    identity.user_id !== promiseRecord.user_id || identity.tenant_id !== promiseRecord.tenant_id ||
    identity.source_system !== promiseRecord.source_system ||
    identity.invoice_source_id !== promiseRecord.invoice_source_id ||
    (invoice && invoice.customer_source_id !== promiseRecord.customer_source_id)
  )) throw new InvoicePromiseDomainError('identity_mismatch')
  if (invoice && promiseRecord && (
    !normalizeCurrencyCode(invoice.transaction_currency_code) ||
    normalizeCurrencyCode(invoice.transaction_currency_code) !== normalizeCurrencyCode(promiseRecord.currency_code)
  )) throw new InvoicePromiseDomainError('currency_mismatch')

  const dispute = deriveInvoiceDispute(invoice, disputeRecord)
  // Existing disputes use zero collectible for a missing invoice. Do not expose
  // that operational convenience as an assertion of current accounting balance.
  const invoiceState = invoice && (dispute.currentAmountDueNative === null ||
    compareDecimalValues(dispute.currentAmountDueNative, '0') === -1 ||
    !normalizeCurrencyCode(invoice.transaction_currency_code)) ? 'invalid' : dispute.invoiceState
  const available = invoiceState !== 'unavailable' && invoiceState !== 'invalid'
  const eligible = available ? dispute.collectibleAmountNative : null
  if (available && compareDecimalValues(dispute.effectiveDisputedAmountNative, '0') === -1) {
    throw new InvoicePromiseDomainError('invalid_amount')
  }
  const promise = deriveInvoicePromise(promiseRecord, eligible)
  const coverage = promise.activePromisedCoverageAmountNative
  const toChase = eligible === null || coverage === null ? null :
    sumDecimalValues([eligible, `-${coverage}`])
  const base = available && invoice && toChase !== null
    ? derivePromiseBaseAmounts(invoice, dispute, toChase) : null
  return {
    invoiceState,
    transactionCurrencyCode: normalizeCurrencyCode(invoice?.transaction_currency_code),
    organisationBaseCurrencyCode: normalizeCurrencyCode(invoice?.organisation_base_currency_code),
    currentAmountDueNative: dispute.currentAmountDueNative,
    effectiveDisputedAmountNative: available ? dispute.effectiveDisputedAmountNative : null,
    postDisputeAmountNative: eligible,
    recordedPromisedAmountNative: promise.recordedPromisedAmountNative,
    qualifyingPaidAmountNative: promise.qualifyingPaidAmountNative,
    remainingPromiseCommitmentNative: promise.remainingPromiseCommitmentNative,
    activePromisedCoverageAmountNative: coverage,
    toChaseAmountNative: toChase,
    grossOpenAmountBase: available ? dispute.grossOpenAmountBase : null,
    effectiveDisputedAmountBase: available ? dispute.effectiveDisputedAmountBase : null,
    activePromisedCoverageAmountBase: base?.coverage ?? null,
    toChaseAmountBase: base?.toChase ?? null,
    dispute, promise,
  }
}
