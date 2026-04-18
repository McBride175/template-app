/**
 * ManageSubscriptionButton Component
 *
 * TEMPLATE CODE: Client-side button to open Stripe Customer Portal.
 * Calls /api/portal and redirects to the returned URL.
 */
'use client'

import { useState } from 'react'
import Button from './Button'

export default function ManageSubscriptionButton() {
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleManage = async () => {
    setLoading(true)
    setErrorMessage(null)
    try {
      const response = await fetch('/api/portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        let message = 'Failed to create portal session'
        try {
          const payload = await response.json()
          if (payload?.error && typeof payload.error === 'string') {
            message = payload.error
          }
        } catch {
          // ignore parse errors and keep fallback message
        }
        throw new Error(message)
      }

      const data = await response.json()
      if (!data?.url) {
        throw new Error('No portal URL returned')
      }

      window.location.href = data.url
    } catch (error) {
      console.error('Error opening customer portal:', error)
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to open customer portal'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex w-72 flex-col items-end gap-1">
      <Button
        onClick={handleManage}
        variant="secondary"
        disabled={loading}
        className="w-full"
      >
        {loading ? 'Loading…' : 'Manage subscription'}
      </Button>
      {errorMessage && (
        <p
          className="text-xs break-words text-red-600"
          role="status"
          aria-live="polite"
        >
          {errorMessage}
        </p>
      )}
    </div>
  )
}
