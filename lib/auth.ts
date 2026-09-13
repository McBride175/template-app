/**
 * Client-side auth helpers
 *
 * TEMPLATE CODE: small wrapper to centralize Supabase auth calls.
 */
import { supabase } from '@/lib/supabase'

export function signInWithPassword(email: string, password: string, captchaToken?: string) {
  return supabase.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken },
  })
}

export function signUpWithPassword(
  email: string,
  password: string,
  emailRedirectTo: string,
  captchaToken?: string
) {
  return supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo, captchaToken },
  })
}

export function signInWithEmailOtp(
  email: string,
  emailRedirectTo: string,
  captchaToken?: string
) {
  return supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo,
      shouldCreateUser: false,
      captchaToken,
    },
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

export function sendPasswordRecovery(email: string, redirectTo: string, captchaToken?: string) {
  return supabase.auth.resetPasswordForEmail(email, { redirectTo, captchaToken })
}
