'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Card from '@/app/components/Card'
import ManageSubscriptionButton from '@/app/components/ManageSubscriptionButton'
import ChangePasswordButton from '@/app/components/ChangePasswordButton'
import Button from '@/app/components/Button'
import Input from '@/app/components/Input'
import { supabase } from '@/lib/supabase'

interface SubscriptionData {
  hasActive: boolean
  status: string | null
  current_period_end: string | null
  hasCustomer: boolean
  plan?: 'basic' | 'pro' | null
}

export default function AccountPage() {
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleteInput, setDeleteInput] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.auth.getSession()
      if (!data.session?.user) {
        router.replace('/login')
        return
      }
      setEmail(data.session.user.email ?? null)

      try {
        const response = await fetch('/api/subscription', {
          cache: 'no-store',
          credentials: 'include',
        })
        if (response.ok) {
          const sub: SubscriptionData = await response.json()
          setSubscription(sub)
        }
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [router])

  const handleDeleteAccount = async () => {
    setDeleteError(null)

    if (deleteInput !== 'DELETE') return

    const confirmed = window.confirm(
      'This will permanently delete your account and data. Continue?'
    )
    if (!confirmed) return

    setDeleteLoading(true)
    try {
      const response = await fetch('/api/account/delete', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
      })

      if (!response.ok) {
        let message = 'Failed to delete account.'
        try {
          const payload = await response.json()
          if (typeof payload?.error === 'string') {
            message = payload.error
          }
        } catch {
          // ignore parse failures
        }
        throw new Error(message)
      }

      await supabase.auth.signOut()
      router.replace('/?accountDeleted=1')
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : 'Failed to delete account.'
      )
    } finally {
      setDeleteLoading(false)
    }
  }

  if (loading) return null

  return (
    <div className="space-y-8">
      <div>
        <h1>Account</h1>
        <p className="mt-2 text-sm text-gray-600">Manage your account details</p>
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="mb-2">Signed in</h2>
            <p className="text-sm text-gray-700">{email}</p>
            {!subscription?.hasCustomer && (
              <p className="mt-1 text-sm text-gray-500">Not subscribed yet</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            {subscription?.hasCustomer ? (
              <ManageSubscriptionButton />
            ) : (
              <Button
                onClick={() => router.push('/pricing')}
                variant="primary"
                size="sm"
              >
                Choose a plan
              </Button>
            )}
            <ChangePasswordButton email={email ?? ''} />
          </div>
        </div>
      </Card>

      <Card>
        <div className="space-y-4">
          <div>
            <h2 className="mb-2">Delete account</h2>
            <p className="text-sm text-gray-600">
              This permanently deletes your account and associated data.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="delete-confirm" className="text-sm text-gray-700">
              Type DELETE to confirm
            </label>
            <Input
              id="delete-confirm"
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
            />
          </div>

          <Button
            onClick={handleDeleteAccount}
            variant="ghost"
            size="sm"
            disabled={deleteInput !== 'DELETE' || deleteLoading}
            className="self-start text-red-600 hover:bg-red-50 hover:text-red-700 focus-visible:ring-red-700"
          >
            {deleteLoading ? 'Deleting…' : 'Delete account'}
          </Button>

          {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}
        </div>
      </Card>
    </div>
  )
}
