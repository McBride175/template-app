import 'server-only'
import type { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type { CollectionDependencyScope } from '@/lib/collections/dependency-state-server'
import { ensureCustomerFinancialFeaturesForPortfolioWithIdentity, newCustomerMaterializationMetrics,
  type CustomerMaterializationMetrics } from '@/lib/collections/customer-materialization-server'
import { CUSTOMER_ACCOUNTING_BASIS_VERSION, CUSTOMER_FINANCIAL_FEATURE_VERSION } from '@/lib/collections/customer-materialization'
import { calculateReusablePortfolio, PORTFOLIO_CALCULATION_VERSION, COLLECTION_SCORING_MODEL_VERSION,
  comparePortfolioBenchmarkDependencies, type PortfolioFinancialCalculation, type PortfolioScoringScope, type CompactPortfolioCustomer } from '@/lib/collections/portfolio-materialization'

type Admin = ReturnType<typeof createSupabaseAdminClient>
export interface PortfolioCalculationIdentity extends CollectionDependencyScope {
  generationId: string; financialEpoch: string; evaluationDate: string; basisVersion: string; featureVersion: string
  scoringModelVersion: string; calculationVersion: string; scoringScope: PortfolioScoringScope; overdueOnly: boolean; evidenceIdentity: string
}
export interface PortfolioCalculationHead extends Omit<PortfolioFinancialCalculation, 'rows'> {
  provenance?: { previousCalculationId: string | null; benchmarkDependencies: ReturnType<typeof comparePortfolioBenchmarkDependencies>; rescoringStrategy: 'all-compact-rows' }; calculationId: string; identity: PortfolioCalculationIdentity; featureBasisCount: number
  customerCount: number; scoredCustomerCount: number; publishedAt: string
}
export interface PortfolioCalculationMetrics {
  roundTrips: number; hits: number; misses: number; benchmarkMs: number; baseScoreMs: number; scoresRecalculated: number
  databaseWaitMs: number; validationMs: number; publicationMs: number; featureEnsureMs: number; totalMs: number
  rowsTransferred: number; payloadBytes: number; features: CustomerMaterializationMetrics
}
export function newPortfolioCalculationMetrics(): PortfolioCalculationMetrics {
  return { roundTrips: 0,hits: 0,misses: 0,benchmarkMs: 0,baseScoreMs: 0,scoresRecalculated: 0,databaseWaitMs: 0,
    validationMs: 0,publicationMs: 0,featureEnsureMs: 0,totalMs: 0,rowsTransferred: 0,payloadBytes: 0,features: newCustomerMaterializationMetrics() }
}
export class PortfolioCalculationNotReady extends Error {
  constructor(readonly reason: 'scope' | 'legacy' | 'transition' | 'missing' | 'incomplete') { super(`Portfolio calculation not ready: ${reason}`) }
}
interface Params extends CollectionDependencyScope {
  admin: Admin; evaluationInstant: Date; scoringScope: PortfolioScoringScope; overdueOnly: boolean; metrics?: PortfolioCalculationMetrics
}
interface Probe { previousHead?: PortfolioCalculationHead | null; context: { userId: string; tenantId: string; sourceSystem: string; generationId: string | null; generationStatus: string | null;
  generationReady: boolean; financialEpoch: string; evidenceIdentity: string; basisVersion: string; featureVersion: string }; head: PortfolioCalculationHead | null; rows: CompactPortfolioCustomer[] }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function session(params: Params) {
  if (!UUID.test(params.userId) || !params.tenantId.trim() || params.sourceSystem !== 'xero' || params.scoringScope !== 'collections' ||
    typeof params.overdueOnly !== 'boolean' || !Number.isFinite(params.evaluationInstant.getTime())) throw new PortfolioCalculationNotReady('scope')
  const metrics = params.metrics ?? newPortfolioCalculationMetrics(), date = params.evaluationInstant.toISOString().slice(0,10)
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const started = performance.now(); metrics.roundTrips++
    const {data,error} = await params.admin.rpc(name,{p_user_id:params.userId,p_tenant_id:params.tenantId,...args})
    const elapsed = performance.now()-started; metrics.databaseWaitMs+=elapsed
    if(name === 'publish_collection_portfolio_calculation') metrics.publicationMs+=elapsed; else metrics.validationMs+=elapsed
    if(error) throw new Error(`Portfolio calculation ${name}: ${error.message}`)
    if(params.metrics) metrics.payloadBytes += Buffer.byteLength(JSON.stringify(data),'utf8')
    return data as T
  }
  async function probe(customerIds: string[] | null = [], after: string | null = null): Promise<Probe> {
    const result = await rpc<Probe>('read_collection_portfolio_calculation',{p_evaluation_date:date,p_overdue_only:params.overdueOnly,
      p_scoring_scope:params.scoringScope,p_customer_ids:customerIds,p_after:after,p_limit:2000})
    const c=result.context
    if(!c || c.userId!==params.userId || c.tenantId!==params.tenantId || c.sourceSystem!==params.sourceSystem ||
      c.basisVersion!==CUSTOMER_ACCOUNTING_BASIS_VERSION || c.featureVersion!==CUSTOMER_FINANCIAL_FEATURE_VERSION || !/^(0|[1-9]\d*)$/.test(c.financialEpoch)) throw new PortfolioCalculationNotReady('scope')
    if(!c.generationId) throw new PortfolioCalculationNotReady('legacy')
    if(!UUID.test(c.generationId) || c.generationStatus!=='succeeded' || c.generationReady!==true) throw new PortfolioCalculationNotReady('transition')
    const h=result.head
    if(h && (!UUID.test(h.calculationId) || h.identity.generationId!==c.generationId || h.identity.financialEpoch!==c.financialEpoch ||
      h.identity.evidenceIdentity!==c.evidenceIdentity || h.identity.userId!==params.userId || h.identity.tenantId!==params.tenantId ||
      h.identity.sourceSystem!==params.sourceSystem || h.identity.evaluationDate!==date || h.identity.overdueOnly!==params.overdueOnly ||
      h.identity.scoringScope!==params.scoringScope || h.identity.scoringModelVersion!==COLLECTION_SCORING_MODEL_VERSION ||
      h.identity.calculationVersion!==PORTFOLIO_CALCULATION_VERSION || h.identity.basisVersion!==CUSTOMER_ACCOUNTING_BASIS_VERSION ||
      h.identity.featureVersion!==CUSTOMER_FINANCIAL_FEATURE_VERSION)) throw new PortfolioCalculationNotReady('scope')
    if(!Array.isArray(result.rows)) throw new PortfolioCalculationNotReady('incomplete')
    metrics.rowsTransferred+=result.rows.length
    return result
  }
  return {metrics,date,rpc,probe}
}
/** Authenticated ownership and entitlement resolution are the caller's existing
 * server boundary. This path has no live route or browser API consumer. */
export async function ensurePortfolioBaseCalculation(params: Params): Promise<PortfolioCalculationHead> {
  const {metrics,rpc,probe}=session(params), started=performance.now()
  try {
    for(let attempt=0;attempt<3;attempt++) {
      const before=await probe()
      if(before.head) { metrics.hits++;return before.head }
      metrics.misses++
      const featureStarted=performance.now()
      const certified=await ensureCustomerFinancialFeaturesForPortfolioWithIdentity({...params,metrics:metrics.features})
      metrics.featureEnsureMs+=performance.now()-featureStarted
      // Fence the identity captured with features, never a newer head read later.
      const identity: PortfolioCalculationIdentity={...certified.identity,scoringScope:params.scoringScope,overdueOnly:params.overdueOnly,
        scoringModelVersion:COLLECTION_SCORING_MODEL_VERSION,calculationVersion:PORTFOLIO_CALCULATION_VERSION}
      const calculation=calculateReusablePortfolio(certified.result,params.overdueOnly,metrics)
      metrics.scoresRecalculated+=calculation.population.scoring
      const published=await rpc<string | null>('publish_collection_portfolio_calculation',{p_identity:identity,p_calculation:{...calculation,provenance:{previousCalculationId:before.previousHead?.calculationId ?? null,benchmarkDependencies:comparePortfolioBenchmarkDependencies(before.previousHead?.benchmarks ?? null,calculation.benchmarks),rescoringStrategy:'all-compact-rows'}}})
      if(!published) continue
      const final=await probe()
      if(final.head?.calculationId===published) return final.head
    }
    throw new PortfolioCalculationNotReady('transition')
  } finally {metrics.totalMs+=performance.now()-started}
}
/** Read only: never triggers feature construction or numerical scoring. null is
 * a current-identity miss. Full reads use bounded keyset pages and a final fence. */
export async function readPortfolioBaseCalculation(params: Params & { customerSourceIds?: string[]; completePopulation?: boolean }) {
  const {metrics,probe}=session(params),started=performance.now()
  const ids=params.customerSourceIds ? [...new Set(params.customerSourceIds.map(id=>id.trim()))] : []
  if(ids.length>100 || ids.some(id=>!id) || (ids.length && params.completePopulation)) throw new PortfolioCalculationNotReady('scope')
  try {
    const first=await probe(params.completePopulation ? null : ids)
    if(!first.head) return null
    const rows=[...first.rows]
    if(params.completePopulation) {
      let last=first
      while(rows.length<first.head.customerCount && last.rows.length===2000) {
        last=await probe(null,last.rows.at(-1)!.customerId)
        if(last.head?.calculationId!==first.head.calculationId) throw new PortfolioCalculationNotReady('transition')
        rows.push(...last.rows)
      }
      if(rows.length!==first.head.customerCount) throw new PortfolioCalculationNotReady('incomplete')
      if(rows.length!==first.rows.length && (await probe()).head?.calculationId!==first.head.calculationId) throw new PortfolioCalculationNotReady('transition')
    }
    return {head:first.head,rows}
  } finally {metrics.totalMs+=performance.now()-started}
}
