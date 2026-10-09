import 'server-only'
import { hasReadableCollectionConnection, readCollectionAccessDatabaseContext, CollectionAccessSchemaUnavailable, type CollectionAccessDatabaseContext } from '@/lib/collections/access-context-server'
import type { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { FREE_USAGE_DAYS } from '@/lib/billing/config'
import { getConfiguredPaidPriceIds, isSubscriptionPaid, resolveConfiguredPaidPlan } from '@/lib/billing/policy'
import type { ActionsEntitlementStatus } from '@/lib/billing/entitlements'
import { resolveCollectionsCurrencyAccess } from '@/lib/billing/collections-access'
import { classifyXeroGrant } from '@/lib/xero/scopes'
import { resolveXeroSyncState, getXeroSyncStateMessage } from '@/lib/xero/sync-status'
import type { XeroConnectionStatus } from '@/lib/xero/account-status'
import { shouldObserveFirstXeroSync } from '@/lib/xero/first-sync-feedback'
import { FastQueueUnavailable, readCollectionQueueProjection } from '@/lib/collections/fast-queue-projection-server'
import { compactDashboardCollection, DASHBOARD_QUEUE_LIMIT } from '@/lib/dashboard/collection-projection'

type Admin = ReturnType<typeof createSupabaseAdminClient>
export class DashboardSchemaUnavailable extends Error {}
interface BillingClaim { allowed: boolean; usage_days_consumed: number; usage_date_already_recorded: boolean }
type Context = CollectionAccessDatabaseContext
export function dashboardConnectionStatus(c: Context, now: Date): XeroConnectionStatus {
  const connection = c.connection
  const grant = connection?.grant_id ? classifyXeroGrant({ scopes: c.grantScopes,
    authState: connection.auth_state, scopeMetadataKnown: Boolean(c.grantScopes?.length) }) : connection ? 'reauth_required' : null
  const run = c.latestRun
  const attempt = run ? { runId: run.id, startedAt: run.started_at,
    state: run.status === 'running' ? (run.lease_expires_at && Date.parse(run.lease_expires_at) > now.getTime() ? 'running' : 'interrupted')
      : run.status === 'succeeded' ? 'promoted' : 'failed' } as NonNullable<XeroConnectionStatus['latestSyncAttempt']> : null
  const syncState = resolveXeroSyncState({ authState: connection?.auth_state,
    lastRefreshErrorCode: connection?.last_refresh_error, grantClassification: grant, latestAttemptState: attempt?.state })
  return { connected: syncState === 'active' || syncState === 'temporary_sync_issue' || syncState === 'sync_in_progress',
    needsReauth: syncState === 'reconnect_required' || syncState === 'permission_upgrade_required',
    hasError: connection?.auth_state === 'error', hasTemporaryIssue: syncState === 'temporary_sync_issue' || syncState === 'sync_in_progress',
    syncState, syncMessage: getXeroSyncStateMessage(syncState), authState: connection?.auth_state ?? 'disconnected',
    canSync: connection?.auth_state === 'active' && syncState !== 'permission_upgrade_required' && syncState !== 'reconnect_required' && !c.invalidSnapshot,
    tenantId: connection?.tenant_id ?? null, tenantName: connection?.tenant_name ?? null,
    reauthRequiredAt: connection?.reauth_required_at ?? null,
    lastSyncedAt: c.lastSyncedAt, snapshot: c.snapshot, grantClassification: grant,
    latestSyncAttempt: attempt, connections: [] }
}

async function readContext(admin: Admin, userId: string, tenantId: string | null, now: Date) {
  try { return await readCollectionAccessDatabaseContext({ admin, userId, tenantId, now }) }
  catch (error) {
    if (error instanceof CollectionAccessSchemaUnavailable) throw new DashboardSchemaUnavailable()
    throw error
  }
}

/** Observe a known in-flight refresh through Yuohme metadata, never Xero.
 * No usage claim, feature population, or queue read is necessary. */
export async function readDashboardReadiness(params: { admin: Admin; userId: string; tenantId: string | null }) {
  const now = new Date(), c = await readContext(params.admin, params.userId, params.tenantId, now)
  return { ok: true as const, status: dashboardConnectionStatus(c, now),
    version: { accountingGenerationId: c.snapshot?.syncRunId ?? null,
      financialEpoch: c.financialEpoch, projectionRevision: c.projectionRevision } }
}

/** Auth is performed once by the route. This operation neither calls a provider
 * nor runs sync. Context and queue have independent typed failure outcomes. */
export async function readDashboardBootstrap(params: {
  admin: Admin; userId: string; tenantId: string | null; evaluationInstant?: Date
}) {
  const start = performance.now()
  const now = params.evaluationInstant ?? new Date(), date = now.toISOString().slice(0, 10)
  const metrics = { databaseCalls: 0, databaseWaitMs: 0, accessMs: 0, projectionMs: 0,
    customersExamined: 0, customersReturned: 0, calculationRebuilt: false }
  const admin = new Proxy(params.admin, { get(target, property) {
    if (property !== 'rpc') return Reflect.get(target, property)
    return async (name: string, args: Record<string, unknown>) => {
      const at = performance.now(); metrics.databaseCalls++
      try { return await target.rpc(name, args) }
      finally { metrics.databaseWaitMs += performance.now() - at }
    }
  } }) as Admin
  async function context() {
    const at = performance.now()
    try { return await readContext(admin, params.userId, params.tenantId, now) }
    finally { metrics.accessMs += performance.now() - at }
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const held = await context(), status = dashboardConnectionStatus(held, now)
    const paid = isSubscriptionPaid({ subscription: held.subscription, now, paidPriceIds: getConfiguredPaidPriceIds() })
    if (paid !== held.paid) throw new Error('Dashboard entitlement mismatch')
    const retainedAccounting = hasReadableCollectionConnection(held) && held.snapshot?.mode === 'generation' && !held.invalidSnapshot
    const readableAccounting = status.connected || retainedAccounting
    const tenantId = hasReadableCollectionConnection(held) && held.connection && (!params.tenantId || params.tenantId === held.connection.tenant_id)
      ? held.connection.tenant_id : null
    let claim: BillingClaim | null = null
    // Match the previous queue-mount boundary: no free-day claim during
    // first-value onboarding, permission recovery, or invalid accounting.
    if (!paid && tenantId && readableAccounting && !held.invalidSnapshot && !shouldObserveFirstXeroSync(status) &&
      hasReadableCollectionConnection(held)) {
      const { data, error } = await admin.rpc('claim_billing_usage_day', {
        p_user_id: params.userId, p_tenant_id: tenantId,
        p_usage_date: date, p_free_usage_days_limit: FREE_USAGE_DAYS,
      })
      if (error || !data) throw new Error('Dashboard usage claim unavailable')
      claim = (Array.isArray(data) ? data[0] : data) as BillingClaim | null
    }
    const entitlement: ActionsEntitlementStatus = { plan: paid ? 'paid' : 'free', isPaid: paid,
      paidPlan: paid ? resolveConfiguredPaidPlan(held.subscription?.stripe_price_id) : null,
      tenantId, usageDaysConsumed: paid ? 0 : claim?.usage_days_consumed ?? 0,
      usageDaysRemaining: paid ? null : Math.max(0, FREE_USAGE_DAYS - (claim?.usage_days_consumed ?? 0)),
      freeUsageDaysLimit: FREE_USAGE_DAYS, hasActionsAccess: Boolean(tenantId && (paid || claim?.allowed)),
      usageDate: date, usageDateConsumed: !paid && Boolean(claim?.allowed || claim?.usage_date_already_recorded) }
    let collection = null
    let collectionState: 'ready' | 'preparing' | 'unavailable' | 'blocked' | 'onboarding' = 'onboarding'
    if (status.connected && !tenantId) {
      collectionState = 'unavailable'
      collection = { ok: false, code: 'NO_XERO_TENANT', entitlement }
    }
    if (readableAccounting && tenantId && (held.invalidSnapshot || !shouldObserveFirstXeroSync(status))) {
      if (held.invalidSnapshot) collectionState = 'unavailable'
      else if (!entitlement.hasActionsAccess) {
        collectionState = 'blocked'
        collection = { ok: false, code: 'ACTION_USAGE_LIMIT_REACHED', entitlement, tenantId }
      } else {
        const at = performance.now()
        try {
          const p = await readCollectionQueueProjection({ admin, userId: params.userId, tenantId,
            evaluationInstant: now, overdueOnly: true, limit: DASHBOARD_QUEUE_LIMIT,
            legacyTodayDateIso: date, requireCurrentDate: !params.evaluationInstant })
          metrics.customersExamined = p.metrics.customersExamined; metrics.customersReturned = p.rows.length
          metrics.calculationRebuilt ||= p.metrics.calculationRebuilt
          const currencyAccess = resolveCollectionsCurrencyAccess({ entitlement, currencyContext: p.metadata.currencyContext })
          collectionState = currencyAccess.allowed ? 'ready' : 'blocked'
          collection = compactDashboardCollection({ ok: currencyAccess.allowed, tenantId, entitlement,
            ...(currencyAccess.allowed ? {} : { code: 'MULTI_CURRENCY_REQUIRES_PRO' }),
            rows: currencyAccess.allowed ? p.rows : [],
            actionsTakenByCustomerId: currencyAccess.allowed ? Object.fromEntries(Object.entries(p.actionsTakenByCustomerId)
              .filter(([id]) => p.rows.some(row => row.customer_source_id === id))) : {},
            queue: p.queue, experience: p.experience, version: p.version,
            followUpSchedule: p.followUpSchedule ?? undefined,
            organisationBaseCurrency: p.metadata.organisationBaseCurrency,
            currencyContext: p.metadata.currencyContext, currencyAccess, currencyHealth: p.metadata.currencyHealth,
            reviewRequiredCustomers: currencyAccess.allowed ? p.reviews : [] })
          if (p.version.accountingGenerationId !== held.snapshot?.syncRunId ||
            p.version.financialEpoch !== held.financialEpoch) continue
        } catch (cause) {
          if (cause instanceof FastQueueUnavailable && (cause.reason === 'schema' || cause.reason === 'legacy')) throw new DashboardSchemaUnavailable()
          collectionState = cause instanceof FastQueueUnavailable && cause.reason === 'preparing' ? 'preparing' : 'unavailable'
        } finally { metrics.projectionMs += performance.now() - at }
      }
    }
    const current = await context()
    if (held.accessDigest !== current.accessDigest || held.snapshot?.syncRunId !== current.snapshot?.syncRunId ||
      held.financialEpoch !== current.financialEpoch || held.projectionRevision !== current.projectionRevision ||
      (collection && 'version' in collection && collection.version?.projectionRevision !== current.projectionRevision)) continue
    if (!params.evaluationInstant && date !== new Date().toISOString().slice(0, 10)) return readDashboardBootstrap({ ...params, evaluationInstant: undefined })
    return { ok: true as const, status: dashboardConnectionStatus(current, now),
      statusError: (current.statusUnavailable || current.invalidSnapshot) ? 'Unable to check your Xero connection right now.' : null,
      collectionState, collection, metrics: { ...metrics, totalMs: performance.now() - start,
        applicationMs: Math.max(0, performance.now() - start - metrics.databaseWaitMs) } }
  }
  return { ok: true as const, status: null, statusError: 'Unable to check your Xero connection right now.',
    collectionState: 'preparing' as const, collection: null,
    metrics: { ...metrics, totalMs: performance.now() - start, applicationMs: performance.now() - start - metrics.databaseWaitMs } }
}
export type DashboardBootstrap = Awaited<ReturnType<typeof readDashboardBootstrap>>
