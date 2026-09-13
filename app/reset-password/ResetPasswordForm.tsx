'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Card from '@/app/components/Card'
import Input from '@/app/components/Input'
import Button from '@/app/components/Button'
import PasswordToggleButton from '@/app/components/PasswordToggleButton'
import { buildLoginPath, getAuthActionErrorMessage } from '@/lib/auth-flow'
import { getPasswordStrength, validatePassword } from '@/lib/password'
import { supabase } from '@/lib/supabase'

type ResetPasswordFormProps = {
  hasSession: boolean
  nextPath: string
}

export default function ResetPasswordForm({ hasSession, nextPath }: ResetPasswordFormProps) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const strength = getPasswordStrength(password)

  const handleSave = async () => {
    setError(null)
    if (!password || !confirm) {
      setError('Enter and confirm your new password.')
      return
    }
    if (password !== confirm) {
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
        setError(getAuthActionErrorMessage(updateError, 'password-update'))
        return
      }

      router.replace(nextPath)
      router.refresh()
    } catch (updateError) {
      setError(getAuthActionErrorMessage(updateError, 'password-update'))
    } finally {
      setSaving(false)
    }
  }

  if (!hasSession) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
        <Card className="w-full max-w-md text-center">
          <h1 className="mb-2">Password link expired</h1>
          <p className="mb-6 text-gray-600">
            Password links can only be used once and expire for your security. Request a new one to
            continue.
          </p>
          <Link
            href={buildLoginPath(nextPath, 'reset_link_invalid')}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-gray-300 bg-white px-5 font-medium text-gray-900 hover:bg-gray-50"
          >
            Request a new password link
          </Link>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center py-8">
      <Card className="w-full max-w-md">
        <div className="text-center">
          <h1 className="mb-2">Set a new password</h1>
          <p className="mb-6 text-gray-600">
            You can use this password alongside Google sign-in, if you use Google.
          </p>
        </div>

        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault()
            void handleSave()
          }}
        >
          <div className="space-y-2">
            <label htmlFor="new-password" className="text-sm font-medium text-gray-700">
              New password
            </label>
            <div className="relative">
              <Input
                id="new-password"
                name="new-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                required
                disabled={saving}
                aria-describedby="new-password-requirements"
                className="h-12 pr-12 text-base"
              />
              <PasswordToggleButton
                showPassword={showPassword}
                onToggle={() => setShowPassword((value) => !value)}
                disabled={saving}
              />
            </div>
          </div>

          <div id="new-password-requirements" className="text-sm text-gray-600">
            <p className="text-sm font-medium text-gray-700">Password requirements</p>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              <li className={strength.hasMinLength ? 'text-green-700' : ''}>
                {strength.hasMinLength ? '✓' : '•'} At least 10 characters
              </li>
              <li className={strength.categoryCount >= 2 ? 'text-green-700' : ''}>
                {strength.categoryCount >= 2 ? '✓' : '•'} Two character types
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <label htmlFor="confirm-password" className="text-sm font-medium text-gray-700">
              Confirm new password
            </label>
            <div className="relative">
              <Input
                id="confirm-password"
                name="confirm-password"
                type={showConfirmation ? 'text' : 'password'}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
                required
                disabled={saving}
                className="h-12 pr-12 text-base"
              />
              <PasswordToggleButton
                showPassword={showConfirmation}
                onToggle={() => setShowConfirmation((value) => !value)}
                disabled={saving}
              />
            </div>
          </div>

          {error && (
            <div
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              role="alert"
            >
              {error}
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            disabled={saving}
          >
            {saving ? 'Saving password…' : 'Save password'}
          </Button>
        </form>
      </Card>
    </div>
  )
}
