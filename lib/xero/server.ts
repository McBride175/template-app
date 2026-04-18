import 'server-only'
import { randomBytes, timingSafeEqual } from 'node:crypto'

const XERO_AUTH_BASE_URL = 'https://login.xero.com/identity/connect/authorize'
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections'

export const XERO_STATE_COOKIE_NAME = 'xero_oauth_state'
export const XERO_STATE_USER_COOKIE_NAME = 'xero_oauth_state_user'
export const XERO_SCOPES = [
  'offline_access',
  'accounting.settings.read',
  'accounting.reports.read',
  'accounting.contacts.read',
  'accounting.transactions.read',
] as const

export interface XeroTokenResponse {
  access_token: string
  expires_in: number
  token_type: string
  refresh_token: string
  scope: string
  xero_userid?: string
}

export interface XeroConnection {
  id: string
  tenantId: string
  tenantName: string
  tenantType: string
  createdDateUtc: string
  updatedDateUtc: string
}

export function getXeroConfig() {
  const clientId = process.env.XERO_CLIENT_ID
  const clientSecret = process.env.XERO_CLIENT_SECRET
  const redirectUri = process.env.XERO_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Missing Xero env vars: XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REDIRECT_URI'
    )
  }

  return { clientId, clientSecret, redirectUri }
}

export function buildXeroAuthorizationUrl(params: { state: string }) {
  const { clientId, redirectUri } = getXeroConfig()
  const authUrl = new URL(XERO_AUTH_BASE_URL)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', XERO_SCOPES.join(' '))
  authUrl.searchParams.set('state', params.state)
  return authUrl.toString()
}

export function createOAuthState() {
  return randomBytes(32).toString('hex')
}

export function safeEqualStrings(a: string, b: string) {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)

  if (aBuf.length !== bBuf.length) {
    return false
  }

  return timingSafeEqual(aBuf, bBuf)
}

export function getXeroTokenUrl() {
  return XERO_TOKEN_URL
}

export function getXeroConnectionsUrl() {
  return XERO_CONNECTIONS_URL
}
