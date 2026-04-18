'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import AuthScaffold from '@/app/components/AuthScaffold'
import AuthSocialButton from '@/app/components/AuthSocialButton'
import Button from '@/app/components/Button'
import Input from '@/app/components/Input'
import {
  signInWithGoogle,
  signUpWithPassword,
} from '@/lib/auth'
import { supabase } from '@/lib/supabase'

function GoogleIcon() {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 18 18"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M17.64 9.2045C17.64 8.5663 17.5827 7.9527 17.4764 7.3636H9V10.8454H13.8436C13.635 11.9704 13.0009 12.9236 12.0477 13.5618V15.82H14.9564C16.6591 14.2527 17.64 11.9459 17.64 9.2045Z"
        fill="#4285F4"
      />
      <path
        d="M9 18C11.43 18 13.4673 17.1941 14.9564 15.82L12.0477 13.5618C11.2418 14.1027 10.2118 14.4205 9 14.4205C6.6559 14.4205 4.6718 12.8373 3.9641 10.71H0.9573V13.0418C2.4382 15.9832 5.4818 18 9 18Z"
        fill="#34A853"
      />
      <path
        d="M3.9641 10.71C3.7841 10.1691 3.6818 9.5918 3.6818 9C3.6818 8.4082 3.7841 7.8309 3.9641 7.29V4.9582H0.9573C0.3477 6.1732 0 7.5477 0 9C0 10.4523 0.3477 11.8268 0.9573 13.0418L3.9641 10.71Z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.5795C10.3227 3.5795 11.5105 4.0341 12.4445 4.9268L15.0218 2.3495C13.4632 0.8973 11.4259 0 9 0C5.4818 0 2.4382 2.0168 0.9573 4.9582L3.9641 7.29C4.6718 5.1627 6.6559 3.5795 9 3.5795Z"
        fill="#EA4335"
      />
    </svg>
  )
}

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
      helperText={
        <>
          By signing up, you agree to our{' '}
          <Link href="/legal/terms" className="font-medium text-gray-900 underline underline-offset-4">
            Terms
          </Link>{' '}
          and{' '}
          <Link href="/legal/privacy" className="font-medium text-gray-900 underline underline-offset-4">
            Privacy Policy
          </Link>
          .
        </>
      }
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
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 transition-colors hover:text-gray-700"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? (
                <svg
                  aria-hidden="true"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M3 3L21 21M10.58 10.58a2 2 0 0 0 2.83 2.83"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <path
                    d="M9.88 4.24A10.94 10.94 0 0 1 12 4c5 0 9.27 3.11 11 8a11.8 11.8 0 0 1-4.28 5.72M6.6 6.6A11.9 11.9 0 0 0 1 12c1.73 4.89 6 8 11 8a10.9 10.9 0 0 0 3.4-.54"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <svg
                  aria-hidden="true"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M1 12C2.73 7.11 7 4 12 4s9.27 3.11 11 8c-1.73 4.89-6 8-11 8S2.73 16.89 1 12Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              )}
            </button>
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
