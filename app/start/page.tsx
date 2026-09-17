import { createSupabaseServerClient } from '@/lib/supabase/server'
import StartAuthClient from './StartAuthClient'
import StartJourneyClient from './StartJourneyClient'

type StartPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function StartPage({ searchParams }: StartPageProps) {
  const params = (await searchParams) ?? {}
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return <StartAuthClient initialErrorCode={first(params.authError) ?? null} />
  }

  return (
    <StartJourneyClient
      requestedTenantId={(first(params.tenantId) ?? '').trim().slice(0, 255) || null}
      xeroResult={first(params.xero) ?? null}
      xeroReason={first(params.reason) ?? null}
    />
  )
}
