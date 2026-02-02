/**
 * Reset Password Page
 *
 * TEMPLATE CODE: Requires an authenticated session created by the reset link.
 */
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Card from '@/app/components/Card'
import Input from '@/app/components/Input'
import Button from '@/app/components/Button'
import { supabase } from '@/lib/supabase'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [noSession, setNoSession] = useState(false)

  const hasLower = /[a-z]/.test(password)
  const hasUpper = /[A-Z]/.test(password)
  const hasNumber = /[0-9]/.test(password)
  const hasSymbol = /[^A-Za-z0-9]/.test(password)
  const categoryCount =
    (hasLower ? 1 : 0) +
    (hasUpper ? 1 : 0) +
    (hasNumber ? 1 : 0) +
    (hasSymbol ? 1 : 0)
  const hasMinLength = password.length >= 10

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        setNoSession(true)
        return
      }
      setLoading(false)
    })
  }, [router])

  const validatePassword = (value: string) => {
    if (value.length < 10) {
      return 'Password must be at least 10 characters.'
    }
    let categories = 0
    if (/[a-z]/.test(value)) categories += 1
    if (/[A-Z]/.test(value)) categories += 1
    if (/[0-9]/.test(value)) categories += 1
    if (/[^A-Za-z0-9]/.test(value)) categories += 1
    if (categories < 2) {
      return 'Password must include at least 2 of: lowercase, uppercase, number, symbol.'
    }
    return null
  }

  const handleSave = async () => {
    setError(null)
    if (!password || !confirm) {
      setError('Please enter and confirm your new password.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    const validationError = validatePassword(password)
    if (validationError) {
      setError(validationError)
      return
    }

    setSaving(true)
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    })
    setSaving(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    router.replace('/dashboard')
  }

  if (loading && !noSession) return null

  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center">
      <Card className="w-full max-w-md text-center">
        {noSession ? (
          <>
            <h1 className="mb-2">Link invalid or expired</h1>
            <p className="mb-6 text-gray-600">Request another reset link from the login page.</p>
            <Button onClick={() => router.replace('/login')} variant="secondary" size="lg" className="w-full">
              Back to login
            </Button>
          </>
        ) : (
          <>
            <h1 className="mb-2">Set a new password</h1>
            <p className="mb-6 text-gray-600">Choose a new password for your account</p>

            <div className="space-y-3 text-left">
              <label className="text-xs text-gray-500">New password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              <div className="text-xs text-gray-500 space-y-1">
                <p>Password requirements:</p>
                <ul className="space-y-1">
                  <li className={hasMinLength ? 'text-green-600' : ''}>
                    {hasMinLength ? '✓' : '•'} At least 10 characters
                  </li>
                  <li className={categoryCount >= 2 ? 'text-green-600' : ''}>
                    {categoryCount >= 2 ? '✓' : '•'} At least 2 of: lowercase, uppercase, number, symbol
                  </li>
                  <li className={hasLower ? 'text-green-600' : ''}>
                    {hasLower ? '✓' : '•'} Lowercase letter
                  </li>
                  <li className={hasUpper ? 'text-green-600' : ''}>
                    {hasUpper ? '✓' : '•'} Uppercase letter
                  </li>
                  <li className={hasNumber ? 'text-green-600' : ''}>
                    {hasNumber ? '✓' : '•'} Number
                  </li>
                  <li className={hasSymbol ? 'text-green-600' : ''}>
                    {hasSymbol ? '✓' : '•'} Symbol
                  </li>
                </ul>
              </div>
              <label className="text-xs text-gray-500">Confirm password</label>
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </div>

            <Button
              onClick={handleSave}
              variant="primary"
              size="lg"
              className="w-full mt-6"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Set password'}
            </Button>

            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          </>
        )}
      </Card>
    </div>
  )
}
