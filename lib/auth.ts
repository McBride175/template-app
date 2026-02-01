/**
 * Client-side auth helpers
 *
 * TEMPLATE CODE: small wrapper to centralize Supabase auth calls.
 */
import { supabase } from '@/lib/supabase'

export function signInWithPassword(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password })
}

export function signUpWithPassword(email: string, password: string) {
  return supabase.auth.signUp({ email, password })
}

export function signInWithEmailOtp(email: string, emailRedirectTo: string) {
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo },
  })
}

export function signInWithGoogle(redirectTo: string) {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  })
}

export function signOut() {
  return supabase.auth.signOut()
}
