'use client'

import { useRef, useState } from 'react'
import Button from './Button'
import Input from './Input'
import PasswordToggleButton from './PasswordToggleButton'
import TurnstileCaptcha, { type TurnstileCaptchaHandle } from './TurnstileCaptcha'
import { sendPasswordRecovery } from '@/lib/auth'
import {
  buildPasswordRecoveryCallbackPath,
  getAuthActionErrorMessage,
  getAuthErrorCode,
} from '@/lib/auth-flow'
import { reportAuthOperationalFailure } from '@/lib/auth-observability'
import {
  getAuthCaptchaValidationError,
  getTurnstileSiteKey,
} from '@/lib/auth-captcha'
import { getPasswordRequirements, validatePassword } from '@/lib/password'
import { supabase } from '@/lib/supabase'

export default function ChangePasswordButton({ email }: { email: string }) {
  const [expanded, setExpanded] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sendingLink, setSendingLink] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reauthenticationNeeded, setReauthenticationNeeded] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const captchaRef = useRef<TurnstileCaptchaHandle>(null)
  const turnstileSiteKey = getTurnstileSiteKey()
  const busy = saving || sendingLink

  const resetForm = () => {
    setPassword('')
    setConfirmation('')
    setShowPassword(false)
  }

  const handleSavePassword = async () => {
    setError(null)
    setStatus(null)
    setReauthenticationNeeded(false)

    if (!password || !confirmation) {
      setError('Enter and confirm the password you want to use.')
      return
    }
    if (password !== confirmation) {
      setError('The passwords do not match. Check both entries and try again.')
      return
    }

    const validationError = validatePassword(password)
    if (validationError) {
      setError(validationError)
      return
    }

    setSaving(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setReauthenticationNeeded(getAuthErrorCode(updateError) === 'reauthentication_needed')
        setError(getAuthActionErrorMessage(updateError, 'password-update'))
        return
      }

      resetForm()
      setExpanded(false)
      setStatus('Password saved. You can now use it to sign in.')
    } catch (updateError) {
      setError(getAuthActionErrorMessage(updateError, 'password-update'))
    } finally {
      setSaving(false)
    }
  }

  const handlePasswordLink = async () => {
    setError(null)
    setStatus(null)
    if (!email) {
      setError('We could not find an email address for this account. Contact support for help.')
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

    setSendingLink(true)
    try {
      const redirectTo = new URL(
        buildPasswordRecoveryCallbackPath('/account'),
        window.location.origin
      ).toString()
      const { error: resetError } = await sendPasswordRecovery(
        email,
        redirectTo,
        captchaToken ?? undefined
      )
      if (resetError) {
        reportAuthOperationalFailure(resetError, 'email-link')
        setError(getAuthActionErrorMessage(resetError, 'email-link'))
        return
      }
      setStatus('A secure password link is on its way. Check your inbox and spam folder.')
      setReauthenticationNeeded(false)
    } catch (resetError) {
      reportAuthOperationalFailure(resetError, 'email-link')
      setError(getAuthActionErrorMessage(resetError, 'email-link'))
    } finally {
      captchaRef.current?.reset()
      setSendingLink(false)
    }
  }

  return (
    <div className="w-full space-y-3 sm:w-80">
      {!expanded ? (
        <Button
          onClick={() => {
            setExpanded(true)
            setError(null)
            setStatus(null)
          }}
          variant="secondary"
          size="md"
          className="w-full"
        >
          Set or change password
        </Button>
      ) : (
        <form
          className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-left"
          onSubmit={(event) => {
            event.preventDefault()
            void handleSavePassword()
          }}
        >
          <div>
            <h3 className="text-base">Set a password</h3>
            <p className="mt-1 text-sm text-gray-600">
              Add password sign-in without changing any other way you access your account.
            </p>
          </div>

          <div className="space-y-1">
            <label htmlFor="account-password" className="text-sm font-medium text-gray-700">
              New password
            </label>
            <div className="relative">
              <Input
                id="account-password"
                name="account-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                required
                disabled={busy}
                aria-describedby="account-password-help"
                className="pr-12"
              />
              <PasswordToggleButton
                showPassword={showPassword}
                onToggle={() => setShowPassword((value) => !value)}
                disabled={busy}
              />
            </div>
            <p id="account-password-help" className="text-xs text-gray-600">
              {getPasswordRequirements(password)}
            </p>
          </div>

          <div className="space-y-1">
            <label htmlFor="account-password-confirm" className="text-sm font-medium text-gray-700">
              Confirm password
            </label>
            <Input
              id="account-password-confirm"
              name="account-password-confirm"
              type={showPassword ? 'text' : 'password'}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="new-password"
              required
              disabled={busy}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              {saving ? 'Saving…' : 'Save password'}
            </Button>
            <Button
              onClick={() => {
                resetForm()
                setExpanded(false)
                setError(null)
              }}
              variant="secondary"
              size="sm"
              disabled={busy}
            >
              Cancel
            </Button>
          </div>

          <div className="space-y-2 border-t border-gray-200 pt-3">
            <p className="text-xs text-gray-600">
              Emailed-link alternative
            </p>
            {turnstileSiteKey && (
              <TurnstileCaptcha
                ref={captchaRef}
                action="password_recovery"
                siteKey={turnstileSiteKey}
                onTokenChange={setCaptchaToken}
                disabled={busy}
              />
            )}
            <button
              type="button"
              onClick={() => void handlePasswordLink()}
              disabled={busy}
              className="text-sm font-medium text-gray-700 underline underline-offset-4 disabled:opacity-50"
            >
              {sendingLink
                ? 'Sending secure link…'
                : reauthenticationNeeded
                  ? 'Send the required secure link'
                  : 'Send a secure password link instead'}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="break-words text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="break-words text-sm text-green-700" role="status">
          {status}
        </p>
      )}
    </div>
  )
}
