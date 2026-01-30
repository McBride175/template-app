/**
 * Browser-side Supabase client
 * 
 * TEMPLATE CODE: Re-export from client.ts for backward compatibility.
 * Uses @supabase/ssr (createBrowserClient) instead of @supabase/supabase-js
 * to properly handle cookies and session sync with SSR.
 */
export { supabase } from './supabase/client'