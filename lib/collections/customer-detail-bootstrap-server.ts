import 'server-only'

import type { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { ensureCustomerFinancialFeaturesWithIdentity, CustomerMaterializationNotReady } from '@/lib/collections/customer-materialization-server'
import { projectLatestInvoicePromisePresentation,
  type PresentedInvoicePromiseRow } from '@/lib/collections/invoice-promises-loading'
import { projectCustomerInvoiceDisputes } from '@/lib/collections/invoice-disputes-server'
import type { CustomerFinancialFeaturesResult } from '@/lib/collections/customer-features'
import type { CustomerOverrideLevel } from '@/lib/collections/prioritization'
import type { CollectionsCurrencyContext } from '@/lib/collections/currency-context'
import { readCollectionDependencyState } from '@/lib/collections/dependency-state-server'

type Admin = ReturnType<typeof createSupabaseAdminClient>

export class CustomerDetailBootstrapUnavailable extends Error {
  constructor(readonly reason: 'schema' | 'legacy' | 'preparing' | 'missing' | 'invalid') {
    super(`Customer detail bootstrap unavailable: ${reason}`)
  }
}

interface DetailSnapshot {
  ready: boolean
  context: { userId: string; tenantId: string; sourceSystem: string; generationId: string | null;
    generationStatus: string | null; generationReady: boolean; financialEpoch: string;
    evidenceIdentity: string; basisVersion: string; featureVersion: string }
  customerRevision?: string; projectionRevision?: string
  feature?: { result: CustomerFinancialFeaturesResult } | null
  overrideLevel?: CustomerOverrideLevel
  invoices?: Parameters<typeof projectCustomerInvoiceDisputes>[0]['invoices']
  disputes?: Parameters<typeof projectCustomerInvoiceDisputes>[0]['disputes']
  promises?: PresentedInvoicePromiseRow[]
  currencyPopulation?: { relevantInvoiceCount: number; invoicedCurrencies: string[] }
}

/** One warm RPC returns a complete held G/F/rCustomer/P view. An invalid
 * derivative is rebuilt through Phase 3.3, then the entire snapshot is read
 * again. Invoice display is freshly read for this customer only. */
export async function readCustomerDetailBootstrap(params: {
  admin: Admin; userId: string; tenantId: string; customerSourceId: string;
  evaluationInstant: Date
}) {
  const date = params.evaluationInstant.toISOString().slice(0, 10)
  let databaseWaitMs = 0, roundTrips = 0, featureRebuilt = false
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = performance.now()
    const { data, error } = await params.admin.rpc('read_collection_customer_detail_bootstrap', {
      p_user_id: params.userId, p_tenant_id: params.tenantId,
      p_customer_source_id: params.customerSourceId, p_evaluation_date: date,
    })
    databaseWaitMs += performance.now() - started
    roundTrips++
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') throw new CustomerDetailBootstrapUnavailable('schema')
      throw new Error(`Customer detail bootstrap: ${error.message}`)
    }
    const snapshot = data as DetailSnapshot | null
    if (!snapshot?.context || snapshot.context.userId !== params.userId ||
      snapshot.context.tenantId !== params.tenantId || snapshot.context.sourceSystem !== 'xero') {
      throw new CustomerDetailBootstrapUnavailable('invalid')
    }
    if (!snapshot.context.generationId) throw new CustomerDetailBootstrapUnavailable('legacy')
    if (snapshot.context.generationStatus !== 'succeeded' || snapshot.context.generationReady !== true) {
      throw new CustomerDetailBootstrapUnavailable('preparing')
    }
    if (!snapshot.ready || !snapshot.feature) {
      try {
        await ensureCustomerFinancialFeaturesWithIdentity({
          admin: params.admin, userId: params.userId, tenantId: params.tenantId,
          sourceSystem: 'xero', customerSourceId: params.customerSourceId,
          evaluationInstant: params.evaluationInstant,
        })
      } catch (cause) {
        if (cause instanceof CustomerMaterializationNotReady) {
          throw new CustomerDetailBootstrapUnavailable(cause.reason === 'customer_missing' ? 'missing' : 'preparing')
        }
        throw cause
      }
      featureRebuilt = true
      continue
    }
    const revision = snapshot.customerRevision
    if (!/^(0|[1-9]\d*)$/.test(revision ?? '') ||
      !/^(0|[1-9]\d*)$/.test(snapshot.projectionRevision ?? '') ||
      !Array.isArray(snapshot.invoices) || !Array.isArray(snapshot.disputes) ||
      !Array.isArray(snapshot.promises) || !snapshot.currencyPopulation ||
      !Array.isArray(snapshot.currencyPopulation.invoicedCurrencies)) {
      throw new CustomerDetailBootstrapUnavailable('invalid')
    }
    const currencyCodes = snapshot.currencyPopulation.invoicedCurrencies
    const currencyContext: CollectionsCurrencyContext = {
      mode: currencyCodes.length > 1 ? 'multi_currency' : 'single_currency',
      invoicedCurrencies: currencyCodes,
      relevantInvoiceCount: snapshot.currencyPopulation.relevantInvoiceCount,
    }
    const promises = projectLatestInvoicePromisePresentation(snapshot.promises, params)
    const invoices = projectCustomerInvoiceDisputes({ ...params,
      invoices: snapshot.invoices, disputes: snapshot.disputes, promises })
    const feature = snapshot.feature.result
    if (feature.rows.some(row => row.customer_source_id !== params.customerSourceId) ||
      feature.reviewRequiredCustomers.some(row => row.customer_source_id !== params.customerSourceId)) {
      throw new CustomerDetailBootstrapUnavailable('invalid')
    }
    const fenceStarted = performance.now()
    const current = await readCollectionDependencyState({ admin: params.admin,
      userId: params.userId, tenantId: params.tenantId, sourceSystem: 'xero',
      customerSourceId: params.customerSourceId })
    databaseWaitMs += performance.now() - fenceStarted
    roundTrips++
    if (current.accounting.generationId !== snapshot.context.generationId ||
      current.financialEpoch !== snapshot.context.financialEpoch ||
      current.projectionRevision !== snapshot.projectionRevision ||
      current.customer?.financialRevision !== revision) continue
    if (date !== new Date().toISOString().slice(0, 10)) {
      if (attempt < 2) return readCustomerDetailBootstrap({ ...params, evaluationInstant: new Date() })
      throw new CustomerDetailBootstrapUnavailable('preparing')
    }
    return {
      row: feature.rows[0] ? { ...feature.rows[0], override_level: snapshot.overrideLevel ?? 'normal' } : null,
      reviewRequiredCustomer: feature.reviewRequiredCustomers[0] ?? null,
      invoices, currencyContext, currencyHealth: feature.currencyHealth,
      organisationBaseCurrency: feature.organisationBaseCurrency,
      version: { generationId: snapshot.context.generationId,
        financialEpoch: snapshot.context.financialEpoch, customerRevision: revision!,
        projectionRevision: snapshot.projectionRevision!, evaluationDate: date,
        evidenceIdentity: snapshot.context.evidenceIdentity },
      metrics: { roundTrips, databaseWaitMs, featureRebuilt,
        invoiceRows: snapshot.invoices.length, unrelatedCustomerRows: 0 },
    }
  }
  throw new CustomerDetailBootstrapUnavailable('preparing')
}
