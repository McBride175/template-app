/**
 * ChangePasswordButton Component
 *
 * TEMPLATE CODE: Sends a reset password email for the signed-in user.
 */
'use client'

import { useState } from 'react'
import Button from './Button'
import { supabase } from '@/lib/supabase'

export default function ChangePasswordButton({ email }: { email: string }) {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleChangePassword = async () => {
    setError(null)
    setStatus(null)

    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const redirectTo = `${origin}/auth/callback?next=/reset-password`
    console.log('[auth] resetPasswordForEmail redirectTo', { redirectTo })

    setLoading(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      { redirectTo }
    )
    setLoading(false)

    if (resetError) {
      setError(resetError.message)
      return
    }

    setStatus('Check your email for a password reset link.')
  }

  return (
    <div className="w-72 space-y-2 text-right">
      <Button
        onClick={handleChangePassword}
        variant="secondary"
        size="md"
        disabled={loading}
        className="w-full"
      >
        {loading ? 'Sending…' : 'Change password'}
      </Button>
      {error && <p className="text-xs break-words text-red-600">{error}</p>}
      {status && <p className="text-xs break-words text-green-700">{status}</p>}
    </div>
  )
}
