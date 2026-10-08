import 'server-only'

import type { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type {
  PromiseAccountingObservation, PromiseLifecycleRecord, PromisePaymentEvidence, PromiseCashEvidence,
} from '@/lib/collections/promise-evidence'
import { qualifyPromisePayments } from '@/lib/collections/promise-payment-qualification'
import { resolvePromiseOutcome, type PromiseCurrencyValuation, type PromiseResolutionResult } from '@/lib/collections/promise-outcome-resolution'

type AdminClient = ReturnType<typeof createSupabaseAdminClient>
export interface XeroPromisePublicationEvent {
  stage: 'prepared' | 'published' | 'recovered'
  attempt: number
  proposalCount: number
  resultCode?: string
}
interface InvoiceContext extends PromiseCurrencyValuation { customer_source_id: string; type: string }
export interface PromiseReconciliationSnapshot {
  evidence_digest: string
  promises: (Omit<PromiseLifecycleRecord, 'revision'> & { revision: string })[]
  facts: {
    observation: PromiseAccountingObservation
    payments: PromisePaymentEvidence[]
    cash: PromiseCashEvidence[]
    invoices: InvoiceContext[]
  }
}
export interface PromiseReconciliationProposal {
  promise_id: string
  expected_revision: string
  result: PromiseResolutionResult
}

/** No lifecycle rules here: bind held canonical context, then delegate to Phase 5A. */
export function preparePromiseReconciliation(snapshot: PromiseReconciliationSnapshot) {
  if (!/^[a-f0-9]{64}$/.test(snapshot.evidence_digest) || !Array.isArray(snapshot.promises) ||
      !Array.isArray(snapshot.facts.payments) || !Array.isArray(snapshot.facts.cash) ||
      !Array.isArray(snapshot.facts.invoices)) throw new Error('Invalid Promise reconciliation snapshot')
  const { observation, payments, cash, invoices } = snapshot.facts
  const byInvoice = new Map<string, InvoiceContext>()
  for (const invoice of invoices) {
    if (byInvoice.has(invoice.invoice_source_id)) throw new Error('Duplicate reconciliation invoice identity')
    byInvoice.set(invoice.invoice_source_id, invoice)
  }
  const seen = new Set<string>()
  const proposals: PromiseReconciliationProposal[] = snapshot.promises.map(row => {
    const revision = Number(row.revision)
    if (!/^[1-9]\d*$/.test(row.revision) || !Number.isSafeInteger(revision) || seen.has(row.id) || row.status !== 'active') {
      throw new Error('Invalid Active Promise reconciliation set')
    }
    seen.add(row.id)
    const promise: PromiseLifecycleRecord = { ...row, revision }
    const invoice = byInvoice.get(promise.invoice_source_id)
    const qualified = qualifyPromisePayments({ promise, observation, payments })
    // Bind accounting identity/currency independently of outcome. Missing context
    // is unavailable evidence, never a fabricated zero or settlement conclusion.
    if (!invoice || invoice.user_id !== promise.user_id || invoice.tenant_id !== promise.tenant_id ||
        invoice.source_system !== promise.source_system || invoice.sync_run_id !== observation.sync_run_id ||
        invoice.customer_source_id !== promise.customer_source_id || invoice.type !== 'ACCREC') {
      qualified.valid = false
      qualified.reason = 'identity_invalid'
      qualified.qualifying_paid_amount_native = null
    } else if (invoice.currency_code !== promise.currency_code) {
      qualified.valid = false
      qualified.reason = 'currency_evidence_unavailable'
      qualified.qualifying_paid_amount_native = null
    }
    return { promise_id: promise.id, expected_revision: row.revision,
      result: resolvePromiseOutcome({ promise, observation, qualifiedPayments: qualified, cash, promiseValuation: invoice ?? null }) }
  })
  return { evidence_digest: snapshot.evidence_digest, proposals }
}

async function prepare(client: AdminClient, args: Record<string, unknown>) {
  const { data, error } = await client.rpc('prepare_invoice_promise_reconciliation', args)
  if (error) throw new Error(`Promise reconciliation preparation failed (${error.code ?? 'database'})`)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid reconciliation preparation response')
  return data as PromiseReconciliationSnapshot & { already_promoted?: boolean; promoted_at?: string; empty_active_set?: boolean }
}
function promotionRow(data: unknown) {
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row || typeof row.promoted !== 'boolean' || typeof row.result_code !== 'string' ||
      (row.promoted && typeof row.promoted_at !== 'string')) throw new Error('Invalid atomic promotion response')
  return { promoted: row.promoted, resultCode: row.result_code, promotedAt: typeof row.promoted_at === 'string' ? row.promoted_at : null }
}

/** Preparation is provisional; SQL publishes accounting + Promise state together. */
export async function promoteXeroGenerationWithPromises(params: {
  syncRunId: string; leaseOwner: string; fencingToken: number; snapshotAsOf?: string | null; supabaseAdmin: AdminClient
  onPublicationEvent?: (event: XeroPromisePublicationEvent) => void
  assertPublicationAuthority?: () => Promise<void>
}) {
  const observe = (event: XeroPromisePublicationEvent) => {
    try { params.onPublicationEvent?.(event) } catch { /* telemetry is never publication authority */ }
  }
  const args = { p_sync_run_id: params.syncRunId, p_lease_owner: params.leaseOwner, p_fencing_token: params.fencingToken }
  for (let attempt = 0; attempt < 3; attempt++) {
    await params.assertPublicationAuthority?.()
    const snapshot = await prepare(params.supabaseAdmin, args)
    if (snapshot.already_promoted && snapshot.promoted_at) return { promoted: true, resultCode: 'already_promoted', promotedAt: snapshot.promoted_at }
    if (snapshot.empty_active_set && snapshot.promises?.length !== 0) throw new Error('Invalid empty Active Promise set')
    const reconciliation = snapshot.empty_active_set ? null : preparePromiseReconciliation(snapshot)
    observe({ stage: 'prepared', attempt: attempt + 1, proposalCount: reconciliation?.proposals.length ?? 0 })
    let response: Awaited<ReturnType<AdminClient['rpc']>>
    try {
      await params.assertPublicationAuthority?.()
      response = await params.supabaseAdmin.rpc('promote_xero_sync_run_with_promises', {
        ...args, p_snapshot_as_of: params.snapshotAsOf ?? null, p_reconciliation: reconciliation,
      })
      if (response.error) throw new Error(`Atomic Promise promotion failed (${response.error.code ?? 'database'})`)
      const result = promotionRow(response.data)
      observe({ stage: 'published', attempt: attempt + 1, proposalCount: reconciliation?.proposals.length ?? 0, resultCode: result.resultCode })
      if (['promise_state_changed', 'promise_evidence_changed', 'promise_preparation_required'].includes(result.resultCode) && attempt < 2) continue
      return result
    } catch (error) {
      // An uncertain response may follow a committed transaction. Inspect the
      // exact run before the caller marks failure; never replay terminal events.
      const recovered = await prepare(params.supabaseAdmin, args).catch(() => null)
      if (recovered?.already_promoted && recovered.promoted_at) {
        observe({ stage: 'recovered', attempt: attempt + 1, proposalCount: reconciliation?.proposals.length ?? 0, resultCode: 'already_promoted' })
        return { promoted: true, resultCode: 'already_promoted', promotedAt: recovered.promoted_at }
      }
      throw error
    }
  }
  throw new Error('Promise reconciliation retry bound exceeded')
}
