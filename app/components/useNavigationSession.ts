'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

// Shared display state and the existing sign-out behaviour; not an auth guard.
export default function useNavigationSession() {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  useEffect(() => {
    // Validate the initial user rather than trusting session data from browser storage.
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null)
      setLoading(false)
    })

    // Listen for auth changes
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
      }
    )

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  const signOut = async () => {
    setSignOutError(null)
    setSigningOut(true)
    try {
      const { error } = await supabase.auth.signOut()
      if (error) {
        setSignOutError('We couldn\'t sign you out. Check your connection and try again.')
        return
      }
      // A full navigation avoids racing protected-page auth listeners that may
      // issue their own client-side redirect in response to SIGNED_OUT.
      window.location.replace('/login?status=signed_out')
    } catch {
      setSignOutError('We couldn\'t sign you out. Check your connection and try again.')
    } finally {
      setSigningOut(false)
    }
  }

  return { loading, user, signingOut, signOutError, signOut }
}
