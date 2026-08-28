import crypto from 'node:crypto'

export const PRIVACY_REQUEST_TYPES = [
  'ACCESS_EXPORT',
  'RECTIFICATION',
  'RESTRICTION',
  'OBJECTION',
  'ERASURE',
]

export const PRIVACY_REQUEST_STATUSES = [
  'RECEIVED',
  'VERIFYING',
  'IN_PROGRESS',
  'FULFILLED',
  'DENIED',
]

const FINAL_STATUSES = new Set(['FULFILLED', 'DENIED'])

const SECRET_KEY_PATTERN = /(password|secret|token|api[_-]?key|session|refresh)/i

export function isPrivacyRequestType(value) {
  return PRIVACY_REQUEST_TYPES.includes(value)
}

export function isPrivacyRequestStatus(value) {
  return PRIVACY_REQUEST_STATUSES.includes(value)
}

export function computeDueAtIso(createdAtIso) {
  const createdAtMs = Date.parse(createdAtIso)
  if (Number.isNaN(createdAtMs)) {
    throw new Error('Invalid createdAt timestamp')
  }

  return new Date(createdAtMs + 30 * 24 * 60 * 60 * 1000).toISOString()
}

export function isOverdue(dueAt, status, now = Date.now()) {
  return !FINAL_STATUSES.has(status) && Date.parse(dueAt) < now
}

export function canAccessPrivacyResource({ actorUserId, ownerUserId, isAdmin }) {
  if (isAdmin) return true
  if (!actorUserId || !ownerUserId) return false
  return actorUserId === ownerUserId
}

export function parseAdminEmails(input) {
  return new Set(
    (input || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  )
}

export function isAdminEmail(email, list) {
  if (!email) return false
  return parseAdminEmails(list).has(email.trim().toLowerCase())
}

export function decodeJwtPayload(token) {
  const parts = token.split('.')
  if (parts.length < 2) return null

  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8')
    return JSON.parse(payload)
  } catch {
    return null
  }
}

export function isSessionRecent(accessToken, maxAgeSeconds = 1800, nowMs = Date.now()) {
  if (!accessToken) return false

  const payload = decodeJwtPayload(accessToken)
  if (!payload || typeof payload.iat !== 'number') return false

  const tokenIssuedAtMs = payload.iat * 1000
  return nowMs - tokenIssuedAtMs <= maxAgeSeconds * 1000
}

export function stripSecretsFromObject(input) {
  if (input === null || input === undefined) {
    return input
  }

  if (Array.isArray(input)) {
    return input.map((value) => stripSecretsFromObject(value))
  }

  if (typeof input !== 'object') {
    return input
  }

  const output = {}

  for (const [key, value] of Object.entries(input)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      continue
    }

    output[key] = stripSecretsFromObject(value)
  }

  return output
}

export function getSafeAuthUser(authUser) {
  if (!authUser || typeof authUser !== 'object') {
    return null
  }

  const safeUser = {
    id: authUser.id || null,
    email: authUser.email || null,
    phone: authUser.phone || null,
    created_at: authUser.created_at || null,
    confirmed_at: authUser.confirmed_at || null,
    last_sign_in_at: authUser.last_sign_in_at || null,
    user_metadata: authUser.user_metadata || {},
    app_metadata: authUser.app_metadata || {},
  }

  return stripSecretsFromObject(safeUser)
}

export function applyRestrictionFlags(current, payload) {
  const base = {
    processing_restricted: Boolean(current.processing_restricted),
    marketing_opt_out: Boolean(current.marketing_opt_out),
    analytics_opt_out: Boolean(current.analytics_opt_out),
    ai_processing_opt_out: Boolean(current.ai_processing_opt_out),
  }

  if (payload.processingRestricted === undefined || payload.processingRestricted === true) {
    base.processing_restricted = true
  } else {
    base.processing_restricted = false
  }

  if (typeof payload.marketingOptOut === 'boolean') {
    base.marketing_opt_out = payload.marketingOptOut
  }

  if (typeof payload.analyticsOptOut === 'boolean') {
    base.analytics_opt_out = payload.analyticsOptOut
  }

  if (typeof payload.aiProcessingOptOut === 'boolean') {
    base.ai_processing_opt_out = payload.aiProcessingOptOut
  }

  return base
}

export function applyObjectionFlags(current, payload) {
  const base = {
    processing_restricted: Boolean(current.processing_restricted),
    marketing_opt_out: Boolean(current.marketing_opt_out),
    analytics_opt_out: Boolean(current.analytics_opt_out),
    ai_processing_opt_out: Boolean(current.ai_processing_opt_out),
  }

  base.marketing_opt_out = payload.marketing !== false
  base.analytics_opt_out = payload.analytics !== false
  base.ai_processing_opt_out = payload.ai !== false

  if (payload.restrictProcessing === true) {
    base.processing_restricted = true
  }

  return base
}

export function getErasureAuditActions() {
  return ['ERASURE_REQUEST_RECEIVED', 'ERASURE_REQUEST_IN_PROGRESS', 'ERASURE_REQUEST_FULFILLED']
}

export function signExportToken({ userId, exportId, expiresAt, secret }) {
  const payload = JSON.stringify({ userId, exportId, exp: expiresAt })
  const encodedPayload = Buffer.from(payload).toString('base64url')
  const signature = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url')

  return `${encodedPayload}.${signature}`
}

export function verifyExportToken({ token, secret }) {
  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [encodedPayload, signature] = parts
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url')

  if (signature !== expectedSignature) {
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
    if (!payload || typeof payload.exp !== 'number') return null
    return payload
  } catch {
    return null
  }
}
