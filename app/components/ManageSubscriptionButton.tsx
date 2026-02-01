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

  const handleManage = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || 'Failed to create portal session')
      }

      const data = await response.json()
      if (!data?.url) {
        throw new Error('No portal URL returned')
      }

      window.location.href = data.url
    } catch (error) {
      console.error('Error opening customer portal:', error)
      alert(error instanceof Error ? error.message : 'Failed to open customer portal')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button onClick={handleManage} variant="secondary" disabled={loading}>
      {loading ? 'Loading…' : 'Manage subscription'}
    </Button>
  )
}
