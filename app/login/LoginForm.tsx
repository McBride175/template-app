'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import AuthScaffold from '@/app/components/AuthScaffold'
import AuthLegalNotice from '@/app/components/AuthLegalNotice'
import AuthSocialButton from '@/app/components/AuthSocialButton'
import Button from '@/app/components/Button'
import GoogleIcon from '@/app/components/GoogleIcon'
import Input from '@/app/components/Input'
import PasswordToggleButton from '@/app/components/PasswordToggleButton'
import TurnstileCaptcha, {
  type TurnstileCaptchaHandle,
} from '@/app/components/TurnstileCaptcha'
import {
  sendPasswordRecovery,
  signInWithEmailOtp,
  signInWithGoogle,
  signInWithPassword,
} from '@/lib/auth'
import {
  buildAuthCallbackPath,
  buildAuthSwitchPath,
  buildPasswordRecoveryCallbackPath,
  getAuthActionErrorMessage,
  getAuthErrorCode,
} from '@/lib/auth-flow'
import { reportAuthOperationalFailure } from '@/lib/auth-observability'
import {
  getAuthCaptchaValidationError,
  getTurnstileSiteKey,
} from '@/lib/auth-captcha'

type LoginFormProps = {
  nextPath: string
  initialEmail: string
  initialError: string | null
  initialStatus: string | null
  signupHref: string
}

function absoluteAuthUrl(path: string) {
  return new URL(path, window.location.origin).toString()
}

export default function LoginForm({
  nextPath,
  initialEmail,
  initialError,
  initialStatus,
  signupHref,
}: LoginFormProps) {
  const router = useRouter()
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [activeAction, setActiveAction] = useState<
    'password' | 'magic-link' | 'password-link' | 'google' | null
  >(null)
  const [error, setError] = useState<string | null>(initialError)
  const [status, setStatus] = useState<string | null>(initialStatus)
  const [showCredentialHelp, setShowCredentialHelp] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const captchaRef = useRef<TurnstileCaptchaHandle>(null)
  const turnstileSiteKey = getTurnstileSiteKey()
  const busy = activeAction !== null

  const clearFeedback = () => {
    setError(null)
    setStatus(null)
    setShowCredentialHelp(false)
  }

  const finishSignIn = () => {
    router.replace(nextPath)
    router.refresh()
  }

  const validateCaptcha = () => {
    const validationError = getAuthCaptchaValidationError(turnstileSiteKey, captchaToken)
    if (validationError) setError(validationError)
    return !validationError
  }

  const handleSignIn = async () => {
    clearFeedback()
    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password) {
      setError('Enter your email and password to continue.')
      return
    }
    if (!validateCaptcha()) return

    setActiveAction('password')
    try {
      const { error: signInError } = await signInWithPassword(
        trimmedEmail,
        password,
        captchaToken ?? undefined
      )
      if (signInError) {
        reportAuthOperationalFailure(signInError, 'password-login')
        setError(getAuthActionErrorMessage(signInError, 'password-login'))
        setShowCredentialHelp(getAuthErrorCode(signInError) === 'invalid_credentials')
        return
      }
      finishSignIn()
    } catch (signInError) {
      reportAuthOperationalFailure(signInError, 'password-login')
      setError(getAuthActionErrorMessage(signInError, 'password-login'))
    } finally {
      captchaRef.current?.reset()
      setActiveAction(null)
    }
  }

  const handleMagicLink = async () => {
    clearFeedback()
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setError('Enter your email so we know where to send the sign-in link.')
      return
    }
    if (!validateCaptcha()) return

    setActiveAction('magic-link')
    try {
      const { error: otpError } = await signInWithEmailOtp(
        trimmedEmail,
        absoluteAuthUrl(buildAuthCallbackPath(nextPath)),
        captchaToken ?? undefined
      )
      if (otpError) {
        reportAuthOperationalFailure(otpError, 'email-link')
        setError(getAuthActionErrorMessage(otpError, 'email-link'))
        return
      }
      setStatus(
        'If an account exists for that email, a secure sign-in link is on its way. Check your inbox and spam folder.'
      )
    } catch (otpError) {
      reportAuthOperationalFailure(otpError, 'email-link')
      setError(getAuthActionErrorMessage(otpError, 'email-link'))
    } finally {
      captchaRef.current?.reset()
      setActiveAction(null)
    }
  }

  const handlePasswordReset = async () => {
    clearFeedback()
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setError('Enter your email so we know where to send the password link.')
      return
    }
    if (!validateCaptcha()) return

    setActiveAction('password-link')
    try {
      const { error: resetError } = await sendPasswordRecovery(
        trimmedEmail,
        absoluteAuthUrl(buildPasswordRecoveryCallbackPath(nextPath)),
        captchaToken ?? undefined
      )
      if (resetError) {
        reportAuthOperationalFailure(resetError, 'email-link')
        setError(getAuthActionErrorMessage(resetError, 'email-link'))
        return
      }
      setStatus(
        'If an account exists for that email, a secure password link is on its way. Check your inbox and spam folder.'
      )
    } catch (resetError) {
      reportAuthOperationalFailure(resetError, 'email-link')
      setError(getAuthActionErrorMessage(resetError, 'email-link'))
    } finally {
      captchaRef.current?.reset()
      setActiveAction(null)
    }
  }

  const handleGoogleSignIn = async () => {
    clearFeedback()
    setActiveAction('google')
    try {
      const { error: oauthError } = await signInWithGoogle(
        absoluteAuthUrl(buildAuthCallbackPath(nextPath))
      )
      if (oauthError) setError(getAuthActionErrorMessage(oauthError, 'google'))
    } catch (oauthError) {
      setError(getAuthActionErrorMessage(oauthError, 'google'))
    } finally {
      setActiveAction(null)
    }
  }

  const currentSignupHref =
    email === initialEmail ? signupHref : buildAuthSwitchPath('/signup', nextPath, email)

  const feedbackActions = showCredentialHelp ? (
    <>
      <button
        type="button"
        onClick={() => void handleGoogleSignIn()}
        disabled={busy}
        className="font-semibold text-red-900 underline underline-offset-4 disabled:opacity-50"
      >
        Continue with Google
      </button>
      <button
        type="button"
        onClick={() => void handlePasswordReset()}
        disabled={busy}
        className="font-semibold text-red-900 underline underline-offset-4 disabled:opacity-50"
      >
        Email me a password link
      </button>
    </>
  ) : null

  return (
    <AuthScaffold
      title="Welcome back"
      switchLabel="New here?"
      switchHref={currentSignupHref}
      switchText="Create an account"
      socialActions={
        <AuthSocialButton
          onClick={() => void handleGoogleSignIn()}
          icon={<GoogleIcon />}
          label={activeAction === 'google' ? 'Opening Google…' : 'Continue with Google'}
          disabled={busy}
          className="sm:col-span-2"
        />
      }
      error={error}
      status={status}
      feedbackActions={feedbackActions}
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
          <label htmlFor="login-email" className="text-sm font-medium text-gray-700">
            Email
          </label>
          <Input
            id="login-email"
            name="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setShowCredentialHelp(false)
            }}
            autoComplete="email"
            inputMode="email"
            required
            disabled={busy}
            className="h-14 rounded-2xl px-5 text-base"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="login-password" className="text-sm font-medium text-gray-700">
              Password
            </label>
            <button
              type="button"
              onClick={() => void handlePasswordReset()}
              className="text-sm font-medium text-gray-700 underline underline-offset-4 transition-colors hover:text-gray-900 disabled:opacity-50"
              disabled={busy}
            >
              {activeAction === 'password-link' ? 'Sending…' : 'Forgot password?'}
            </button>
          </div>
          <div className="relative">
            <Input
              id="login-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter your password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                setShowCredentialHelp(false)
              }}
              autoComplete="current-password"
              required
              disabled={busy}
              className="h-14 rounded-2xl px-5 pr-12 text-base"
            />
            <PasswordToggleButton
              showPassword={showPassword}
              onToggle={() => setShowPassword((value) => !value)}
              disabled={busy}
            />
          </div>
        </div>

        {turnstileSiteKey && (
          <TurnstileCaptcha
            ref={captchaRef}
            action="public_auth"
            siteKey={turnstileSiteKey}
            onTokenChange={setCaptchaToken}
            disabled={busy}
          />
        )}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="min-h-14 w-full rounded-2xl text-base"
          disabled={busy}
        >
          {activeAction === 'password' ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <Button
        onClick={() => void handleMagicLink()}
        variant="secondary"
        size="lg"
        className="min-h-14 w-full rounded-2xl text-base"
        disabled={busy}
      >
        {activeAction === 'magic-link' ? 'Sending link…' : 'Email me a sign-in link'}
      </Button>
    </AuthScaffold>
  )
}
