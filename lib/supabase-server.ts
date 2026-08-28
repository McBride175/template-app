/**
 * Server-side Supabase client helper
 * 
 * TEMPLATE CODE: This is a reusable helper for server-side Supabase operations.
 * Uses @supabase/ssr for proper cookie handling in Next.js App Router.
 * 
 * SECURITY: This file MUST NOT be imported in client components.
 * It uses server-only APIs (cookies from next/headers).
 */
import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createServerSupabaseClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored because the proxy refreshes
            // user sessions.
          }
        },
      },
    }
  )
}

/**
 * Get the current authenticated user from the server-side session
 * 
 * TEMPLATE CODE: Reusable helper to get user in server components/route handlers
 */
export async function getServerUser() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}
