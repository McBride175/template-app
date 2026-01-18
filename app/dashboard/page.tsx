'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { addNote, fetchNotes, deleteNote, type Note } from '@/lib/notes'

export default function DashboardPage() {
  const router = useRouter()

  const [email, setEmail] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  const [content, setContent] = useState('')
  const [notes, setNotes] = useState<Note[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
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
  }, [router])

  const onAdd = async () => {
    setError(null)

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
    await deleteNote(id)
    const { data } = await fetchNotes()
    setNotes(data ?? [])
  }
  return (
    <main className="min-h-screen p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>

        <button
          onClick={async () => {
            await supabase.auth.signOut()
            router.replace('/login')
          }}
          className="rounded-md px-4 py-2 border"
        >
          Sign out
        </button>
      </div>

      <p className="mt-4 text-sm">
        Signed in as: <span className="font-medium">{email ?? 'Loading...'}</span>
      </p>

      <div className="mt-8 flex gap-2">
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write a note…"
          className="flex-1 rounded-md border px-3 py-2"
        />
        <button onClick={onAdd} className="rounded-md px-4 py-2 border">
          Add
        </button>
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-600">
          Error: <span className="font-medium">{error}</span>
        </p>
      )}

      <div className="mt-8">
        <h2 className="text-lg font-semibold">Your notes</h2>

        {loading ? (
          <p className="mt-3 text-sm">Loading…</p>
        ) : notes.length === 0 ? (
          <p className="mt-3 text-sm">No notes yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {notes.map((n) => (
  <li key={n.id} className="rounded-md border p-3">
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm">{n.content}</div>
        <div className="mt-1 text-xs opacity-70">
          {new Date(n.created_at).toLocaleString()}
        </div>
      </div>

      <button
        onClick={() => onDelete(n.id)}
        className="rounded-md px-3 py-1 border text-sm"
      >
        Delete
      </button>
    </div>
  </li>
))}
          </ul>
        )}
      </div>
    </main>
  )
}