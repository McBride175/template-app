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
  // Prevent open redirects: only allow same-origin relative paths.
  const next =
    rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//')
      ? rawNext
      : '/dashboard'

  // Create Supabase client with request/response cookies
  const response = NextResponse.redirect(`${origin}${next}`)

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
    return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
  }

  if (tokenHash && type) {
    if (!isEmailOtpType(type)) {
      return NextResponse.redirect(`${origin}/login?error=auth_otp_error`)
    }

    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    })
    if (!error) return response
    return NextResponse.redirect(`${origin}/login?error=auth_otp_error`)
  }

  // No code parameter - redirect to login
  return NextResponse.redirect(`${origin}/login?error=auth_missing_params`)
}
