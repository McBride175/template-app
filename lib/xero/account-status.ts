export const XERO_STATUS_UNAVAILABLE_MESSAGE = 'Unable to check your Xero connection right now.'

export type XeroSyncState =
  | 'active'
  | 'reconnect_required'
  | 'temporary_sync_issue'
  | 'sync_in_progress'
  | 'disconnected'

export type XeroAuthState = 'active' | 'reauth_required' | 'disconnected' | 'error'

export interface XeroConnectionSummary {
  tenantId: string
  tenantName: string | null
  authState: XeroAuthState
  syncState: XeroSyncState
  syncMessage: string
  canSync: boolean
  needsReauth: boolean
  hasError: boolean
  hasTemporaryIssue?: boolean
  reauthRequiredAt: string | null
  updatedAt: string
}

export interface XeroConnectionStatus {
  connected: boolean
  needsReauth?: boolean
  hasError?: boolean
  hasTemporaryIssue?: boolean
  syncState?: XeroSyncState
  syncMessage?: string | null
  canSync?: boolean
  canAccessInternalTools?: boolean
  authState?: XeroAuthState | null
  reauthRequiredAt?: string | null
  tenantId: string | null
  tenantName: string | null
  lastSyncedAt: string | null
  connections: XeroConnectionSummary[]
  diagnostics?: {
    refreshIssueCode?: string | null
  } | null
}

export type XeroAccountStatusViewState =
  | 'loading'
  | 'connected'
  | 'disconnected'
  | 'reconnect_required'
  | 'temporary_issue'
  | 'error'

type XeroStatusFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>

export class XeroStatusRequestError extends Error {
  readonly status: number

  constructor(status: number) {
    super(XERO_STATUS_UNAVAILABLE_MESSAGE)
    this.name = 'XeroStatusRequestError'
    this.status = status
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isXeroConnectionStatus(value: unknown): value is XeroConnectionStatus {
  if (!isRecord(value)) return false

  return (
    typeof value.connected === 'boolean' &&
    (typeof value.tenantId === 'string' || value.tenantId === null) &&
    (typeof value.tenantName === 'string' || value.tenantName === null) &&
    (typeof value.lastSyncedAt === 'string' || value.lastSyncedAt === null) &&
    Array.isArray(value.connections)
  )
}

export async function fetchXeroConnectionStatus(
  tenantId: string | null,
  fetcher: XeroStatusFetcher = fetch
) {
  const params = new URLSearchParams()
  if (tenantId) {
    params.set('tenantId', tenantId)
  }
  const url = params.size > 0 ? `/api/xero/status?${params.toString()}` : '/api/xero/status'

  const response = await fetcher(url, {
    cache: 'no-store',
    credentials: 'include',
  })

  if (!response.ok) {
    throw new XeroStatusRequestError(response.status)
  }

  const payload: unknown = await response.json()
  if (!isXeroConnectionStatus(payload)) {
    throw new Error(XERO_STATUS_UNAVAILABLE_MESSAGE)
  }

  return payload
}

export function resolveXeroAccountStatusView(params: {
  loading: boolean
  status: XeroConnectionStatus | null
  statusError: string | null
}): XeroAccountStatusViewState {
  const { loading, status, statusError } = params

  if (!status) {
    if (loading) return 'loading'
    if (statusError) return 'error'
    return 'loading'
  }

  if (
    status.needsReauth ||
    status.hasError ||
    status.syncState === 'reconnect_required' ||
    status.authState === 'reauth_required' ||
    status.authState === 'error'
  ) {
    return 'reconnect_required'
  }

  if (
    status.hasTemporaryIssue ||
    status.syncState === 'temporary_sync_issue' ||
    status.syncState === 'sync_in_progress'
  ) {
    return 'temporary_issue'
  }

  return status.connected ? 'connected' : 'disconnected'
}

export function shouldShowXeroConnectCta(viewState: XeroAccountStatusViewState) {
  return viewState === 'disconnected'
}
