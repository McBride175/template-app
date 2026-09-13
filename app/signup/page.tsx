import { redirect } from 'next/navigation'
import SignUpForm from './SignUpForm'
import { buildAuthSwitchPath, sanitizeAuthRedirectPath } from '@/lib/auth-flow'
import { createSupabaseServerClient } from '@/lib/supabase/server'

type SignUpPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}
function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const params = (await searchParams) ?? {}
  const nextPath = sanitizeAuthRedirectPath(params.next)
  const initialEmail = (first(params.email) ?? '').slice(0, 320)

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) redirect(nextPath)

  return (
    <SignUpForm
      nextPath={nextPath}
      initialEmail={initialEmail}
      loginHref={buildAuthSwitchPath('/login', nextPath, initialEmail)}
    />
  )
}
