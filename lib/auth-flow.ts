const AUTH_REDIRECT_BASE = 'https://auth-redirect.invalid'

export const DEFAULT_AUTH_DESTINATION = '/dashboard'

const AUTH_ENTRY_PATHS = new Set(['/login', '/signup', '/auth/callback'])
const PROTECTED_PAGE_PREFIXES = [
  '/account',
  '/admin',
  '/collections',
  '/customers',
  '/dashboard',
  '/disputes',
  '/settings',
  '/xero',
]

type AuthErrorLike = {
  code?: unknown
  message?: unknown
  name?: unknown
  status?: unknown
}

export type AuthAction = 'password-login' | 'signup' | 'email-link' | 'password-update' | 'google'

function firstString(value: string | string[] | null | undefined) {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export function sanitizeAuthRedirectPath(
  value: string | string[] | null | undefined,
  fallback = DEFAULT_AUTH_DESTINATION
) {
  const candidate = firstString(value)
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) {
    return fallback
  }

  try {
    const url = new URL(candidate, AUTH_REDIRECT_BASE)
    if (url.origin !== AUTH_REDIRECT_BASE) return fallback
    if (AUTH_ENTRY_PATHS.has(url.pathname) || url.pathname.startsWith('/auth/callback/')) {
      return fallback
    }
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

export function isProtectedPagePath(pathname: string) {
  return PROTECTED_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

export function isAuthEntryPath(pathname: string) {
  return pathname === '/login' || pathname === '/signup'
}

export function buildAuthCallbackPath(nextPath?: string | null) {
  const callback = new URL('/auth/callback', AUTH_REDIRECT_BASE)
  callback.searchParams.set('next', sanitizeAuthRedirectPath(nextPath))
  return `${callback.pathname}${callback.search}`
}

export function buildPasswordRecoveryCallbackPath(nextPath?: string | null) {
  const resetPage = new URL('/reset-password', AUTH_REDIRECT_BASE)
  resetPage.searchParams.set('next', sanitizeAuthRedirectPath(nextPath))
  return buildAuthCallbackPath(`${resetPage.pathname}${resetPage.search}`)
}

export function buildLoginPath(nextPath?: string | null, errorCode?: string | null) {
  const login = new URL('/login', AUTH_REDIRECT_BASE)
  const safeNext = sanitizeAuthRedirectPath(nextPath)
  if (safeNext !== DEFAULT_AUTH_DESTINATION) login.searchParams.set('next', safeNext)
  if (errorCode) login.searchParams.set('error', errorCode)
  return `${login.pathname}${login.search}`
}

export function buildAuthSwitchPath(
  pathname: '/login' | '/signup',
  nextPath?: string | null,
  email?: string | null
) {
  const destination = new URL(pathname, AUTH_REDIRECT_BASE)
  const safeNext = sanitizeAuthRedirectPath(nextPath)
  const trimmedEmail = email?.trim()

  if (safeNext !== DEFAULT_AUTH_DESTINATION) destination.searchParams.set('next', safeNext)
  if (trimmedEmail) destination.searchParams.set('email', trimmedEmail.slice(0, 320))
  return `${destination.pathname}${destination.search}`
}

export function getAuthErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return null
  const code = (error as AuthErrorLike).code
  return typeof code === 'string' ? code : null
}

export function getAuthActionErrorMessage(error: unknown, action: AuthAction) {
  const code = getAuthErrorCode(error)

  if (code === 'invalid_credentials') {
    return 'We couldn\'t sign you in with that email and password. Try again, continue with Google, or use a secure password link.'
  }
  if (code === 'email_not_confirmed') {
    return 'Confirm your email using the link we sent, then try again.'
  }
  if (code === 'weak_password') {
    return 'Choose a stronger password with at least 10 characters and a mix of character types.'
  }
  if (code === 'same_password') {
    return 'Choose a password you have not used for this account before.'
  }
  if (code === 'reauthentication_needed') {
    return 'For your security, confirm access using a secure password link before changing your password.'
  }
  if (code === 'email_address_invalid') {
    return 'Enter a valid email address and try again.'
  }
  if (code === 'email_address_not_authorized') {
    return 'We could not send an email to that address. Contact support if the address is correct.'
  }
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
    return 'Too many attempts were made in a short time. Wait a few minutes, then try again.'
  }
  if (code === 'provider_disabled' || code === 'oauth_provider_not_supported') {
    return 'Google sign-in is temporarily unavailable. Use email instead or try again later.'
  }
  if (code === 'signup_disabled' || code === 'email_provider_disabled') {
    return 'Email account creation is temporarily unavailable. Try Google or contact support.'
  }
  if (code === 'request_timeout') {
    return 'The request took too long. Check your connection and try again.'
  }

  if (action === 'password-login') {
    return 'We couldn\'t sign you in right now. Check your connection and try again.'
  }
  if (action === 'signup') {
    return 'We couldn\'t create your account right now. Check your connection and try again.'
  }
  if (action === 'email-link') {
    return 'We couldn\'t send the email right now. Check your connection and try again.'
  }
  if (action === 'password-update') {
    return 'We couldn\'t save your password right now. Check your connection and try again.'
  }
  return 'We couldn\'t start Google sign-in right now. Check your connection and try again.'
}

export function mapCallbackQueryError(error: string | null, errorCode: string | null) {
  if (error === 'access_denied' || errorCode === 'access_denied') return 'oauth_cancelled'
  if (errorCode === 'flow_state_expired' || errorCode === 'flow_state_not_found') {
    return 'auth_link_expired'
  }
  return 'auth_callback_error'
}

export function getAuthPageErrorMessage(code: string | string[] | null | undefined) {
  switch (firstString(code)) {
    case 'oauth_cancelled':
      return 'Google sign-in was cancelled. You can try again or use email instead.'
    case 'auth_link_expired':
    case 'auth_otp_error':
      return 'That sign-in link is invalid or has expired. Request a new link and try again.'
    case 'auth_missing_params':
      return 'That sign-in link is incomplete. Start again below.'
    case 'session_expired':
      return 'Your session ended. Sign in again to continue where you left off.'
    case 'reset_link_invalid':
      return 'That password link is invalid or has expired. Enter your email and request a new one.'
    case 'auth_callback_error':
      return 'We couldn\'t complete sign-in. Try again, or use email instead.'
    default:
      return null
  }
}
export function getAuthPageStatusMessage(code: string | string[] | null | undefined) {
  switch (firstString(code)) {
    case 'password_updated':
      return 'Your password was updated. You can now sign in with it.'
    case 'signed_out':
      return 'You\'re signed out.'
    default:
      return null
  }
}
