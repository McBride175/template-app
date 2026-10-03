/** Projection revisions are tenant-scoped monotonic bigint strings. A later
 * request at the same revision may carry a newer certified calculation (for
 * example after an evidence-only invalidation). */
export interface QueueResponseStamp {
  tenantId: string | null
  projectionRevision: string | null
  financialEpoch: string | null
  accountingGenerationId: string | null
  requestSequence: number
}

export function shouldApplyQueueResponse(current: QueueResponseStamp | null,
  incoming: QueueResponseStamp) {
  if (!current || current.tenantId !== incoming.tenantId) return true
  if (current.projectionRevision !== null && incoming.projectionRevision !== null) {
    const currentP = BigInt(current.projectionRevision)
    const nextP = BigInt(incoming.projectionRevision)
    if (nextP < currentP) return false
    if (current.financialEpoch !== null && incoming.financialEpoch !== null &&
        BigInt(incoming.financialEpoch) < BigInt(current.financialEpoch)) return false
    if (nextP === currentP) {
      if (current.accountingGenerationId !== null && incoming.accountingGenerationId !== null &&
          current.accountingGenerationId !== incoming.accountingGenerationId) return false
      return incoming.requestSequence >= current.requestSequence
    }
    return true
  }
  return incoming.requestSequence >= current.requestSequence
}
