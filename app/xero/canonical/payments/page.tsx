import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { resolveCollectionsTenantId } from '@/lib/collections/tenant-context'
import {
  CANONICAL_ACTION_LINK_CLASS,
  CANONICAL_EMPTY_STATE_MESSAGE,
  getCanonicalNavLinks,
} from '@/app/xero/canonical/shared-copy'

export const dynamic = 'force-dynamic'

interface CanonicalPaymentRow {
  id: string
  invoice_source_id: string | null
  customer_source_id: string | null
  amount: string | null
  payment_date: string | null
  reference: string | null
}

function parseTenantId(value: string | string[] | undefined) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export default async function XeroCanonicalPaymentsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login?next=/xero/canonical/payments')
  }

  const resolvedSearchParams = (await searchParams) ?? {}
  const requestedTenantId = parseTenantId(resolvedSearchParams.tenantId)
  const tenantId = await resolveCollectionsTenantId(supabase, user.id, requestedTenantId)
  const tenantQuery = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''
  const navLinks = getCanonicalNavLinks('payments', tenantQuery)

  if (!tenantId) {
    return (
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Canonical Payments</h1>
          <p className="mt-2 text-sm text-gray-600">{CANONICAL_EMPTY_STATE_MESSAGE}</p>
        </div>
        <Link href="/account" className={CANONICAL_ACTION_LINK_CLASS}>Go to Account</Link>
      </main>
    )
  }

  const { data: rows, error } = await supabase
    .from('canonical_payments')
    .select('id, invoice_source_id, customer_source_id, amount, payment_date, reference')
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId)
    .order('payment_date', { ascending: false, nullsFirst: false })
    .limit(500)

  const payments = (rows ?? []) as CanonicalPaymentRow[]

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Canonical Payments</h1>
          <p className="mt-1 text-sm text-gray-600">Mapped payment records from invoice payments.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href} className={CANONICAL_ACTION_LINK_CLASS}>
              {link.label}
            </Link>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">Failed to load canonical payments.</p>}

      {!error && payments.length === 0 && (
        <p className="text-sm text-gray-600">No canonical payment rows found yet.</p>
      )}

      {!error && payments.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-gray-700">
              <tr>
                <th className="px-4 py-3 font-medium">invoice_source_id</th>
                <th className="px-4 py-3 font-medium">customer_source_id</th>
                <th className="px-4 py-3 font-medium">amount</th>
                <th className="px-4 py-3 font-medium">payment_date</th>
                <th className="px-4 py-3 font-medium">reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-800">
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td className="px-4 py-3">{payment.invoice_source_id ?? 'null'}</td>
                  <td className="px-4 py-3">{payment.customer_source_id ?? 'null'}</td>
                  <td className="px-4 py-3">{payment.amount ?? 'null'}</td>
                  <td className="px-4 py-3">{payment.payment_date ?? 'null'}</td>
                  <td className="px-4 py-3">{payment.reference ?? 'null'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
