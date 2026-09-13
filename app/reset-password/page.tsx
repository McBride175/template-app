import ResetPasswordForm from './ResetPasswordForm'
import { sanitizeAuthRedirectPath } from '@/lib/auth-flow'
import { createSupabaseServerClient } from '@/lib/supabase/server'

type ResetPasswordPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}
export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = (await searchParams) ?? {}
  const nextPath = sanitizeAuthRedirectPath(params.next)
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return <ResetPasswordForm hasSession={Boolean(user)} nextPath={nextPath} />
}
