'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Note = {
  id: number
  content: string
}

export default function Home() {
  const [notes, setNotes] = useState<Note[]>([])
  const [status, setStatus] = useState('')

  useEffect(() => {
    const loadNotes = async () => {
      const { data, error } = await supabase
        .from('notes')
        .select('id, content')
        .order('created_at', { ascending: false })

      if (!error && data) {
        setNotes(data)
      }
    }

    loadNotes()
  }, [])

  const addNote = async () => {
    setStatus('Inserting…')

    const { error } = await supabase.from('notes').insert({
      content: `Hello from localhost at ${new Date().toISOString()}`,
    })

    if (error) {
      setStatus(`Error: ${error.message}`)
      return
    }

    setStatus('Inserted ✅')
  }

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 32, fontWeight: 700 }}>James’ Template App</h1>

      <button
        onClick={addNote}
        style={{ marginTop: 16, padding: 10 }}
      >
        Insert note into Supabase
      </button>

      {status && <p>{status}</p>}

      <ul style={{ marginTop: 24 }}>
        {notes.map((note) => (
          <li key={note.id}>{note.content}</li>
        ))}
      </ul>
    </main>
  )
}