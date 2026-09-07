import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { claimActionsEntitlementStatus } from '@/lib/billing/entitlements'
import {
  CANONICAL_ACTION_LINK_CLASS,
  CANONICAL_EMPTY_STATE_MESSAGE,
  getCanonicalNavLinks,
} from '@/app/xero/canonical/shared-copy'

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
  const entitlement = await claimActionsEntitlementStatus({
    userId: user.id,
    preferredTenantId: requestedTenantId,
    supabase,
  })
  const tenantId = entitlement.tenantId
  if (tenantId && !entitlement.hasActionsAccess) {
    redirect('/pricing?reason=usage-limit')
  }
  const tenantQuery = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''
  const navLinks = getCanonicalNavLinks('customers', tenantQuery)

  if (!tenantId) {
    return (
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Canonical Customers</h1>
          <p className="mt-2 text-sm text-gray-600">{CANONICAL_EMPTY_STATE_MESSAGE}</p>
        </div>
        <Link
          href="/account"
          className={CANONICAL_ACTION_LINK_CLASS}
        >
          Go to Account
        </Link>
      </main>
    )
  }

  const supabaseAdmin = createSupabaseAdminClient()
  const { data: rows, error } = await supabaseAdmin
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
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href} className={CANONICAL_ACTION_LINK_CLASS}>
              {link.label}
            </Link>
          ))}
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
