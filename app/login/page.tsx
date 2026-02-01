'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/app/components/Button'
import Card from '@/app/components/Card'
import Input from '@/app/components/Input'
import {
  signInWithPassword,
  signUpWithPassword,
  signInWithEmailOtp,
  signInWithGoogle,
} from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sending, setSending] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [signingUp, setSigningUp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

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

  const getAuthRedirectUrl = () => {
    // Use same-origin callback to work across localhost + Vercel preview.
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return `${origin}/auth/callback`
  }

  const signInWithGoogle = async () => {
    // TEMPLATE CODE: Redirect to server-side callback route that exchanges code for session
    // Uses window.location.origin to work in preview and production environments
    setError(null)
    setSuccess(null)
    await signInWithGoogle(getAuthRedirectUrl())
  }

  const signInWithEmail = async () => {
    setError(null)
    setSuccess(null)

    const trimmed = email.trim()
    if (!trimmed) {
      setError('Please enter an email address.')
      return
    }

    setSending(true)
    const { error: otpError } = await signInWithEmailOtp(
      trimmed,
      getAuthRedirectUrl()
    )
    setSending(false)

    if (otpError) {
      setError(otpError.message)
      return
    }

    setSuccess('Check your email for the sign-in link.')
  }

  const signInWithEmailPassword = async () => {
    setError(null)
    setSuccess(null)

    const trimmed = email.trim()
    if (!trimmed || !password) {
      setError('Email and password are required.')
      return
    }

    setSigningIn(true)
    const { error: signInError } = await signInWithPassword(trimmed, password)
    setSigningIn(false)

    if (signInError) {
      setError(signInError.message)
      return
    }

    router.replace('/dashboard')
  }

  const createAccountWithEmailPassword = async () => {
    setError(null)
    setSuccess(null)

    const trimmed = email.trim()
    if (!trimmed || !password) {
      setError('Email and password are required.')
      return
    }

    setSigningUp(true)
    const { data, error: signUpError } = await signUpWithPassword(
      trimmed,
      password
    )
    setSigningUp(false)

    if (signUpError) {
      setError(signUpError.message)
      return
    }

    if (data.session) {
      router.replace('/dashboard')
      return
    }

    setSuccess('Account created. Check your email to confirm before signing in.')
  }

  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center">
      <Card className="w-full max-w-md text-center">
        <h1 className="mb-2">Welcome</h1>
        <p className="mb-8 text-gray-600">Sign in to continue</p>
        <div className="space-y-4">
          <Button onClick={signInWithGoogle} variant="primary" size="lg" className="w-full">
            Sign in with Google
          </Button>

          <div className="text-left space-y-2">
            <label className="text-xs text-gray-500">Email</label>
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            <label className="text-xs text-gray-500">Password</label>
            <Input
              type="password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <Button
              onClick={signInWithEmailPassword}
              variant="primary"
              size="lg"
              className="w-full"
              disabled={signingIn}
            >
              {signingIn ? 'Signing in…' : 'Sign in'}
            </Button>
            <Button
              onClick={createAccountWithEmailPassword}
              variant="secondary"
              size="lg"
              className="w-full"
              disabled={signingUp}
            >
              {signingUp ? 'Creating…' : 'Create account'}
            </Button>
          </div>

          <div className="text-left space-y-2">
            <label className="text-xs text-gray-500">Email link</label>
            <Button
              onClick={signInWithEmail}
              variant="secondary"
              size="lg"
              className="w-full"
              disabled={sending}
            >
              {sending ? 'Sending…' : 'Send sign-in link'}
            </Button>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-green-600">{success}</p>}
        </div>
      </Card>
    </div>
  )
}
