import type { FinancialMutationReconciliation } from '@/lib/collections/financial-mutation-reconciliation-server'

export type ReadyFinancialMutation = Extract<FinancialMutationReconciliation, { reconciliationReady: true }>
export type CustomerFinancialStamp = Pick<ReadyFinancialMutation['version'], 'generationId' | 'financialEpoch' | 'projectionRevision' | 'customerRevision' | 'evaluationDate'>

/** Customer revisions defeat older financial responses; P also protects note,
 * review and priority presentation. Generation switches require a newer F. */
export function shouldApplyCustomerFinancialResponse(current: CustomerFinancialStamp | null,
  next: CustomerFinancialStamp) {
  const revisions = [next.financialEpoch, next.projectionRevision, next.customerRevision]
  if (revisions.some(value => !/^(0|[1-9]\d*)$/.test(value))) return false
  if (!current) return true
  if (BigInt(next.financialEpoch) < BigInt(current.financialEpoch) ||
    BigInt(next.projectionRevision) < BigInt(current.projectionRevision) ||
    BigInt(next.customerRevision) < BigInt(current.customerRevision)) return false
  if (next.generationId !== current.generationId && next.financialEpoch === current.financialEpoch) return false
  return next.evaluationDate >= current.evaluationDate
}
