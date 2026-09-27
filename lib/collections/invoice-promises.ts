import {
  compareDecimalValues,
  normalizeCurrencyCode,
  normalizeDecimalValue,
  sumDecimalValues,
  type DecimalInput,
} from '@/lib/money/currency'

export type InvoicePromiseStatus = 'active' | 'kept' | 'missed' | 'unclear' | 'cancelled'

/** Minimal operational projection; dates, evidence and lifecycle writes are excluded. */
export interface InvoicePromiseRecord {
  id: string
  user_id: string
  tenant_id: string
  source_system: string
  invoice_source_id: string
  customer_source_id: string
  currency_code: string
  promised_amount_native: DecimalInput
  qualifying_paid_amount_native: DecimalInput
  status: InvoicePromiseStatus
}

export interface DerivedInvoicePromise {
  status: InvoicePromiseStatus | null
  isActive: boolean
  recordedPromisedAmountNative: string | null
  qualifyingPaidAmountNative: string | null
  remainingPromiseCommitmentNative: string | null
  activePromisedCoverageAmountNative: string | null
}

export class InvoicePromiseDomainError extends Error {
  constructor(readonly code: 'invalid_amount' | 'invalid_status' | 'identity_mismatch' | 'currency_mismatch') {
    super(code)
    this.name = 'InvoicePromiseDomainError'
  }
}

/** Consume a certified paid total and post-dispute eligible debt, never raw evidence. */
export function deriveInvoicePromise(
  promise: InvoicePromiseRecord | null,
  eligibleAmountNative: DecimalInput
): DerivedInvoicePromise {
  const eligible = normalizeDecimalValue(eligibleAmountNative)
  if (eligibleAmountNative !== null && eligibleAmountNative !== undefined &&
      (eligible === null || compareDecimalValues(eligible, '0') === -1)) {
    throw new InvoicePromiseDomainError('invalid_amount')
  }
  if (!promise) {
    return {
      status: null, isActive: false, recordedPromisedAmountNative: null,
      qualifyingPaidAmountNative: null, remainingPromiseCommitmentNative: null,
      activePromisedCoverageAmountNative: '0',
    }
  }
  if (!['active', 'kept', 'missed', 'unclear', 'cancelled'].includes(promise.status)) {
    throw new InvoicePromiseDomainError('invalid_status')
  }
  if (!normalizeCurrencyCode(promise.currency_code)) {
    throw new InvoicePromiseDomainError('currency_mismatch')
  }
  const recorded = normalizeDecimalValue(promise.promised_amount_native)
  const paid = normalizeDecimalValue(promise.qualifying_paid_amount_native)
  if (recorded === null || paid === null || compareDecimalValues(recorded, '0') !== 1 ||
      compareDecimalValues(paid, '0') === -1) {
    throw new InvoicePromiseDomainError('invalid_amount')
  }
  const unpaid = sumDecimalValues([recorded, `-${paid}`])
  if (unpaid === null) throw new InvoicePromiseDomainError('invalid_amount')
  const remaining = compareDecimalValues(unpaid, '0') === -1 ? '0' : unpaid
  const isActive = promise.status === 'active'
  const coverage = !isActive ? '0' : eligible === null ? null :
    compareDecimalValues(remaining, eligible) === 1 ? eligible : remaining
  return {
    status: promise.status, isActive, recordedPromisedAmountNative: recorded,
    qualifyingPaidAmountNative: paid, remainingPromiseCommitmentNative: remaining,
    activePromisedCoverageAmountNative: coverage,
  }
}
