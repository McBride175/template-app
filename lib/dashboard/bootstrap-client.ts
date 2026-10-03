import type { XeroConnectionStatus } from '@/lib/xero/account-status'
import { shouldApplyQueueResponse, type QueueResponseStamp } from '@/lib/collections/queue-response-order'

export interface DashboardBootstrapPayload {
  ok: true
  status: XeroConnectionStatus | null
  statusError: string | null
  collectionState: 'ready' | 'preparing' | 'unavailable' | 'blocked' | 'onboarding'
  collection: {
    ok?: boolean; code?: string; tenantId?: string;
    version?: { accountingGenerationId: string; financialEpoch: string; projectionRevision: string; evaluationDate: string }
  } | null
}
export class DashboardRequestError extends Error {
  constructor(readonly status: number) { super('Unable to load your dashboard right now.') }
}
export async function fetchDashboardBootstrap(tenantId: string | null, signal?: AbortSignal) {
  const query = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''
  const response = await fetch(`/api/dashboard/bootstrap${query}`, { credentials: 'include', cache: 'no-store', signal })
  const payload = await response.json().catch(() => null) as DashboardBootstrapPayload | null
  if (!response.ok || !payload?.ok) throw new DashboardRequestError(response.status)
  return payload
}
export function dashboardResponseStamp(payload: DashboardBootstrapPayload, requestSequence: number): QueueResponseStamp {
  const v = payload.collection?.version
  return { tenantId: payload.status?.tenantId ?? payload.collection?.tenantId ?? null,
    accountingGenerationId: v?.accountingGenerationId ?? null,
    financialEpoch: v?.financialEpoch ?? null, projectionRevision: v?.projectionRevision ?? null, requestSequence }
}
export function shouldApplyDashboardResponse(current: QueueResponseStamp | null, incoming: QueueResponseStamp) {
  if (current && incoming.requestSequence < current.requestSequence) return false
  return shouldApplyQueueResponse(current, incoming)
}

export async function fetchDashboardReadiness(tenantId: string | null, signal: AbortSignal) {
  const query = new URLSearchParams({ readinessOnly: 'true' })
  if (tenantId) query.set('tenantId', tenantId)
  const response = await fetch(`/api/dashboard/bootstrap?${query}`, { credentials: 'include', cache: 'no-store', signal })
  if (!response.ok) throw new DashboardRequestError(response.status)
  return await response.json() as { status: XeroConnectionStatus | null; version: {
    accountingGenerationId: string | null; financialEpoch: string; projectionRevision: string
  } | null }
}
