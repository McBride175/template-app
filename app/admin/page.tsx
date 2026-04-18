'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { NOTES_PAGE_SIZE, addNote, fetchNotes, deleteNote, type Note } from '@/lib/notes'
import Button from '@/app/components/Button'
import Input from '@/app/components/Input'
import Card from '@/app/components/Card'
import CollectionActionsClient from '@/app/collections/actions/CollectionActionsClient'

export default function AdminPage() {
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [notes, setNotes] = useState<Note[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace('/login')
    })

    const run = async () => {
      const { data } = await supabase.auth.getUser()

      if (!data.user) {
        router.replace('/login')
        return
      }

      setEmail(data.user.email ?? null)
      setUserId(data.user.id)

      const { data: notesData, error: notesError } = await fetchNotes(NOTES_PAGE_SIZE)
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

    const { data: insertedNote, error: insertError } = await addNote(trimmed, userId)
    if (insertError) {
      setError(insertError.message)
      return
    }

    setContent('')
    if (insertedNote) {
      setNotes((prev) => [insertedNote, ...prev].slice(0, NOTES_PAGE_SIZE))
    }
  }

  const onDelete = async (id: string) => {
    setError(null)

    const { error: delError } = await deleteNote(id)
    if (delError) {
      setError(delError.message)
      return
    }

    setNotes((prev) => prev.filter((note) => note.id !== id))
  }

  return (
    <div className="space-y-8">
      <div>
        <h1>Admin</h1>
        <p className="mt-2 text-sm text-gray-600">
          Signed in as: <span className="font-medium text-gray-900">{email ?? 'Loading...'}</span>
        </p>
      </div>

      <Card>
        <h2 className="mb-4">Add a note</h2>
        <div className="flex gap-2">
          <Input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write a note..."
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
          <p className="text-sm text-gray-600">Loading...</p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-gray-600">No notes yet.</p>
        ) : (
          <div className="space-y-3">
            {notes.map((n) => (
              <Card key={n.id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-sm text-gray-900">{n.content}</p>
                    <p className="mt-2 text-xs text-gray-500">{new Date(n.created_at).toLocaleString()}</p>
                  </div>

                  <Button onClick={() => onDelete(n.id)} variant="ghost" size="sm">
                    Delete
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Card>
        <h2 className="mb-4">Xero data views</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/xero/raw"
            className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
          >
            View raw JSON
          </Link>
          <Link
            href="/xero/canonical/customers"
            className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
          >
            Canonical customers
          </Link>
          <Link
            href="/xero/canonical/invoices"
            className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
          >
            Canonical invoices
          </Link>
          <Link
            href="/xero/canonical/payments"
            className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
          >
            Canonical payments
          </Link>
        </div>
      </Card>

      <CollectionActionsClient
        showHeader={false}
        showFilters={false}
        loginNextPath="/admin"
      />
    </div>
  )
}
