import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import CustomerCollectionsClient from '@/app/collections/customers/CustomerCollectionsClient'

export const dynamic = 'force-dynamic'

function parseTenantId(value: string | string[] | undefined) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export default async function CustomerCollectionsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login?next=/customers')
  }

  const resolvedSearchParams = (await searchParams) ?? {}
  const tenantId = parseTenantId(resolvedSearchParams.tenantId)
  return <CustomerCollectionsClient tenantId={tenantId} />
}
