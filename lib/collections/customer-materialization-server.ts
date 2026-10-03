import 'server-only'
import type { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type { CollectionDependencyScope } from '@/lib/collections/dependency-state-server'
import type { CustomerFeatureInput, CustomerFinancialFeaturesResult } from '@/lib/collections/customer-features'
import {
  calculateMaterializedCustomerFeature, mergeMaterializedCustomerFeatures,
  CUSTOMER_ACCOUNTING_BASIS_VERSION, CUSTOMER_FINANCIAL_FEATURE_VERSION,
  type CertificateWithObservations, type CustomerAccountingBasis, type MaterializedCustomerFeature,
} from '@/lib/collections/customer-materialization'

type Admin = ReturnType<typeof createSupabaseAdminClient>
interface Context {
  userId: string; tenantId: string; sourceSystem: string; generationId: string | null; generationStatus: string | null; generationReady: boolean
  basisVersion: string; featureVersion: string; financialEpoch: string; projectionRevision: string; certificate: CertificateWithObservations | null; evidenceIdentity: string
}
interface Item { customerId: string; revision: string; basisComplete: boolean; order: number; feature: MaterializedCustomerFeature | null }
interface Probe { integrityChecked: boolean; invalidActivePromise: boolean; context: Context; manifest: { basis_count: number } | null; items: Item[] }
interface BuildInputs { context: Context; bases: { customerId: string; order: number; revision: string; payload: CustomerAccountingBasis }[]
  disputes: CustomerFeatureInput['disputes']; promises: Array<CustomerFeatureInput['promises'] extends ReadonlyMap<string, infer V> ? V : never> }
export interface CustomerMaterializationMetrics {
  roundTrips: number; basisBuilds: number; basisHits: number; basisMisses: number; featureHits: number; featureMisses: number
  canonicalBuildRequests: number; canonicalInvoiceReads: number; canonicalPaymentReads: number; canonicalEvidenceReads: number; operationalReadRequests: number; operationalIntegrityChecks: number; featuresRebuilt: number
  basisBuildMs: number; featureCalculationMs: number; databaseWaitMs: number; totalMs: number
}
export function newCustomerMaterializationMetrics(): CustomerMaterializationMetrics {
  return { roundTrips: 0, basisBuilds: 0, basisHits: 0, basisMisses: 0, featureHits: 0, featureMisses: 0,
    canonicalBuildRequests: 0, canonicalInvoiceReads: 0, canonicalPaymentReads: 0, canonicalEvidenceReads: 0, operationalReadRequests: 0, operationalIntegrityChecks: 0, featuresRebuilt: 0, basisBuildMs: 0,
    featureCalculationMs: 0, databaseWaitMs: 0, totalMs: 0 }
}
/** Captured with the population, not reread after calculating it. Future
 * portfolio publication must fence this identity, including certification. */
export interface CertifiedCustomerFinancialFeatures {
  result: CustomerFinancialFeaturesResult
  identity: CollectionDependencyScope & {
    generationId: string; financialEpoch: string; evaluationDate: string
    basisVersion: string; featureVersion: string; evidenceIdentity: string
    customerRevisions?: { sourceId: string; financialRevision: string }[]
  }
}
export class CustomerMaterializationNotReady extends Error {
  constructor(readonly reason: 'legacy' | 'transition' | 'customer_missing' | 'incomplete' | 'scope' | 'operational_context') {
    super(`Customer materialization not ready: ${reason}`)
  }
}
interface Params extends CollectionDependencyScope { admin: Admin; evaluationInstant: Date; metrics?: CustomerMaterializationMetrics }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REVISION = /^(0|[1-9]\d*)$/
function contextMatches(a: Context, b: Context) {
  return a.generationId === b.generationId && a.financialEpoch === b.financialEpoch && a.evidenceIdentity === b.evidenceIdentity
}
function validateContext(context: Context, params: Params) {
  if (!context || context.userId !== params.userId || context.tenantId !== params.tenantId || context.sourceSystem !== params.sourceSystem ||
    context.basisVersion !== CUSTOMER_ACCOUNTING_BASIS_VERSION || context.featureVersion !== CUSTOMER_FINANCIAL_FEATURE_VERSION ||
    !REVISION.test(context.financialEpoch) || !REVISION.test(context.projectionRevision) || typeof context.evidenceIdentity !== 'string') {
    throw new CustomerMaterializationNotReady('scope')
  }
  if (context.generationId === null) throw new CustomerMaterializationNotReady('legacy')
  if (!UUID.test(context.generationId) || context.generationStatus !== 'succeeded' || context.generationReady !== true) throw new CustomerMaterializationNotReady('transition')
  if (context.certificate && (context.certificate.user_id !== params.userId || context.certificate.tenant_id !== params.tenantId ||
    context.certificate.source_system !== params.sourceSystem || context.certificate.sync_run_id !== context.generationId)) {
    throw new CustomerMaterializationNotReady('scope')
  }
}
function chunk<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size))
}
/** Auth/entitlement resolution belongs to the calling server boundary. No route uses
 * this API yet. Missing schema fails explicitly; legacy accounting is never reused. */
async function ensure(params: Params, customerIds: string[] | null): Promise<CertifiedCustomerFinancialFeatures> {
  if (!UUID.test(params.userId) || !params.tenantId.trim() || params.sourceSystem !== 'xero' ||
    !Number.isFinite(params.evaluationInstant.getTime())) throw new CustomerMaterializationNotReady('scope')
  const start = performance.now(), metrics = params.metrics ?? newCustomerMaterializationMetrics()
  const date = params.evaluationInstant.toISOString().slice(0, 10)
  const baseArgs = { p_user_id: params.userId, p_tenant_id: params.tenantId }
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const start = performance.now(); metrics.roundTrips++
    const { data, error } = await params.admin.rpc(name, { ...baseArgs, ...args })
    metrics.databaseWaitMs += performance.now() - start
    if (error) throw new Error(`Customer materialization ${name}: ${error.message}`)
    return data as T
  }
  async function probe(ids: string[] | null, after: string | null = null): Promise<Probe> {
    const result = await rpc<Probe>('read_collection_customer_materialization', {
      p_evaluation_date: date, p_customer_ids: ids, p_after: after, p_limit: 500,
    })
    validateContext(result.context, params)
    if (typeof result.integrityChecked !== 'boolean' || typeof result.invalidActivePromise !== 'boolean') throw new CustomerMaterializationNotReady('incomplete')
    if (result.integrityChecked) metrics.operationalIntegrityChecks++
    if (result.invalidActivePromise) throw new CustomerMaterializationNotReady('operational_context')
    if (!Array.isArray(result.items) || result.items.some(item => !REVISION.test(item.revision))) throw new CustomerMaterializationNotReady('incomplete')
    return result
  }
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      let first = await probe(customerIds)
      let newlyBuilt = 0
      if ((!customerIds && !first.manifest) || first.items.some(item => !item.basisComplete)) {
        const buildStart = performance.now(); metrics.canonicalBuildRequests++; metrics.basisBuilds++
        // Logical extraction + full-population count verification (one RPC).
        metrics.canonicalInvoiceReads += customerIds ? 1 : 2
        metrics.canonicalPaymentReads += customerIds ? 1 : 2
        metrics.canonicalEvidenceReads += customerIds ? 1 : 2
        const beforeBuildGeneration = first.context.generationId
        const built = await rpc<{ inserted: number }>('build_collection_customer_bases', { p_generation_id: first.context.generationId, p_customer_ids: customerIds })
        metrics.basisBuildMs += performance.now() - buildStart
        newlyBuilt = built.inserted; metrics.basisMisses += newlyBuilt
        first = await probe(customerIds)
        if (first.context.generationId !== beforeBuildGeneration) continue
      }
      const items = [...first.items]
      if (!customerIds) {
        if (!first.manifest) throw new CustomerMaterializationNotReady('incomplete')
        let last = first
        while (last.items.length === 500) {
          last = await probe(null, last.items.at(-1)!.customerId)
          if (!contextMatches(first.context, last.context)) break
          items.push(...last.items)
        }
        if (!contextMatches(first.context, last.context)) continue
        if (items.length !== first.manifest.basis_count) throw new CustomerMaterializationNotReady('incomplete')
      }
      if (items.some(item => !item.basisComplete)) throw new CustomerMaterializationNotReady('customer_missing')
      metrics.basisHits += items.length - newlyBuilt
      const misses = items.filter(item => !item.feature)
      metrics.featureHits += items.length - misses.length; metrics.featureMisses += misses.length
      let stale = false
      for (const batch of chunk(misses, 100)) {
        metrics.operationalReadRequests++
        const input = await rpc<BuildInputs>('read_collection_customer_feature_inputs', {
          p_generation_id: first.context.generationId, p_customer_ids: batch.map(item => item.customerId),
        })
        validateContext(input.context, params)
        if (!contextMatches(first.context, input.context)) { stale = true; break }
        if (input.bases.length !== batch.length) throw new CustomerMaterializationNotReady('incomplete')
        const calculated = input.bases.map(basis => {
          const item = batch.find(item => item.customerId === basis.customerId)!
          if (!item || item.revision !== basis.revision) throw new CustomerMaterializationNotReady('transition')
          const invoiceIds = new Set(basis.payload.invoices.map(invoice => invoice.source_id))
          const promises = input.promises.filter(promise => invoiceIds.has(promise.invoice_source_id) || promise.customer_source_id.trim() === basis.customerId)
          const started = performance.now()
          const feature = calculateMaterializedCustomerFeature({ basis: basis.payload, userId: params.userId, tenantId: params.tenantId,
            generationId: first.context.generationId!, evaluationDate: date, certificate: input.context.certificate,
            disputes: input.disputes.filter(dispute => invoiceIds.has(dispute.invoice_source_id)),
            promises: new Map(promises.map(promise => [promise.invoice_source_id, promise])),
          })
          metrics.featureCalculationMs += performance.now() - started; metrics.featuresRebuilt++
          return { customerId: basis.customerId, revision: basis.revision, result: feature }
        })
        const published = await rpc<boolean>('publish_collection_customer_features', { p_generation_id: first.context.generationId,
          p_evaluation_date: date, p_evidence_identity: input.context.evidenceIdentity, p_results: calculated })
        if (!published) { stale = true; break }
        for (const entry of calculated) items.find(item => item.customerId === entry.customerId)!.feature = entry.result
      }
      if (stale) continue
      // Final dependency fence after multi-page/batch work; changes cause bounded retry,
      // never a mixed-generation/financial-epoch population. P is intentionally ignored.
      const final = misses.length === 0 && items.length === first.items.length
        ? first : await probe(customerIds ? customerIds.slice(0, 1) : [])
      if (!contextMatches(first.context, final.context)) continue
      return { result: mergeMaterializedCustomerFeatures(items.map(item => ({ order: item.order, feature: item.feature! }))),
        identity: { userId: params.userId, tenantId: params.tenantId, sourceSystem: params.sourceSystem,
          generationId: first.context.generationId!, financialEpoch: first.context.financialEpoch, evaluationDate: date,
          basisVersion: CUSTOMER_ACCOUNTING_BASIS_VERSION, featureVersion: CUSTOMER_FINANCIAL_FEATURE_VERSION,
          evidenceIdentity: first.context.evidenceIdentity, ...(customerIds ? { customerRevisions: items.map(item =>
            ({ sourceId: item.customerId, financialRevision: item.revision })) } : {}),
        } }
    }
    throw new CustomerMaterializationNotReady('transition')
  } finally { metrics.totalMs += performance.now() - start }
}
export function ensureCustomerFinancialFeatures(params: Params & { customerSourceId: string }) {
  if (!params.customerSourceId.trim()) throw new CustomerMaterializationNotReady('scope')
  return ensure(params, [params.customerSourceId.trim()]).then(certified => certified.result)
}
export function ensureCustomerFinancialFeaturesForPortfolio(params: Params) { return ensure(params, null).then(certified => certified.result) }
export function ensureCustomerFinancialFeaturesForPortfolioWithIdentity(params: Params) { return ensure(params, null) }
export function ensureCustomerFinancialFeaturesWithIdentity(params: Params & { customerSourceId: string }) {
  if (!params.customerSourceId.trim()) throw new CustomerMaterializationNotReady('scope')
  return ensure(params, [params.customerSourceId.trim()])
}
export function ensureCustomerFinancialFeaturesForCustomers(params: Params & { customerSourceIds: string[] }) {
  const ids = [...new Set(params.customerSourceIds.map(id => id.trim()))]
  if (!ids.length || ids.length > 100 || ids.some(id => !id)) throw new CustomerMaterializationNotReady('scope')
  return ensure(params, ids).then(certified => certified.result)
}

/** Explicit preparation API; permitted historical G is always labelled as G.
 * The database verifies owner/tenant and succeeded status. No current pointer is
 * created, changed, or inferred here; ordinary ensure obtains G from authority. */
export async function buildCustomerAccountingBases(params: CollectionDependencyScope & {
  admin: Admin; generationId: string; customerSourceIds?: string[]
}): Promise<{ inserted: number; generationId: string; basisVersion: string }> {
  const ids = params.customerSourceIds ? [...new Set(params.customerSourceIds.map(id => id.trim()))] : null
  if (!UUID.test(params.userId) || !UUID.test(params.generationId) || !params.tenantId.trim() || params.sourceSystem !== 'xero' ||
    (ids && (!ids.length || ids.length > 100 || ids.some(id => !id)))) throw new CustomerMaterializationNotReady('scope')
  const { data, error } = await params.admin.rpc('build_collection_customer_bases', {
    p_user_id: params.userId, p_tenant_id: params.tenantId, p_generation_id: params.generationId, p_customer_ids: ids,
  })
  if (error) throw new Error(`Customer accounting basis build: ${error.message}`)
  const result = data as { inserted: number; generationId: string; basisVersion: string }
  if (!result || result.basisVersion !== CUSTOMER_ACCOUNTING_BASIS_VERSION || result.generationId !== params.generationId || !Number.isSafeInteger(result.inserted) || result.inserted < 0) {
    throw new CustomerMaterializationNotReady('incomplete')
  }
  return result
}
