import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { buildLoginPath } from '@/lib/auth-flow'
import { parsePromiseWorklist, promiseWorklistUrl } from '@/lib/collections/promise-worklist'
import PromisesClient from './PromisesClient'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Promises | Yuohme', robots: { index: false, follow: false } }
export default async function PromisesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams, params = new URLSearchParams()
  for (const [key, value] of Object.entries(raw)) if (typeof value === 'string') params.set(key, value)
  const tenantId = params.get('tenantId'), supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(buildLoginPath(`/promises${params.size ? `?${params}` : ''}`))
  let query
  try { query = parsePromiseWorklist(params) }
  catch { redirect(promiseWorklistUrl(parsePromiseWorklist(new URLSearchParams()), tenantId)) }
  return <PromisesClient tenantId={tenantId} query={query} />
}
