import { redirect } from 'next/navigation'
import LoginForm from './LoginForm'
import {
  buildAuthSwitchPath,
  getAuthPageErrorMessage,
  getAuthPageStatusMessage,
  sanitizeAuthRedirectPath,
} from '@/lib/auth-flow'
import { createSupabaseServerClient } from '@/lib/supabase/server'

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}
function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = (await searchParams) ?? {}
  const nextPath = sanitizeAuthRedirectPath(params.next)
  const initialEmail = (first(params.email) ?? '').slice(0, 320)
  const initialError = getAuthPageErrorMessage(params.error)
  const initialStatus = getAuthPageStatusMessage(params.status)

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) redirect(nextPath)

  return (
    <LoginForm
      nextPath={nextPath}
      initialEmail={initialEmail}
      initialError={initialError}
      initialStatus={initialStatus}
      signupHref={buildAuthSwitchPath('/signup', nextPath, initialEmail)}
    />
  )
}
