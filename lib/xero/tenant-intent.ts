export interface XeroTenantIntentConnection {
  tenantId?: string | null
  authEventId?: string | null
}

export function getXeroAuthenticationEventId(accessToken: string) {
  const parts = accessToken.split('.')
  if (parts.length !== 3 || !parts[1]) return null

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      authentication_event_id?: unknown
    }
    const eventId = payload.authentication_event_id
    return typeof eventId === 'string' && eventId.trim().length > 0 ? eventId.trim() : null
  } catch {
    return null
  }
}

export function resolveXeroIntendedTenantId(params: {
  connections: XeroTenantIntentConnection[]
  authenticationEventId: string | null
  explicitReturnTenantId: string | null
}) {
  const tenantIds = Array.from(
    new Set(
      params.connections
        .map((connection) => connection.tenantId?.trim())
        .filter((tenantId): tenantId is string => Boolean(tenantId))
    )
  )

  if (
    params.explicitReturnTenantId &&
    tenantIds.includes(params.explicitReturnTenantId)
  ) {
    return params.explicitReturnTenantId
  }

  if (params.authenticationEventId) {
    const eventTenantIds = Array.from(
      new Set(
        params.connections
          .filter(
            (connection) => connection.authEventId?.trim() === params.authenticationEventId
          )
          .map((connection) => connection.tenantId?.trim())
          .filter((tenantId): tenantId is string => Boolean(tenantId))
      )
    )

    if (eventTenantIds.length === 1) return eventTenantIds[0]
  }

  return tenantIds.length === 1 ? tenantIds[0] : null
}
