/**
 * Browser-side Supabase client
 * 
 * TEMPLATE CODE: This is the client-side Supabase client for use in browser components.
 * Uses @supabase/ssr (createBrowserClient) to properly handle cookies and session sync.
 * 
 * SECURITY: This file is for client-side use only. Do NOT use service role key here.
 */
import { createBrowserClient } from '@supabase/ssr'

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// Export a singleton instance for convenience
export const supabase = createSupabaseBrowserClient()
