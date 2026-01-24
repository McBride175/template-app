'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { addNote, fetchNotes, deleteNote, type Note } from '@/lib/notes'
import Button from '@/app/components/Button'
import Input from '@/app/components/Input'
import Card from '@/app/components/Card'

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