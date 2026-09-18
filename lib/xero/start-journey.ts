import type { XeroConnectionStatus, XeroConnectionSummary } from '@/lib/xero/account-status'

export type StartJourneyDecision =
  | { kind: 'connect' }
  | { kind: 'prepare'; tenantId: string }
  | { kind: 'continue'; tenantId: string }
  | { kind: 'select_organisation'; connections: XeroConnectionSummary[] }
  | { kind: 'invalid_selection'; connections: XeroConnectionSummary[] }
  | { kind: 'reconnect'; tenantId: string | null }
  | { kind: 'permission_upgrade'; tenantId: string | null }

function isUsableConnection(connection: XeroConnectionSummary) {
  return connection.authState === 'active' && connection.canSync
}

function needsReconnect(connection: XeroConnectionSummary) {
  return (
    connection.authState === 'reauth_required' ||
    connection.authState === 'error' ||
    connection.syncState === 'reconnect_required'
  )
}

function nextUsableConnectionStep(status: XeroConnectionStatus, tenantId: string) {
  return status.tenantId === tenantId && status.lastSyncedAt
    ? { kind: 'continue' as const, tenantId }
    : { kind: 'prepare' as const, tenantId }
}

export function resolveStartJourney(
  status: XeroConnectionStatus,
  requestedTenantId: string | null
): StartJourneyDecision {
  const requestedConnection = requestedTenantId
    ? status.connections.find((connection) => connection.tenantId === requestedTenantId) ?? null
    : null

  if (requestedTenantId && !requestedConnection) {
    return {
      kind: 'invalid_selection',
      connections: status.connections.filter(isUsableConnection),
    }
  }

  if (requestedConnection) {
    if (
      status.tenantId === requestedConnection.tenantId &&
      status.syncState === 'permission_upgrade_required'
    ) {
      return { kind: 'permission_upgrade', tenantId: requestedConnection.tenantId }
    }

    if (needsReconnect(requestedConnection)) {
      return { kind: 'reconnect', tenantId: requestedConnection.tenantId }
    }

    if (isUsableConnection(requestedConnection)) {
      return nextUsableConnectionStep(status, requestedConnection.tenantId)
    }
  }

  const usableConnections = status.connections.filter(isUsableConnection)

  if (usableConnections.length > 1) {
    return { kind: 'select_organisation', connections: usableConnections }
  }

  if (usableConnections.length === 1) {
    const connection = usableConnections[0]
    if (
      status.tenantId === connection.tenantId &&
      status.syncState === 'permission_upgrade_required'
    ) {
      return { kind: 'permission_upgrade', tenantId: connection.tenantId }
    }
    return nextUsableConnectionStep(status, connection.tenantId)
  }

  const reconnectConnection = status.connections.find(needsReconnect)
  if (reconnectConnection) {
    return { kind: 'reconnect', tenantId: reconnectConnection.tenantId }
  }

  return { kind: 'connect' }
}
