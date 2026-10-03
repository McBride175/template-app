import type { CustomerFinancialFeatures } from '@/lib/collections/customer-features'
import type { PortfolioBenchmarks, PortfolioBaseScores } from '@/lib/collections/portfolio-benchmarks'
import { restorePortfolioBaseScore, type CompactPortfolioCustomer, type StoredPortfolioBenchmarks } from '@/lib/collections/portfolio-materialization'
import { projectCollectionQueue, type QueueProjectionInput } from '@/lib/collections/queue-projection'

/** Rehydrates only the financial fields the existing queue projection reads.
 * The compact calculation is already certified against the live scorer; no
 * benchmark or base-score arithmetic is performed here. */
export function projectPersistedCollectionQueue(input: {
  benchmarks: StoredPortfolioBenchmarks
  rows: readonly CompactPortfolioCustomer[]
  overlay: Omit<QueueProjectionInput, 'benchmarks' | 'baseScores'>
  populationCounts?: { invoiceScope: number; scoring: number; analysed: number }
}) {
  const ordered = [...input.rows].sort((a, b) => a.order - b.order)
  const features = ordered.map((item) => ({
    ...item.score?.input,
    ...item.projection,
    invoice_to_chase_overdue_base: item.score?.input.invoice_overdue_to_chase_base ?? 0,
    customer_to_chase_overdue_base: item.score?.input.customer_overdue_to_chase_base ?? 0,
    collectible_outstanding_base: item.score?.input.total_outstanding_base ?? 0,
    customer_source_id: item.customerId,
  })) as CustomerFinancialFeatures[]
  const byId = new Map(features.map((row) => [row.customer_source_id, row]))
  const population = (key: keyof CompactPortfolioCustomer['membership']) =>
    ordered.filter((item) => item.membership[key]).map((item) => byId.get(item.customerId)!)
  const benchmarks = {
    ...input.benchmarks,
    invoiceScopeRows: population('invoiceScope'),
    scopeRows: ordered.filter((item) => item.membership.scoring).map((item) => byId.get(item.customerId)!),
    ageingRows: population('ageing'),
    filteredRows: population('scoring'),
    analysedOverdueRows: population('analysed'),
  } satisfies PortfolioBenchmarks
  const baseScores = ordered.flatMap((item) => {
    if (!item.membership.scoring) return []
    const base = restorePortfolioBaseScore(item, input.benchmarks)
    if (!base) throw new Error('Ready portfolio calculation has a missing base score')
    return [{ features: byId.get(item.customerId)!, base }]
  }) satisfies PortfolioBaseScores
  return projectCollectionQueue({ ...input.overlay, benchmarks, baseScores,
    populationCounts: input.populationCounts })
}
