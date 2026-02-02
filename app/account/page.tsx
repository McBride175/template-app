import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import Card from '@/app/components/Card'
import ManageSubscriptionButton from '@/app/components/ManageSubscriptionButton'
import ChangePasswordButton from '@/app/components/ChangePasswordButton'

export default async function AccountPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="space-y-8">
      <div>
        <h1>Account</h1>
        <p className="mt-2 text-sm text-gray-600">Manage your account details</p>
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="mb-2">Signed in</h2>
            <p className="text-sm text-gray-700">{user.email}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <ManageSubscriptionButton />
            <ChangePasswordButton email={user.email ?? ''} />
          </div>
        </div>
      </Card>
    </div>
  )
}
