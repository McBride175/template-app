'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Button from '@/app/components/Button'
import Card from '@/app/components/Card'

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
    // Reload notes
    const { data } = await supabase
      .from('notes')
      .select('id, content')
      .order('created_at', { ascending: false })
    if (data) setNotes(data)
  }

  return (
    <div className="space-y-8">
      <div>
        <h1>Template App</h1>
        <p className="mt-2 text-gray-600">Welcome to your template application</p>
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="mb-2">Supabase Notes</h2>
            <p className="text-sm text-gray-600">Test inserting notes into your Supabase database</p>
          </div>
          <Button onClick={addNote} variant="primary">
            Insert note
          </Button>
        </div>

        {status && (
          <p className={`mt-4 text-sm ${status.includes('Error') ? 'text-red-600' : 'text-gray-600'}`}>
            {status}
          </p>
        )}
      </Card>

      {notes.length > 0 && (
        <div>
          <h2 className="mb-4">Recent Notes</h2>
          <div className="space-y-3">
            {notes.map((note) => (
              <Card key={note.id}>
                <p className="text-sm text-gray-900">{note.content}</p>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}