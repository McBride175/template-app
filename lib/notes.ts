import { supabase } from '@/lib/supabase'

export type Note = {
  id: string
  user_id: string
  content: string
  created_at: string
}

export const NOTES_PAGE_SIZE = 50

export async function fetchNotes(limit = NOTES_PAGE_SIZE) {
  return supabase
    .from('notes')
    .select('id,user_id,content,created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
}

export async function addNote(content: string, userId: string) {
  return supabase
    .from('notes')
    .insert([{ content, user_id: userId }])
    .select('id,user_id,content,created_at')
    .single<Note>()
}
export async function deleteNote(id: string) {
  return supabase.from('notes').delete().eq('id', id)
}
