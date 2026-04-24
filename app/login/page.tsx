'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import AuthScaffold from '@/app/components/AuthScaffold'
import AuthLegalNotice from '@/app/components/AuthLegalNotice'
import AuthSocialButton from '@/app/components/AuthSocialButton'
import Button from '@/app/components/Button'
import GoogleIcon from '@/app/components/GoogleIcon'
import Input from '@/app/components/Input'
import PasswordToggleButton from '@/app/components/PasswordToggleButton'
import {
  signInWithEmailOtp,
  signInWithGoogle,
  signInWithPassword,
} from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [sendingLink, setSendingLink] = useState(false)
  const [sendingReset, setSendingReset] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
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
    const { error: signInError } = await signInWithPassword(trimmedEmail, password)
    setSigningIn(false)

    if (signInError) {
      const lower = signInError.message.toLowerCase()
      const message = lower.includes('invalid login credentials')
        ? 'Invalid login credentials. If you used Google before, sign in with Google or set a password.'
        : lower.includes('email') && lower.includes('confirm')
          ? 'Please confirm your email first.'
          : signInError.message
      setError(message)
      return
    }

    router.replace('/dashboard')
  }

  const handleMagicLink = async () => {
    setError(null)
    setStatus(null)

    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setError('Email is required for magic link sign-in.')
      return
    }

    setSendingLink(true)
    const { error: otpError } = await signInWithEmailOtp(
      trimmedEmail,
      getAuthRedirectUrl()
    )
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
      setError('Enter your email first, then click Forgot your password.')
      return
    }

    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const redirectTo = `${origin}/auth/callback?next=/reset-password`

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

    setStatus('Password reset link sent. Check your inbox.')
  }

  const handleGoogleSignIn = async () => {
    setError(null)
    setStatus(null)
    setGoogleLoading(true)
    const { error: oauthError } = await signInWithGoogle(getAuthRedirectUrl())
    setGoogleLoading(false)
    if (oauthError) setError(oauthError.message)
  }

  return (
    <AuthScaffold
      title="Log in to your account"
      switchLabel="Don't have an account?"
      switchHref="/signup"
      switchText="Sign up"
      socialActions={
        <>
          <AuthSocialButton
            onClick={handleGoogleSignIn}
            icon={<GoogleIcon />}
            label={googleLoading ? 'Redirecting…' : 'Continue with Google'}
            disabled={googleLoading}
            className="sm:col-span-2"
          />
        </>
      }
      error={error}
      status={status}
      helperText={<AuthLegalNotice mode="signin" />}
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault()
          void handleSignIn()
        }}
      >
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Email</label>
          <Input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="h-14 rounded-2xl px-5 text-base"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <label className="text-sm font-medium text-gray-700">Password</label>
            <button
              type="button"
              onClick={handlePasswordReset}
              className="text-sm font-medium text-gray-700 underline underline-offset-4 transition-colors hover:text-gray-900"
              disabled={sendingReset}
            >
              {sendingReset ? 'Sending…' : 'Forgot your password?'}
            </button>
          </div>
          <div className="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="h-14 rounded-2xl px-5 pr-12 text-base"
            />
            <PasswordToggleButton
              showPassword={showPassword}
              onToggle={() => setShowPassword((value) => !value)}
            />
          </div>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="min-h-14 w-full rounded-2xl text-base"
          disabled={signingIn}
        >
          {signingIn ? 'Logging in…' : 'Log in'}
        </Button>
      </form>

      <Button
        onClick={handleMagicLink}
        variant="secondary"
        size="lg"
        className="min-h-14 w-full rounded-2xl text-base"
        disabled={sendingLink}
      >
        {sendingLink ? 'Sending…' : 'Email me a sign-in link'}
      </Button>
    </AuthScaffold>
  )
}
