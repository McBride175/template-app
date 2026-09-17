'use client'

import Link from 'next/link'
import { useRef, useState, type FormEvent } from 'react'
import AuthSocialButton from '@/app/components/AuthSocialButton'
import Button from '@/app/components/Button'
import GoogleIcon from '@/app/components/GoogleIcon'
import Input from '@/app/components/Input'
import TurnstileCaptcha, {
  type TurnstileCaptchaHandle,
} from '@/app/components/TurnstileCaptcha'
import { continueWithEmail, signInWithGoogle } from '@/lib/auth'
import {
  buildAuthCallbackPath,
  getAuthActionErrorMessage,
  getAuthPageErrorMessage,
} from '@/lib/auth-flow'
import { getAuthCaptchaValidationError, getTurnstileSiteKey } from '@/lib/auth-captcha'
import { reportAuthOperationalFailure } from '@/lib/auth-observability'

function absoluteAuthUrl(path: string) {
  return new URL(path, window.location.origin).toString()
}

export default function StartAuthClient({
  initialErrorCode,
}: {
  initialErrorCode: string | null
}) {
  const [email, setEmail] = useState('')
  const [activeAction, setActiveAction] = useState<'google' | 'email' | null>(null)
  const [error, setError] = useState<string | null>(
    getAuthPageErrorMessage(initialErrorCode)
  )
  const [status, setStatus] = useState<string | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const captchaRef = useRef<TurnstileCaptchaHandle>(null)
  const turnstileSiteKey = getTurnstileSiteKey()
  const busy = activeAction !== null

  const callbackUrl = () => absoluteAuthUrl(buildAuthCallbackPath('/start'))

  const handleGoogle = async () => {
    setError(null)
    setStatus(null)
    setActiveAction('google')
    try {
      const { error: oauthError } = await signInWithGoogle(callbackUrl())
      if (oauthError) setError(getAuthActionErrorMessage(oauthError, 'google'))
    } catch (oauthError) {
      setError(getAuthActionErrorMessage(oauthError, 'google'))
    } finally {
      setActiveAction(null)
    }
  }

  const handleEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setStatus(null)
    const trimmedEmail = email.trim()

    if (!trimmedEmail) {
      setError('Enter your email to continue.')
      return
    }

    const captchaError = getAuthCaptchaValidationError(turnstileSiteKey, captchaToken)
    if (captchaError) {
      setError(captchaError)
      return
    }

    setActiveAction('email')
    try {
      const { error: emailError } = await continueWithEmail(
        trimmedEmail,
        callbackUrl(),
        captchaToken ?? undefined
      )
      if (emailError) {
        reportAuthOperationalFailure(emailError, 'email-link')
        setError(getAuthActionErrorMessage(emailError, 'email-link'))
        return
      }

      setStatus(
        'Check your inbox for a secure link to continue. If you normally use Google, you can continue with Google instead.'
      )
    } catch (emailError) {
      reportAuthOperationalFailure(emailError, 'email-link')
      setError(getAuthActionErrorMessage(emailError, 'email-link'))
    } finally {
      captchaRef.current?.reset()
      setCaptchaToken(null)
      setActiveAction(null)
    }
  }

  return (
    <div className="min-h-[calc(100vh-10rem)] py-8 sm:py-12">
      <section className="mx-auto w-full max-w-xl rounded-3xl border border-gray-200 bg-white p-6 shadow-sm sm:p-9">
        <header className="text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-gray-500">Try Yuohme</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-gray-900">
            Continue to Yuohme
          </h1>
          <p className="mt-4 text-base leading-relaxed text-gray-600">
            Identify yourself, then connect Xero so Yuohme can prepare your chase priorities.
          </p>
        </header>

        {(error || status) && (
          <div
            className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${
              error
                ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-green-200 bg-green-50 text-green-800'
            }`}
            role={error ? 'alert' : 'status'}
            aria-live="polite"
          >
            {error ?? status}
          </div>
        )}

        <div className="mt-7">
          <AuthSocialButton
            onClick={() => void handleGoogle()}
            icon={<GoogleIcon />}
            label={activeAction === 'google' ? 'Opening Google…' : 'Continue with Google'}
            disabled={busy}
            className="border-gray-900 bg-gray-900 text-white hover:bg-gray-800"
          />
        </div>

        <div className="my-7 flex items-center gap-4">
          <div className="h-px flex-1 bg-gray-200" />
          <span className="text-sm font-medium uppercase tracking-wide text-gray-500">or</span>
          <div className="h-px flex-1 bg-gray-200" />
        </div>

        <form className="space-y-4" onSubmit={(event) => void handleEmail(event)}>
          <div className="space-y-2">
            <label htmlFor="start-email" className="text-sm font-medium text-gray-700">
              Email
            </label>
            <Input
              id="start-email"
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              required
              disabled={busy}
              className="h-14 rounded-2xl px-5 text-base"
            />
          </div>

          {turnstileSiteKey && (
            <TurnstileCaptcha
              ref={captchaRef}
              siteKey={turnstileSiteKey}
              action="public_auth"
              disabled={busy}
              onTokenChange={setCaptchaToken}
            />
          )}

          <Button type="submit" size="lg" className="min-h-14 w-full rounded-2xl" disabled={busy}>
            {activeAction === 'email' ? 'Sending secure link…' : 'Continue with email'}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-gray-600">
          Prefer your existing password?{' '}
          <Link href="/login?next=%2Fstart" className="font-semibold underline underline-offset-4">
            Sign in with password
          </Link>
        </p>
        <p className="mt-6 text-center text-sm leading-relaxed text-gray-500">
          No card is required for your first five collection days. Xero access is read-only.
          By continuing, you agree to our{' '}
          <Link href="/legal/terms" className="underline underline-offset-4">Terms</Link> and{' '}
          <Link href="/legal/privacy" className="underline underline-offset-4">Privacy Policy</Link>.
        </p>
      </section>
    </div>
  )
}
