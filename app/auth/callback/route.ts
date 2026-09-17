/**
 * OAuth Callback Route Handler
 * 
 * TEMPLATE CODE: This route handles OAuth callbacks from Supabase Auth.
 * Exchanges the authorization code for a session server-side and sets cookies.
 * 
 * This ensures SSR cookies are properly established so the proxy and API routes
 * can read the session.
 */
import { createServerClient } from '@supabase/ssr'
import type { EmailOtpType } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import {
  buildAuthFailurePath,
  getAuthErrorCode,
  mapCallbackQueryError,
  sanitizeAuthRedirectPath,
} from '@/lib/auth-flow'

const EMAIL_OTP_TYPES = new Set<string>([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
] satisfies EmailOtpType[])

function isEmailOtpType(value: string): value is EmailOtpType {
  return EMAIL_OTP_TYPES.has(value)
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const rawNext = searchParams.get('next')
  const providerError = searchParams.get('error')
  const providerErrorCode = searchParams.get('error_code')
  const defaultNext = type === 'recovery' ? '/reset-password' : undefined
  const next = sanitizeAuthRedirectPath(rawNext, defaultNext)

  const loginRedirect = (errorCode: string) =>
    NextResponse.redirect(new URL(buildAuthFailurePath(next, errorCode), origin))

  if (providerError || providerErrorCode) {
    return loginRedirect(mapCallbackQueryError(providerError, providerErrorCode))
  }

  if (!code && !(tokenHash && type)) {
    return loginRedirect('auth_missing_params')
  }

  // Create Supabase client with request/response cookies
  const response = NextResponse.redirect(new URL(next, origin))

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Set cookies on the response
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  if (code) {
    // Exchange code for session - this sets cookies via setAll callback
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return response
    return loginRedirect(mapCallbackQueryError(null, getAuthErrorCode(error)))
  }

  if (tokenHash && type) {
    if (!isEmailOtpType(type)) {
      return loginRedirect('auth_otp_error')
    }

    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    })
    if (!error) return response
    return loginRedirect(getAuthErrorCode(error) === 'otp_expired' ? 'auth_link_expired' : 'auth_otp_error')
  }

  return loginRedirect('auth_missing_params')
}
