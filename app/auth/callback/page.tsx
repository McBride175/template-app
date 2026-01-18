'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    const run = async () => {
      await supabase.auth.getSession()
      router.replace('/dashboard')
    }
    run()
  }, [router])

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <p>Signing you in…</p>
    </main>
  )
}