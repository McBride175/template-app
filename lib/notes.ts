import { supabase } from '@/lib/supabase'

export type Note = {
  id: string
  user_id: string
  content: string
  created_at: string
}

export async function fetchNotes() {
  return supabase
    .from('notes')
    .select('id,user_id,content,created_at')
    .order('created_at', { ascending: false })
}

export async function addNote(content: string, userId: string) {
  return supabase.from('notes').insert([{ content, user_id: userId }])
}
export async function deleteNote(id: string) {
    return supabase.from('notes').delete().eq('id', id)
  }