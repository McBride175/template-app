import 'server-only'
import { getXeroConfig, getXeroTokenUrl } from '@/lib/xero/server'

const XERO_ACCOUNTING_API_BASE = 'https://api.xero.com/api.xro/2.0'

export type XeroResourceType =
  | 'accounts'
  | 'contacts'
  | 'invoices'
  | 'organisations'
  | 'organisation_actions'

export interface XeroConnectionCredentials {
  accessToken: string | null
  refreshToken: string
  expiresAt: string | null
  tenantId: string
}

interface XeroTokenRefreshResponse {
  access_token: string
  refresh_token: string
  expires_in: number
}

interface XeroTokenRefreshErrorResponse {
  error?: string
  error_description?: string
}

export class XeroTokenRefreshError extends Error {
  status: number
  code: string | null
  description: string | null
  requiresReauth: boolean

  constructor(params: {
    status: number
    code?: string | null
    description?: string | null
    requiresReauth: boolean
  }) {
    const messageParts = [`Token refresh failed (${params.status})`]
    if (params.code) {
      messageParts.push(`code=${params.code}`)
    }
    if (params.description) {
      messageParts.push(`description=${params.description}`)
    }
    super(messageParts.join(', '))
    this.status = params.status
    this.code = params.code ?? null
    this.description = params.description ?? null
    this.requiresReauth = params.requiresReauth
  }
}

export class XeroAccountingApiError extends Error {
  status: number
  resourceType: XeroResourceType
  responseBody: string | null
  isAuthRelated: boolean

  constructor(params: {
    status: number
    resourceType: XeroResourceType
    responseBody?: string | null
  }) {
    const messageParts = [`Failed to fetch ${params.resourceType} (${params.status})`]
    if (params.responseBody) {
      messageParts.push(`body=${params.responseBody}`)
    }
    super(messageParts.join(', '))
    this.status = params.status
    this.resourceType = params.resourceType
    this.responseBody = params.responseBody ?? null
    this.isAuthRelated = params.status === 401 || params.status === 403
  }
}

function requiresReauthFromRefreshFailure(
  status: number,
  errorCode: string | null,
  errorDescription: string | null
) {
  const normalizedErrorCode = errorCode?.trim().toLowerCase() ?? null
  if (normalizedErrorCode === 'invalid_grant') return true
  if (normalizedErrorCode === 'invalid_token') return true

  const description = errorDescription?.toLowerCase() ?? ''
  if (description.includes('refresh token') && description.includes('expired')) return true
  if (description.includes('refresh token') && description.includes('revoked')) return true
  if (status === 401 && description.includes('token')) return true

  return false
}

export const XERO_RESOURCE_CONFIG: Record<
  XeroResourceType,
  { endpoint: string; responseKey: string; sourceIdKey: string }
> = {
  accounts: {
    endpoint: '/Accounts',
    responseKey: 'Accounts',
    sourceIdKey: 'AccountID',
  },
  contacts: {
    endpoint: '/Contacts',
    responseKey: 'Contacts',
    sourceIdKey: 'ContactID',
  },
  invoices: {
    endpoint: '/Invoices',
    responseKey: 'Invoices',
    sourceIdKey: 'InvoiceID',
  },
  organisations: {
    endpoint: '/Organisation',
    responseKey: 'Organisations',
    sourceIdKey: 'OrganisationID',
  },
  organisation_actions: {
    endpoint: '/Organisation/Actions',
    responseKey: 'Actions',
    sourceIdKey: 'Name',
  },
}

export function shouldRefreshXeroAccessToken(expiresAt: string | null, safetySeconds = 120) {
  if (!expiresAt) return true
  const expiresAtMs = new Date(expiresAt).getTime()
  if (Number.isNaN(expiresAtMs)) return true
  const nowWithBufferMs = Date.now() + safetySeconds * 1000
  return expiresAtMs <= nowWithBufferMs
}

export async function refreshXeroAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = getXeroConfig()
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const response = await fetch(getXeroTokenUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  })

  if (!response.ok) {
    let payload: XeroTokenRefreshErrorResponse | null = null
    try {
      payload = (await response.json()) as XeroTokenRefreshErrorResponse
    } catch {
      payload = null
    }

    const errorCode = typeof payload?.error === 'string' ? payload.error : null
    const errorDescription =
      typeof payload?.error_description === 'string' ? payload.error_description : null
    const requiresReauth = requiresReauthFromRefreshFailure(
      response.status,
      errorCode,
      errorDescription
    )

    throw new XeroTokenRefreshError({
      status: response.status,
      code: errorCode,
      description: errorDescription,
      requiresReauth,
    })
  }

  const payload = (await response.json()) as Partial<XeroTokenRefreshResponse>

  if (
    !payload.access_token ||
    !payload.refresh_token ||
    typeof payload.expires_in !== 'number'
  ) {
    throw new Error('Token refresh response was missing required fields')
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString(),
  }
}

export async function fetchXeroAccountingResource(
  resourceType: XeroResourceType,
  accessToken: string,
  tenantId: string
) {
  const resource = XERO_RESOURCE_CONFIG[resourceType]
  const response = await fetch(`${XERO_ACCOUNTING_API_BASE}${resource.endpoint}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'xero-tenant-id': tenantId,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    let responseBody: string | null = null
    try {
      responseBody = await response.text()
    } catch {
      responseBody = null
    }

    throw new XeroAccountingApiError({
      status: response.status,
      resourceType,
      responseBody,
    })
  }

  const payload = (await response.json()) as Record<string, unknown>
  const records = payload[resource.responseKey]

  if (!Array.isArray(records)) {
    throw new Error(`Invalid ${resourceType} response payload`)
  }

  return records as Array<Record<string, unknown>>
}

export function getXeroSourceId(resourceType: XeroResourceType, record: Record<string, unknown>) {
  const sourceIdRaw = record[XERO_RESOURCE_CONFIG[resourceType].sourceIdKey]
  if (!sourceIdRaw || typeof sourceIdRaw !== 'string') {
    return null
  }
  return sourceIdRaw
}
