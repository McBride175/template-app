#!/usr/bin/env node

import { performance } from 'node:perf_hooks'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { loadCustomerCollectionsSummaryWithMetadata } from '@/lib/collections/customer-summary'
import {
  syncXeroAuthoritatively,
} from '@/lib/xero/generation-sync'
import type { FirstValueLatencyEvent } from '@/lib/observability/first-value-latency'

const TEST_PROJECT_REF = 'rbmxegyiwntomhpbepnu'

function configuredProjectRef() {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!configuredUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required')
  const hostname = new URL(configuredUrl).hostname
  return hostname.endsWith('.supabase.co') ? hostname.split('.')[0] ?? null : null
}

function assertSafeExecution() {
  if (!process.argv.includes('--execute')) {
    throw new Error('Pass --execute to run the controlled Test measurement')
  }
  const projectRef = configuredProjectRef()
  if (projectRef !== TEST_PROJECT_REF) {
    throw new Error(`Refusing to run outside Test project ${TEST_PROJECT_REF}`)
  }
}

async function main() {
  assertSafeExecution()
  const supabaseAdmin = createSupabaseAdminClient()
  const { data, error } = await supabaseAdmin
    .from('xero_connections_public')
    .select('user_id, tenant_id, grant_id')
    .eq('auth_state', 'active')
    .not('grant_id', 'is', null)

  if (error) throw new Error(`Failed to find Test Xero connection: ${error.message}`)
  if (!data || data.length !== 1) {
    throw new Error(`Expected exactly one active Test Xero connection; found ${data?.length ?? 0}`)
  }

  const connection = data[0]
  const events: FirstValueLatencyEvent[] = []
  let syncPayload: {
    code?: string
    counts?: { organisations?: number; contacts?: number; invoices?: number; payments?: number }
    canonicalCounts?: { organisations?: number; customers?: number; invoices?: number; payments?: number }
    latency?: unknown
  } = {}
  let importReadyMs: number | null = null

  if (!process.argv.includes('--result-only')) {
    const measurementStartedAt = performance.now()
    const response = await syncXeroAuthoritatively({
      userId: connection.user_id,
      tenantId: connection.tenant_id,
      supabaseAdmin,
      dependencies: {
        monotonicNow: () => performance.now(),
        recordLatency(event) {
          events.push(event)
        },
      },
    })
    syncPayload = (await response.json()) as typeof syncPayload
    importReadyMs = performance.now() - measurementStartedAt

    if (!response.ok) {
      throw new Error(`Controlled sync failed with ${response.status} ${syncPayload.code ?? 'UNKNOWN'}`)
    }
  }

  const resultAssemblyStartedAt = performance.now()
  const summaryStartedAt = performance.now()
  const summaryPromise = loadCustomerCollectionsSummaryWithMetadata(
    supabaseAdmin,
    connection.user_id,
    connection.tenant_id
  ).then((value) => ({ value, durationMs: performance.now() - summaryStartedAt }))
  const summaryResult = await summaryPromise
  const overridesStartedAt = performance.now()
  const overridesPromise = supabaseAdmin
    .from('customer_overrides')
    .select('customer_source_id, override_level')
    .eq('user_id', connection.user_id)
    .eq('tenant_id', connection.tenant_id)
    .then((value) => ({ value, durationMs: performance.now() - overridesStartedAt }))
  const actionsStartedAt = performance.now()
  const actionsPromise = supabaseAdmin
    .from('collection_actions')
    .select('id, customer_source_id, action_type, outcome, next_action_date, action_timestamp')
    .eq('user_id', connection.user_id)
    .eq('tenant_id', connection.tenant_id)
    .order('action_timestamp', { ascending: false })
    .then((value) => ({ value, durationMs: performance.now() - actionsStartedAt }))

  const [overridesResult, actionsResult] = await Promise.all([
    overridesPromise,
    actionsPromise,
  ])
  const resultDataReadyMs = performance.now() - resultAssemblyStartedAt
  const result = summaryResult.value
  const { data: overrides, error: overridesError } = overridesResult.value
  const { data: actions, error: actionsError } = actionsResult.value
  if (overridesError) throw new Error(`Failed to load overrides: ${overridesError.message}`)
  if (actionsError) throw new Error(`Failed to load actions: ${actionsError.message}`)

  console.log(JSON.stringify({
    environment: 'test',
    projectRef: TEST_PROJECT_REF,
    runKind: process.argv.includes('--result-only')
      ? 'authoritative-result-data-only'
      : 'live-provider-controlled-repeat',
    counts: syncPayload.counts,
    canonicalCounts: syncPayload.canonicalCounts,
    latency: syncPayload.latency,
    observedStages: events.map((event) => ({
      stage: event.stage,
      outcome: event.outcome,
      durationMs: event.durationMs ?? null,
      metrics: event.metrics ?? {},
      detail: event.detail ?? null,
    })),
    wrapperToImportReadyMs:
      importReadyMs === null ? null : Math.round(importReadyMs * 100) / 100,
    resultDataTimings: {
      authoritativeSummaryMs: Math.round(summaryResult.durationMs * 100) / 100,
      overridesMs: Math.round(overridesResult.durationMs * 100) / 100,
      actionsMs: Math.round(actionsResult.durationMs * 100) / 100,
      gatedConcurrentWallMs: Math.round(resultDataReadyMs * 100) / 100,
    },
    resultCounts: {
      customers: result.sourceCounts.customers,
      invoices: result.sourceCounts.invoices,
      payments: result.sourceCounts.payments,
      actionableSummaryRows: result.rows.length,
      overrides: overrides?.length ?? 0,
      actions: actions?.length ?? 0,
    },
    caveat: 'OAuth callback and authenticated HTTP route overhead are outside this controlled run.',
  }, null, 2))
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Unknown measurement failure')
  process.exitCode = 1
})
