/**
 * SubscribeButton Component
 * 
 * TEMPLATE CODE: Client-side button to trigger Stripe Checkout.
 * Handles authentication check and redirects to Stripe Checkout URL.
 */
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Button from './Button'

export default function SubscribeButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handleSubscribe = async () => {
    setLoading(true)

    try {
      // Get current session to check authentication
      // TEMPLATE CODE: We need the access token to send as Bearer token
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()

      // If no session exists, redirect to login
      if (sessionError || !session) {
        router.push('/login')
        return
      }

      // Get access token from session
      // SECURITY: This token is used server-side only via Authorization header
      // It's never exposed in logs or stored client-side beyond this request
      const accessToken = session.access_token

      // Call checkout API with Bearer token
      // TEMPLATE CODE: Authorization header is required so the server can verify
      // the user's identity without relying solely on cookies (more explicit auth)
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Send access token as Bearer token for explicit authentication
          // This allows the server to verify the user's identity
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ plan: 'pro' }),
      })

      if (!response.ok) {
        const text = await response.text()
        console.error('Checkout failed:', response.status, text)
        throw new Error(text || 'Failed to create checkout session')
      }

      const data = await response.json()
      const { url } = data

      if (!url) {
        throw new Error('No checkout URL returned')
      }

      // Redirect to Stripe Checkout
      window.location.href = url
    } catch (error) {
      console.error('Error initiating checkout:', error)
      // In a real app, you might want to show an error message to the user
      alert(error instanceof Error ? error.message : 'Failed to start checkout')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button onClick={handleSubscribe} variant="primary" disabled={loading}>
      {loading ? 'Loading...' : 'Subscribe'}
    </Button>
  )
}
