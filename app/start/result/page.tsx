import { redirect } from 'next/navigation'
import { buildLoginPath } from '@/lib/auth-flow'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import FirstValueResultClient from './FirstValueResultClient'

export const dynamic = 'force-dynamic'

function parseTenantId(value: string | string[] | undefined) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed.slice(0, 255) : null
}

export default async function FirstValueResultPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = (await searchParams) ?? {}
  const tenantId = parseTenantId(params.tenantId)
  const nextPath = tenantId
    ? `/start/result?tenantId=${encodeURIComponent(tenantId)}`
    : '/start/result'
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect(buildLoginPath(nextPath, 'session_expired'))

  return <FirstValueResultClient tenantId={tenantId} />
}
