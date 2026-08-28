/**
 * Next.js Proxy: Supabase Session Refresh
 * 
 * TEMPLATE CODE: This proxy refreshes Supabase session cookies on every request.
 * Uses @supabase/ssr to keep the session in sync and prevent auth flicker.
 */
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  // Create a response object we can modify
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  // Create the Supabase client used to refresh the request's session cookies.
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

  // Refresh session by calling getUser() - this updates cookies if needed
  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - api/webhooks/stripe (Stripe webhook endpoint - no auth needed)
     * - auth/callback (Supabase auth callback route)
     */
    '/((?!_next/static|_next/image|favicon.ico|api/webhooks/stripe|auth/callback).*)',
  ],
}
