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
  signInWithGoogle,
  signUpWithPassword,
} from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export default function SignUpPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [signingUp, setSigningUp] = useState(false)
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

  const handleSignUp = async () => {
    setError(null)
    setStatus(null)

    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password) {
      setError('Email and password are required.')
      return
    }

    setSigningUp(true)
    const { data, error: signUpError } = await signUpWithPassword(
      trimmedEmail,
      password
    )
    setSigningUp(false)

    if (signUpError) {
      const lower = signUpError.message.toLowerCase()
      const message = lower.includes('already') || lower.includes('registered')
        ? 'Account already exists. Use Log in instead.'
        : signUpError.message
      setError(message)
      return
    }

    if (data.session) {
      router.replace('/dashboard')
      return
    }

    setStatus('Account created. Check your email to confirm your account.')
  }

  const handleGoogleSignUp = async () => {
    setError(null)
    setStatus(null)
    setGoogleLoading(true)
    const { error: oauthError } = await signInWithGoogle(getAuthRedirectUrl())
    setGoogleLoading(false)
    if (oauthError) setError(oauthError.message)
  }

  return (
    <AuthScaffold
      title="Create your account"
      switchLabel="Already have an account?"
      switchHref="/login"
      switchText="Log in"
      socialActions={
        <>
          <AuthSocialButton
            onClick={handleGoogleSignUp}
            icon={<GoogleIcon />}
            label={googleLoading ? 'Redirecting…' : 'Sign up with Google'}
            disabled={googleLoading}
            className="sm:col-span-2"
          />
        </>
      }
      error={error}
      status={status}
      helperText={<AuthLegalNotice mode="signup" />}
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault()
          void handleSignUp()
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
          <label className="text-sm font-medium text-gray-700">Password</label>
          <div className="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              placeholder="Create a password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="h-14 rounded-2xl px-5 pr-12 text-base"
            />
            <PasswordToggleButton
              showPassword={showPassword}
              onToggle={() => setShowPassword((value) => !value)}
            />
          </div>
          <p className="text-sm text-gray-500">
            Use at least 10 characters with a mix of letters, numbers, or symbols.
          </p>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="min-h-14 w-full rounded-2xl text-base"
          disabled={signingUp}
        >
          {signingUp ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthScaffold>
  )
}
