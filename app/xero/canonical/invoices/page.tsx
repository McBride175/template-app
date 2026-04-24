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

interface CanonicalInvoiceRow {
  id: string
  invoice_number: string | null
  customer_source_id: string | null
  status: string | null
  issue_date: string | null
  due_date: string | null
  total: string | null
  amount_due: string | null
  amount_paid: string | null
  amount_credited: string | null
  sent_to_contact: boolean | null
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

export default async function XeroCanonicalInvoicesPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login?next=/xero/canonical/invoices')
  }

  const resolvedSearchParams = (await searchParams) ?? {}
  const requestedTenantId = parseTenantId(resolvedSearchParams.tenantId)
  const tenantId = await resolveCollectionsTenantId(supabase, user.id, requestedTenantId)
  const tenantQuery = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''
  const navLinks = getCanonicalNavLinks('invoices', tenantQuery)

  if (!tenantId) {
    return (
      <main className="mx-auto max-w-7xl space-y-6 px-6 py-10">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Canonical Invoices</h1>
          <p className="mt-2 text-sm text-gray-600">{CANONICAL_EMPTY_STATE_MESSAGE}</p>
        </div>
        <Link href="/account" className={CANONICAL_ACTION_LINK_CLASS}>Go to Account</Link>
      </main>
    )
  }

  const { data: rows, error } = await supabase
    .from('canonical_invoices')
    .select(
      'id, invoice_number, customer_source_id, status, issue_date, due_date, total, amount_due, amount_paid, amount_credited, sent_to_contact'
    )
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId)
    .order('issue_date', { ascending: false, nullsFirst: false })
    .limit(500)

  const invoices = (rows ?? []) as CanonicalInvoiceRow[]

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Canonical Invoices</h1>
          <p className="mt-1 text-sm text-gray-600">Mapped invoice records from Xero raw data.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href} className={CANONICAL_ACTION_LINK_CLASS}>
              {link.label}
            </Link>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">Failed to load canonical invoices.</p>}

      {!error && invoices.length === 0 && (
        <p className="text-sm text-gray-600">No canonical invoice rows found yet.</p>
      )}

      {!error && invoices.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-gray-700">
              <tr>
                <th className="px-4 py-3 font-medium">invoice_number</th>
                <th className="px-4 py-3 font-medium">customer_source_id</th>
                <th className="px-4 py-3 font-medium">status</th>
                <th className="px-4 py-3 font-medium">issue_date</th>
                <th className="px-4 py-3 font-medium">due_date</th>
                <th className="px-4 py-3 font-medium">total</th>
                <th className="px-4 py-3 font-medium">amount_due</th>
                <th className="px-4 py-3 font-medium">amount_paid</th>
                <th className="px-4 py-3 font-medium">amount_credited</th>
                <th className="px-4 py-3 font-medium">sent_to_contact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-800">
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="px-4 py-3">{invoice.invoice_number ?? 'null'}</td>
                  <td className="px-4 py-3">{invoice.customer_source_id ?? 'null'}</td>
                  <td className="px-4 py-3">{invoice.status ?? 'null'}</td>
                  <td className="px-4 py-3">{invoice.issue_date ?? 'null'}</td>
                  <td className="px-4 py-3">{invoice.due_date ?? 'null'}</td>
                  <td className="px-4 py-3">{invoice.total ?? 'null'}</td>
                  <td className="px-4 py-3">{invoice.amount_due ?? 'null'}</td>
                  <td className="px-4 py-3">{invoice.amount_paid ?? 'null'}</td>
                  <td className="px-4 py-3">{invoice.amount_credited ?? 'null'}</td>
                  <td className="px-4 py-3">{formatBoolean(invoice.sent_to_contact)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
