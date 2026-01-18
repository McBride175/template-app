'use client'

import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <button
        onClick={signInWithGoogle}
        className="rounded-md px-4 py-2 border"
      >
        Sign in with Google
      </button>
    </main>
  )
}