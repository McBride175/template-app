'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { addNote, fetchNotes, deleteNote, type Note } from '@/lib/notes'
import Button from '@/app/components/Button'
import Input from '@/app/components/Input'
import Card from '@/app/components/Card'
import SubscribeButton from '@/app/components/SubscribeButton'
import SubscriptionStatus from '@/app/components/SubscriptionStatus'

interface SubscriptionData {
  hasActive: boolean
  status: string | null
  current_period_end: string | null
}

function SubscribeSection() {
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchSubscription = async () => {
      try {
        const response = await fetch('/api/subscription', {
          cache: 'no-store',
          credentials: 'include',
        })

        if (response.ok) {
          const data: SubscriptionData = await response.json()
          setSubscription(data)
        }
      } catch (error) {
        console.error('Error fetching subscription:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchSubscription()
  }, [])

  const isSubscribed = subscription?.hasActive || 
    subscription?.status === 'active' || 
    subscription?.status === 'trialing'

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="mb-2">Subscribe</h2>
          {loading ? (
            <p className="text-sm text-gray-600">Loading...</p>
          ) : isSubscribed ? (
            <p className="text-sm text-gray-600">You're subscribed</p>
          ) : (
            <p className="text-sm text-gray-600">Get started with a subscription</p>
          )}
        </div>
        {!loading && (
          isSubscribed ? (
            <span className="text-sm text-gray-500">Active</span>
          ) : (
            <SubscribeButton />
          )
        )}
      </div>
    </Card>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  const [content, setContent] = useState('')
  const [notes, setNotes] = useState<Note[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // If user signs out while on dashboard, kick them to login
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace('/login')
    })

    // Initial check and load user data
    const run = async () => {
      const { data } = await supabase.auth.getUser()

      if (!data.user) {
        router.replace('/login')
        return
      }

      setEmail(data.user.email ?? null)
      setUserId(data.user.id)

      const { data: notesData, error: notesError } = await fetchNotes()
      if (notesError) setError(notesError.message)
      setNotes(notesData ?? [])
      setLoading(false)
    }

    run()

    return () => {
      sub.subscription.unsubscribe()
    }
  }, [router])

  const onAdd = async () => {
    setError(null)

    if (!userId) {
      setError('Not signed in')
      return
    }

    const trimmed = content.trim()
    if (!trimmed) return

    const { error: insertError } = await addNote(trimmed, userId)
    if (insertError) {
      setError(insertError.message)
      return
    }

    setContent('')

    const { data: notesData, error: notesError } = await fetchNotes()
    if (notesError) setError(notesError.message)
    setNotes(notesData ?? [])
  }

  const onDelete = async (id: string) => {
    setError(null)

    const { error: delError } = await deleteNote(id)
    if (delError) {
      setError(delError.message)
      return
    }

    const { data: notesData, error: notesError } = await fetchNotes()
    if (notesError) setError(notesError.message)
    setNotes(notesData ?? [])
  }
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1>Dashboard</h1>
          <p className="mt-2 text-sm text-gray-600">
            Signed in as: <span className="font-medium text-gray-900">{email ?? 'Loading...'}</span>
          </p>
        </div>

        <Button
          onClick={async () => {
            await supabase.auth.signOut()
            router.replace('/login')
          }}
          variant="secondary"
        >
          Sign out
        </Button>
      </div>

      <SubscriptionStatus />

      <SubscribeSection />

      <Card>
        <h2 className="mb-4">Add a note</h2>
        <div className="flex gap-2">
          <Input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write a note…"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onAdd()
              }
            }}
          />
          <Button onClick={onAdd} variant="primary">
            Add
          </Button>
        </div>

        {error && (
          <p className="mt-4 text-sm text-red-600">
            Error: <span className="font-medium">{error}</span>
          </p>
        )}
      </Card>

      <div>
        <h2 className="mb-4">Your notes</h2>

        {loading ? (
          <p className="text-sm text-gray-600">Loading…</p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-gray-600">No notes yet.</p>
        ) : (
          <div className="space-y-3">
            {notes.map((n) => (
              <Card key={n.id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-sm text-gray-900">{n.content}</p>
                    <p className="mt-2 text-xs text-gray-500">
                      {new Date(n.created_at).toLocaleString()}
                    </p>
                  </div>

                  <Button
                    onClick={() => onDelete(n.id)}
                    variant="ghost"
                    size="sm"
                  >
                    Delete
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}