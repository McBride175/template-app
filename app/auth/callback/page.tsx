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
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center">
      <p className="text-gray-600">Signing you in…</p>
    </div>
  )
}