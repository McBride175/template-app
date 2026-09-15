const XERO_RETURN_BASE = 'https://xero-return.invalid'

export const DEFAULT_XERO_RETURN_PATH = '/dashboard'

const ALLOWED_XERO_RETURN_PATHS = new Set(['/account', '/dashboard'])

function firstString(value: string | string[] | null | undefined) {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export function sanitizeXeroReturnPath(
  value: string | string[] | null | undefined,
  fallback = DEFAULT_XERO_RETURN_PATH
) {
  const candidate = firstString(value)
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) {
    return fallback
  }

  try {
    const url = new URL(candidate, XERO_RETURN_BASE)
    if (url.origin !== XERO_RETURN_BASE || !ALLOWED_XERO_RETURN_PATHS.has(url.pathname)) {
      return fallback
    }

    const safeParams = new URLSearchParams()
    const tenantId = url.searchParams.get('tenantId')?.trim()
    if (tenantId) safeParams.set('tenantId', tenantId.slice(0, 255))

    const query = safeParams.toString()
    return `${url.pathname}${query ? `?${query}` : ''}`
  } catch {
    return fallback
  }
}

export function buildXeroConnectPath(returnTo?: string | null) {
  const params = new URLSearchParams({
    returnTo: sanitizeXeroReturnPath(returnTo),
  })
  return `/api/xero/connect?${params.toString()}`
}

export function buildXeroCallbackDestination(params: {
  returnTo?: string | null
  result: 'connected' | 'error'
  reason?: string | null
  tenantId?: string | null
}) {
  const destination = new URL(sanitizeXeroReturnPath(params.returnTo), XERO_RETURN_BASE)
  destination.searchParams.set('xero', params.result)

  if (params.result === 'error' && params.reason) {
    destination.searchParams.set('reason', params.reason)
  }
  if (params.result === 'connected' && params.tenantId) {
    destination.searchParams.set('tenantId', params.tenantId)
  }

  return `${destination.pathname}${destination.search}`
}

export type XeroCallbackNotice =
  | { kind: 'success'; message: string }
  | { kind: 'cancelled' | 'expired' | 'error'; message: string }

export function getXeroCallbackNotice(
  result: string | null,
  reason: string | null
): XeroCallbackNotice | null {
  if (result === 'connected') {
    return {
      kind: 'success',
      message: 'Xero is connected. We are preparing your collection priorities.',
    }
  }

  if (result !== 'error') return null

  if (reason === 'cancelled') {
    return {
      kind: 'cancelled',
      message: 'Xero wasn\'t connected. No data was changed.',
    }
  }

  if (reason === 'invalid_state') {
    return {
      kind: 'expired',
      message: 'That secure connection attempt expired. Please try again.',
    }
  }

  if (reason === 'permission_upgrade_required') {
    return {
      kind: 'error',
      message: 'Xero needs updated permissions before it can sync. Reconnect Xero to continue.',
    }
  }

  return {
    kind: 'error',
    message: 'We couldn\'t connect to Xero. Try again.',
  }
}
