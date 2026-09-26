import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { parseDisputeWorklistQuery } from '@/lib/collections/dispute-worklist'
import DisputesClient from '@/app/disputes/DisputesClient'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Disputes', robots: { index: false, follow: false } }

export default async function DisputesPage({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/disputes')
  const input = (await searchParams) ?? {}
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) if (typeof value === 'string') params.set(key, value)
  return <DisputesClient tenantId={params.get('tenantId')?.trim() || null}
    query={parseDisputeWorklistQuery(params)} />
}
