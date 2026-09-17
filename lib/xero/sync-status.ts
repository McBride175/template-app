export type XeroSyncState =
  | 'active'
  | 'disconnected'
  | 'reconnect_required'
  | 'permission_upgrade_required'
  | 'temporary_sync_issue'
  | 'sync_in_progress'

export const XERO_REFRESH_ISSUE_CODES = {
  MISSING_OAUTH_GRANT: 'missing_oauth_grant',
  TOKEN_DECRYPTION_FAILED: 'token_decryption_failed',
  REFRESH_TOKEN_INVALID: 'refresh_token_invalid',
  REFRESH_LOCK_FAILED: 'refresh_lock_failed',
  REFRESH_RELOAD_FAILED: 'refresh_reload_failed',
  REFRESH_FAILED: 'refresh_failed',
  REFRESH_PERSIST_FAILED: 'refresh_persist_failed',
  REFRESH_IN_PROGRESS: 'refresh_in_progress',
  ACCESS_TOKEN_UNAVAILABLE: 'access_token_unavailable',
  LEGACY_ERROR_STATE: 'legacy_error_state',
  API_AUTH_FAILED_AFTER_FORCED_REFRESH: 'api_auth_failed_after_forced_refresh',
} as const

type XeroAuthState = 'active' | 'reauth_required' | 'disconnected' | 'error'

function isInProgressIssueCode(lastRefreshErrorCode: string | null) {
  return lastRefreshErrorCode === XERO_REFRESH_ISSUE_CODES.REFRESH_IN_PROGRESS
}

export function resolveXeroSyncState(params: {
  authState: XeroAuthState | null | undefined
  lastRefreshErrorCode?: string | null
  grantClassification?:
    | 'granular_ready'
    | 'legacy_broad_compatible'
    | 'permission_upgrade_required'
    | 'reauth_required'
    | 'scope_metadata_unknown'
    | null
  latestAttemptState?: 'none' | 'running' | 'failed' | 'interrupted' | 'promoted'
}) {
  if (params.authState === 'disconnected' || !params.authState) return 'disconnected'
  if (params.authState === 'reauth_required') return 'reconnect_required'
  if (params.grantClassification === 'reauth_required') return 'reconnect_required'
  if (
    params.grantClassification === 'permission_upgrade_required' ||
    params.grantClassification === 'scope_metadata_unknown'
  ) {
    return 'permission_upgrade_required'
  }
  if (params.authState === 'active') {
    if (params.latestAttemptState === 'running') return 'sync_in_progress'
    if (isInProgressIssueCode(params.lastRefreshErrorCode ?? null)) return 'sync_in_progress'
    if (params.lastRefreshErrorCode) return 'temporary_sync_issue'
    return 'active'
  }

  return 'temporary_sync_issue'
}

export function getXeroSyncStateMessage(syncState: XeroSyncState) {
  if (syncState === 'active') return 'Connected and ready to sync.'
  if (syncState === 'disconnected') return 'Connect Xero to start syncing data.'
  if (syncState === 'reconnect_required') return 'Reconnect Xero to continue syncing.'
  if (syncState === 'permission_upgrade_required') {
    return 'Xero has updated its permissions. Reconnect Xero to continue syncing.'
  }
  if (syncState === 'sync_in_progress') return 'A sync is already in progress. Please wait and retry.'
  return 'We hit a temporary sync issue. Please try again shortly.'
}
