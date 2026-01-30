/**
 * Server-side Supabase client helper
 * 
 * TEMPLATE CODE: This is a reusable helper for server-side Supabase operations.
 * Uses @supabase/ssr for proper cookie handling in Next.js App Router.
 * 
 * SECURITY: This file MUST NOT be imported in client components.
 * It uses server-only APIs (cookies from next/headers).
 * 
 * Note: In Server Components, cookies cannot be set (middleware handles refresh).
 * The setAll method is kept for type compatibility but is a no-op.
 */
import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Create a Supabase server client for use in Server Components and Route Handlers
 * 
 * TEMPLATE CODE: Uses @supabase/ssr with Next.js cookies() API.
 * Middleware handles session refresh, so setAll is a no-op in Server Components.
 */
export async function createSupabaseServerClient() {
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
            // In Server Components, we can't set cookies (middleware handles this)
            // This is kept for type compatibility but is effectively a no-op
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing user sessions.
          }
        },
      },
    }
  )
}
