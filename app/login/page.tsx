'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Button from '@/app/components/Button'
import Card from '@/app/components/Card'

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // initial check
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/dashboard')
      setLoading(false)
    })

    // keep in sync after redirect/callback
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) router.replace('/dashboard')
    })

    return () => sub.subscription.unsubscribe()
  }, [router])

  if (loading) return null

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
  }

  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center">
      <Card className="w-full max-w-md text-center">
        <h1 className="mb-2">Welcome</h1>
        <p className="mb-8 text-gray-600">Sign in to continue</p>
        <Button onClick={signInWithGoogle} variant="primary" size="lg" className="w-full">
          Sign in with Google
        </Button>
      </Card>
    </div>
  )
}