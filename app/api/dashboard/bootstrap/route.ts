import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { DashboardSchemaUnavailable, readDashboardBootstrap, readDashboardReadiness } from '@/lib/dashboard/bootstrap-server'
import { compactDashboardCollection } from '@/lib/dashboard/collection-projection'
import { GET as readStatus } from '@/app/api/xero/status/route'
import { GET as readActions } from '@/app/api/collections/actions/route'
import { shouldObserveFirstXeroSync } from '@/lib/xero/first-sync-feedback'
import type { XeroConnectionStatus } from '@/lib/xero/account-status'
import { recordFirstValueLatency } from '@/lib/observability/first-value-latency'

export async function GET(request: NextRequest) {
  const start = performance.now()
  const supabase = await createServerSupabaseClient()
  const authStarted = performance.now()
  const { data: { user }, error } = await supabase.auth.getUser()
  const authMs = performance.now() - authStarted
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tenantId = request.nextUrl.searchParams.get('tenantId')?.trim() || null
  try {
    if (request.nextUrl.searchParams.get('readinessOnly') === 'true') {
      return NextResponse.json(await readDashboardReadiness({ admin: createSupabaseAdminClient(), userId: user.id, tenantId }),
        { headers: { 'Cache-Control': 'no-store', 'X-Dashboard-Database-Calls': '1' } })
    }
    const result = await readDashboardBootstrap({ admin: createSupabaseAdminClient(), userId: user.id, tenantId })
    const { metrics, ...payload } = result
    const bytes = Buffer.byteLength(JSON.stringify(payload))
    recordFirstValueLatency({ stage: 'T10', outcome: 'succeeded', userId: user.id,
      tenantId: payload.status?.tenantId ?? undefined, detail: 'dashboard_bootstrap',
      durationMs: performance.now() - start, metrics: { auth_ms: authMs,
        database_round_trips: metrics.databaseCalls, database_wait_ms: metrics.databaseWaitMs,
        application_ms: metrics.applicationMs, response_bytes: bytes,
        customers_examined: metrics.customersExamined, customers_returned: metrics.customersReturned,
        calculation_rebuilt: Number(metrics.calculationRebuilt) } })
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store',
      'Server-Timing': `auth;dur=${authMs.toFixed(1)},db;dur=${metrics.databaseWaitMs.toFixed(1)},app;dur=${metrics.applicationMs.toFixed(1)},total;dur=${(performance.now()-start).toFixed(1)}`,
      'X-Dashboard-Database-Calls': String(metrics.databaseCalls) } })
  } catch (cause) {
    if (cause instanceof DashboardSchemaUnavailable) {
      // Compatibility only until ordered migrations/certification. Preserve
      // the old onboarding/access gate; do not consume free days for first sync.
      // Mature migrated accounts never execute these legacy readers.
      const statusResponse = await readStatus(request).catch(() => null)
      if (statusResponse?.status === 401) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      const statusPayload: XeroConnectionStatus | null = statusResponse?.ok ? await statusResponse.json() : null
      if (request.nextUrl.searchParams.get('readinessOnly') === 'true') return NextResponse.json({ ok: true, status: statusPayload, version: null }, { headers: { 'Cache-Control': 'no-store', 'X-Dashboard-Compatibility': 'schema-or-legacy' } })
      const onboarding = statusPayload && (!statusPayload.connected || shouldObserveFirstXeroSync(statusPayload))
      const url = new URL('/api/collections/actions', request.url)
      url.searchParams.set('overdueOnly', 'true'); url.searchParams.set('limit', '200')
      if (tenantId) url.searchParams.set('tenantId', tenantId)
      const collectionResponse = onboarding ? null : await readActions(new NextRequest(url)).catch(() => null)
      if (collectionResponse?.status === 401) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      const collectionPayload = collectionResponse ? await collectionResponse.json() : null
      return NextResponse.json({ ok: true, status: statusPayload,
        statusError: statusPayload ? null : 'Unable to check your Xero connection right now.',
        collectionState: onboarding ? 'onboarding' : collectionPayload?.ok ? 'ready' : collectionResponse?.status === 402 ? 'blocked' : 'unavailable',
        collection: collectionPayload ? compactDashboardCollection(collectionPayload) : null,
      }, { headers: { 'Cache-Control': 'no-store', 'X-Dashboard-Compatibility': 'schema-or-legacy' } })
    }
    return NextResponse.json({ error: 'Unable to load your dashboard right now.' }, { status: 503,
      headers: { 'Cache-Control': 'no-store' } })
  }
}
