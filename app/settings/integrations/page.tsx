import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

interface XeroConnectionRow {
  user_id: string
  tenant_id: string
  tenant_name: string | null
  auth_state: 'active' | 'reauth_required' | 'disconnected' | 'error'
  updated_at: string
}

export default async function IntegrationsPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-semibold text-gray-900">Integrations</h1>
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-base font-medium text-gray-900">Xero connection status</h2>
          <p className="mt-2 text-sm text-gray-700">You need to sign in to manage integrations.</p>
          <Link
            href="/login"
            className="mt-4 inline-flex items-center justify-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Sign in
          </Link>
        </div>
      </main>
    )
  }

  const { data, error } = await supabase
    .from('xero_connections_public')
    .select('user_id, tenant_id, tenant_name, auth_state, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  const connections = (data ?? []) as XeroConnectionRow[]
  const hasActiveConnection = connections.some((connection) => connection.auth_state === 'active')

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-gray-900">Integrations</h1>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-base font-medium text-gray-900">Xero connection status</h2>

        {connections.length === 0 && !error && (
          <p className="mt-3 text-sm text-gray-700">No Xero organisations connected.</p>
        )}

        {connections.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-md border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-gray-700">
                <tr>
                  <th className="px-4 py-3 font-medium">Organisation</th>
                  <th className="px-4 py-3 font-medium">Tenant ID</th>
                  <th className="px-4 py-3 font-medium">Auth state</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-800">
                {connections.map((connection) => (
                  <tr key={connection.tenant_id}>
                    <td className="px-4 py-3">{connection.tenant_name ?? 'Unnamed organisation'}</td>
                    <td className="px-4 py-3">{connection.tenant_id}</td>
                    <td className="px-4 py-3">{connection.auth_state}</td>
                    <td className="px-4 py-3">{new Date(connection.updated_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-5 flex items-center gap-3">
          {!hasActiveConnection ? (
            <a
              href="/api/xero/connect"
              className="inline-flex items-center justify-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Connect Xero
            </a>
          ) : (
            <Link
              href="/account"
              className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
            >
              Manage in Account
            </Link>
          )}
        </div>

        {error && (
          <p className="mt-3 text-sm text-red-600">
            Could not load Xero status right now. Please refresh.
          </p>
        )}
      </div>
    </main>
  )
}
