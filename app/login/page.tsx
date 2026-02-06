'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/app/components/Button'
import Card from '@/app/components/Card'
import Input from '@/app/components/Input'
import {
  signInWithPassword,
  signUpWithPassword,
  signInWithGoogle,
} from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [signingUp, setSigningUp] = useState(false)
  const [sendingLink, setSendingLink] = useState(false)
  const [sendingReset, setSendingReset] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/dashboard')
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) router.replace('/dashboard')
    })

    return () => sub.subscription.unsubscribe()
  }, [router])

  if (loading) return null

  const getAuthRedirectUrl = () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return `${origin}/auth/callback`
  }

  const handleSignIn = async () => {
    setError(null)
    setStatus(null)

    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password) {
      setError('Email and password are required.')
      return
    }

    setSigningIn(true)
    const { error: signInError } = await signInWithPassword(
      trimmedEmail,
      password
    )
    setSigningIn(false)

    if (signInError) {
      const lower = signInError.message.toLowerCase()
      const message = lower.includes('invalid login credentials')
        ? 'If you originally used Google or magic link, you won’t have a password yet. Use Google/magic link or click “Forgot password / Set password”.'
        : lower.includes('email') && lower.includes('confirm')
          ? 'Please confirm your email first.'
          : signInError.message
      setError(message)
      return
    }

    router.replace('/dashboard')
  }

  const handleSignUp = async () => {
    setError(null)
    setStatus(null)

    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password) {
      setError('Email and password are required.')
      return
    }

    setSigningUp(true)
    const { error: signUpError } = await signUpWithPassword(
      trimmedEmail,
      password
    )
    setSigningUp(false)

    if (signUpError) {
      const lower = signUpError.message.toLowerCase()
      const message = lower.includes('already') || lower.includes('registered')
        ? 'Account already exists. Use Sign in, Google, Magic link, or set a password.'
        : signUpError.message
      setError(message)
      return
    }

    setStatus('Check your email to confirm your account.')
  }

  const handleMagicLink = async () => {
    setError(null)
    setStatus(null)

    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setError('Email is required.')
      return
    }

    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const emailRedirectTo = `${origin}/auth/callback`

    setSendingLink(true)
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: { emailRedirectTo },
    })
    setSendingLink(false)

    if (otpError) {
      setError(otpError.message)
      return
    }

    setStatus('Check your email for the sign-in link.')
  }

  const handlePasswordReset = async () => {
    setError(null)
    setStatus(null)

    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setError('Email is required.')
      return
    }

    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const redirectTo = `${origin}/auth/callback?next=/reset-password`
    console.log('[auth] resetPasswordForEmail redirectTo', { redirectTo })

    setSendingReset(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      trimmedEmail,
      { redirectTo }
    )
    setSendingReset(false)

    if (resetError) {
      setError(resetError.message)
      return
    }

    setStatus('Check your email for a password reset link.')
  }

  const handleGoogleSignIn = async () => {
    setError(null)
    setStatus(null)
    await signInWithGoogle(getAuthRedirectUrl())
  }

  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center">
      <Card className="w-full max-w-md text-center">
        <h1 className="mb-2">Welcome</h1>
        <p className="mb-8 text-gray-600">Sign in to continue</p>

        <div className="space-y-4 text-left">
          <Button
            onClick={handleGoogleSignIn}
            variant="primary"
            size="lg"
            className="w-full"
          >
            Continue with Google
          </Button>

          <div className="space-y-2">
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
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={handleSignIn}
              variant="primary"
              size="lg"
              className="w-full"
              disabled={signingIn}
            >
              {signingIn ? 'Signing in…' : 'Sign in'}
            </Button>

            <Button
              onClick={handleSignUp}
              variant="secondary"
              size="lg"
              className="w-full"
              disabled={signingUp}
            >
              {signingUp ? 'Creating…' : 'Sign up'}
            </Button>
          </div>

          <Button
            onClick={handleMagicLink}
            variant="secondary"
            size="lg"
            className="w-full"
            disabled={sendingLink}
          >
            {sendingLink ? 'Sending…' : 'Email me a sign-in link'}
          </Button>

          <button
            onClick={handlePasswordReset}
            className="text-sm text-gray-700 hover:text-gray-900 underline underline-offset-4 transition-colors w-full text-left py-2 px-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
            disabled={sendingReset}
          >
            {sendingReset ? 'Sending…' : 'Forgot password / Set password'}
          </button>

          {(error || status) && (
            <p className={`text-sm ${error ? 'text-red-600' : 'text-green-600'}`}>
              {error ?? status}
            </p>
          )}
        </div>
      </Card>
    </div>
  )
}
