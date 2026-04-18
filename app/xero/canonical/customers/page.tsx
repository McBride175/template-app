import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { resolveCollectionsTenantId } from '@/lib/collections/tenant-context'

export const dynamic = 'force-dynamic'

interface CanonicalCustomerRow {
  id: string
  name: string
  email: string | null
  is_customer: boolean | null
  is_supplier: boolean | null
  status: string | null
}

function formatBoolean(value: boolean | null) {
  if (value === true) return 'true'
  if (value === false) return 'false'
  return 'null'
}

function parseTenantId(value: string | string[] | undefined) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export default async function XeroCanonicalCustomersPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login?next=/xero/canonical/customers')
  }

  const resolvedSearchParams = (await searchParams) ?? {}
  const requestedTenantId = parseTenantId(resolvedSearchParams.tenantId)
  const tenantId = await resolveCollectionsTenantId(supabase, user.id, requestedTenantId)
  const tenantQuery = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''

  if (!tenantId) {
    return (
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Canonical Customers</h1>
          <p className="mt-2 text-sm text-gray-600">
            No tenant selected. Connect Xero and choose an organisation first.
          </p>
        </div>
        <Link
          href="/account"
          className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
        >
          Go to Account
        </Link>
      </main>
    )
  }

  const { data: rows, error } = await supabase
    .from('canonical_customers')
    .select('id, name, email, is_customer, is_supplier, status')
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true })
    .limit(500)

  const customers = (rows ?? []) as CanonicalCustomerRow[]

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Canonical Customers</h1>
          <p className="mt-1 text-sm text-gray-600">Mapped customer records from Xero raw data.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin"
            className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
          >
            Admin
          </Link>
          <Link
            href={`/xero/raw${tenantQuery}`}
            className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
          >
            Xero raw
          </Link>
          <Link
            href={`/xero/canonical/invoices${tenantQuery}`}
            className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
          >
            Invoices
          </Link>
          <Link
            href={`/xero/canonical/payments${tenantQuery}`}
            className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
          >
            Payments
          </Link>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">Failed to load canonical customers.</p>}

      {!error && customers.length === 0 && (
        <p className="text-sm text-gray-600">No canonical customer rows found yet.</p>
      )}

      {!error && customers.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-gray-700">
              <tr>
                <th className="px-4 py-3 font-medium">name</th>
                <th className="px-4 py-3 font-medium">email</th>
                <th className="px-4 py-3 font-medium">is_customer</th>
                <th className="px-4 py-3 font-medium">is_supplier</th>
                <th className="px-4 py-3 font-medium">status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-800">
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td className="px-4 py-3">{customer.name}</td>
                  <td className="px-4 py-3">{customer.email ?? 'null'}</td>
                  <td className="px-4 py-3">{formatBoolean(customer.is_customer)}</td>
                  <td className="px-4 py-3">{formatBoolean(customer.is_supplier)}</td>
                  <td className="px-4 py-3">{customer.status ?? 'null'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
