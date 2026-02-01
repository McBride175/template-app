/**
 * OAuth Callback Route Handler
 * 
 * TEMPLATE CODE: This route handles OAuth callbacks from Supabase Auth.
 * Exchanges the authorization code for a session server-side and sets cookies.
 * 
 * This ensures SSR cookies are properly established so middleware and API routes
 * can read the session.
 */
import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const rawNext = searchParams.get('next')
  // Prevent open redirects: only allow same-origin relative paths.
  const next =
    rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//')
      ? rawNext
      : '/dashboard'

  if (code) {
    // Create Supabase client with request/response cookies
    let response = NextResponse.redirect(`${origin}${next}`)

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

    // Exchange code for session - this sets cookies via setAll callback
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Success - cookies are set, redirect to dashboard
      return response
    }

    // Error exchanging code - redirect to login with error
    return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
  }

  // No code parameter - redirect to login
  return NextResponse.redirect(`${origin}/login`)
}
