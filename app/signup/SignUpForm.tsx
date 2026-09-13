'use client'

import Link from 'next/link'
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
import { signInWithGoogle, signUpWithPassword } from '@/lib/auth'
import {
  buildAuthCallbackPath,
  buildAuthSwitchPath,
  getAuthActionErrorMessage,
} from '@/lib/auth-flow'
import { reportAuthOperationalFailure } from '@/lib/auth-observability'
import {
  getAuthCaptchaValidationError,
  getTurnstileSiteKey,
} from '@/lib/auth-captcha'
import { getPasswordRequirements, validatePassword } from '@/lib/password'

type SignUpFormProps = {
  nextPath: string
  initialEmail: string
  loginHref: string
}

function absoluteAuthUrl(path: string) {
  return new URL(path, window.location.origin).toString()
}

export default function SignUpForm({ nextPath, initialEmail, loginHref }: SignUpFormProps) {
  const router = useRouter()
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [activeAction, setActiveAction] = useState<'email' | 'google' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [confirmationPending, setConfirmationPending] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const captchaRef = useRef<TurnstileCaptchaHandle>(null)
  const turnstileSiteKey = getTurnstileSiteKey()
  const busy = activeAction !== null
  const passwordRequirements = getPasswordRequirements(password)

  const clearFeedback = () => {
    setError(null)
    setStatus(null)
    setConfirmationPending(false)
  }

  const finishSignIn = () => {
    router.replace(nextPath)
    router.refresh()
  }

  const handleSignUp = async () => {
    clearFeedback()
    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password) {
      setError('Enter your email and choose a password to continue.')
      return
    }

    const validationError = validatePassword(password)
    if (validationError) {
      setError(validationError)
      return
    }

    const captchaValidationError = getAuthCaptchaValidationError(
      turnstileSiteKey,
      captchaToken
    )
    if (captchaValidationError) {
      setError(captchaValidationError)
      return
    }

    setActiveAction('email')
    try {
      const { data, error: signUpError } = await signUpWithPassword(
        trimmedEmail,
        password,
        absoluteAuthUrl(buildAuthCallbackPath(nextPath)),
        captchaToken ?? undefined
      )
      if (signUpError) {
        reportAuthOperationalFailure(signUpError, 'signup')
        setError(getAuthActionErrorMessage(signUpError, 'signup'))
        return
      }
      if (data.session) {
        finishSignIn()
        return
      }

      setConfirmationPending(true)
      setStatus(
        'Check your inbox to confirm your email. If no message arrives, you may already have an account—sign in or continue with Google.'
      )
    } catch (signUpError) {
      reportAuthOperationalFailure(signUpError, 'signup')
      setError(getAuthActionErrorMessage(signUpError, 'signup'))
    } finally {
      captchaRef.current?.reset()
      setActiveAction(null)
    }
  }

  const handleGoogleSignUp = async () => {
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

  const currentLoginHref =
    email === initialEmail ? loginHref : buildAuthSwitchPath('/login', nextPath, email)

  return (
    <AuthScaffold
      title="Create your account"
      switchLabel="Already have an account?"
      switchHref={currentLoginHref}
      switchText="Sign in"
      socialActions={
        <AuthSocialButton
          onClick={() => void handleGoogleSignUp()}
          icon={<GoogleIcon />}
          label={activeAction === 'google' ? 'Opening Google…' : 'Continue with Google'}
          disabled={busy}
          className="sm:col-span-2"
        />
      }
      error={error}
      status={status}
      feedbackActions={
        confirmationPending ? (
          <Link href={currentLoginHref} className="font-semibold underline underline-offset-4">
            Go to sign in
          </Link>
        ) : null
      }
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
          <label htmlFor="signup-email" className="text-sm font-medium text-gray-700">
            Email
          </label>
          <Input
            id="signup-email"
            name="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            inputMode="email"
            required
            disabled={busy}
            className="h-14 rounded-2xl px-5 text-base"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="signup-password" className="text-sm font-medium text-gray-700">
            Password
          </label>
          <div className="relative">
            <Input
              id="signup-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="Create a password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
              disabled={busy}
              aria-describedby="signup-password-help"
              className="h-14 rounded-2xl px-5 pr-12 text-base"
            />
            <PasswordToggleButton
              showPassword={showPassword}
              onToggle={() => setShowPassword((value) => !value)}
              disabled={busy}
            />
          </div>
          <p id="signup-password-help" className="text-sm text-gray-500">
            {passwordRequirements}
          </p>
        </div>

        {turnstileSiteKey && (
          <TurnstileCaptcha
            ref={captchaRef}
            action="signup"
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
          {activeAction === 'email' ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthScaffold>
  )
}
