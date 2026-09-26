'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { InvoiceDisputeList } from '@/app/collections/customers/CustomerInvoiceDisputes'
import { disputeWorklistUrl, type DisputeWorklistQuery, type DisputeWorklistResponse } from '@/lib/collections/dispute-worklist'

function baseAmount(value: string | null, currency: string | null) {
  if (value === null || !currency || !Number.isFinite(Number(value))) return 'Base valuation unavailable'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 8 }).format(Number(value))
}

export default function DisputesClient({ tenantId, query }: {
  tenantId: string | null
  query: DisputeWorklistQuery
}) {
  const [data, setData] = useState<DisputeWorklistResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<{ stale: boolean; message: string } | null>(null)
  const [mutating, setMutating] = useState(false)
  const requestId = useRef(0)
  const url = disputeWorklistUrl(query, tenantId)
  const currentUrl = useRef(url)
  useEffect(() => { currentUrl.current = url }, [url])

  const reload = useCallback(async (manual = false) => {
    if (currentUrl.current !== url) return false
    const id = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(url.replace('/disputes?', '/api/collections/disputes?'), {
        credentials: 'include', cache: 'no-store',
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || !body?.ok) throw new Error(body?.error || 'Could not load disputes.')
      if (id !== requestId.current || currentUrl.current !== url) return false
      setData(body as DisputeWorklistResponse)
      if (manual) setOutcome(null)
      return true
    } catch (cause) {
      if (id === requestId.current) {
        setData(null)
        setError(cause instanceof Error ? cause.message : 'Could not load disputes.')
      }
      return false
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [url])

  useEffect(() => {
    setOutcome(null)
    void reload()
    return () => { requestId.current += 1 }
  }, [reload])

  const resolvedTenantId = data?.tenantId ?? tenantId
  const blocked = loading || mutating || Boolean(outcome?.stale)
  const shownQuery = data?.query ?? query
  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Disputes</h1>
          <p className="mt-1 text-sm text-gray-600">Review disputed invoices and the debt that remains collectible.</p>
        </div>
        <button type="button" className="min-h-11 rounded-md border px-4 text-sm" disabled={loading || mutating}
          onClick={() => void reload(true)}>{loading ? 'Refreshing…' : 'Refresh disputes'}</button>
      </div>
      <form key={`${url}:${data?.tenantId ?? 'pending'}`} action="/disputes" method="get" className="rounded-lg border border-gray-200 bg-white p-4">
        {resolvedTenantId && <input type="hidden" name="tenantId" value={resolvedTenantId} />}
        <input type="hidden" name="pageSize" value={query.pageSize} />
        <fieldset disabled={blocked} className="flex flex-wrap items-end gap-3 text-sm disabled:opacity-60">
          <legend className="sr-only">Filter and sort disputes</legend>
          <label className="flex flex-col gap-1">Status
            <select name="status" defaultValue={query.status} className="min-h-11 rounded-md border px-2">
              <option value="active">Active</option><option value="needs_review">Needs review</option>
              <option value="resolved">Resolved by user</option><option value="settled">Settled in accounting</option>
              <option value="unavailable">Invoice unavailable</option><option value="all">All disputes</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">Customer
            <select name="customer" defaultValue={query.customer} className="min-h-11 max-w-64 rounded-md border px-2">
              <option value="">All customers</option>
              {data?.customers.map((customer) => <option key={customer.sourceId} value={customer.sourceId}>{customer.name}</option>)}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1">Search customer or invoice
            <input name="q" type="search" maxLength={200} defaultValue={query.q} className="min-h-11 min-w-48 rounded-md border px-3" />
          </label>
          <label className="flex flex-col gap-1">Sort
            <select name="sort" defaultValue={query.sort} className="min-h-11 rounded-md border px-2">
              <option value="amount_desc">Highest effective disputed amount</option>
              <option value="amount_asc">Lowest effective disputed amount</option>
              <option value="oldest">Oldest invoice overdue age</option>
              <option value="newest">Newest dispute</option><option value="customer">Customer name</option>
            </select>
          </label>
          <button type="submit" className="min-h-11 rounded-md bg-gray-900 px-4 text-white">Apply filters</button>
        </fieldset>
      </form>
      {outcome && <p role={outcome.stale ? 'alert' : 'status'} className="rounded-md bg-amber-50 p-3 text-sm text-gray-900">
        {outcome.message}
        {outcome.stale && <button type="button" disabled={loading || mutating} className="ml-2 underline"
          onClick={() => void reload(true)}>Reload current disputes</button>}
      </p>}
      {error && <p role="alert" className="text-sm text-red-700">{error} <Link href="/account" className="underline">Account</Link></p>}
      {loading && <p role="status" className="text-sm text-gray-600">Loading disputes…</p>}
      {!loading && !error && !outcome?.stale && data && <>
        <p className="text-sm text-gray-600">{data.total} matching dispute{data.total === 1 ? '' : 's'}.
          {' '}Amount sorting uses {data.organisationBaseCurrency ?? 'available organisation currency'} equivalents; unavailable valuations follow comparable amounts.</p>
        {data.rows.length === 0 ? <p className="rounded-md border p-5 text-sm text-gray-600">
          {query.q || query.customer ? 'No disputes match these filters.' : query.status === 'active'
            ? 'No active disputes. Nothing currently needs dispute review.' : `No ${query.status.replace('_', ' ')} disputes.`}
        </p> : <div className="space-y-4">
          {data.rows.map((row) => <article key={row.disputeId} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="flex flex-wrap justify-between gap-3 p-4 text-sm">
              <div>
                <h2 className="font-semibold text-gray-900">{row.customerName ?? 'Customer unavailable'}</h2>
                {row.customerHref && <Link href={`${row.customerHref}#invoice-${encodeURIComponent(row.invoiceSourceId)}`}
                  className="mt-1 inline-block underline">View customer / invoice</Link>}
                {row.contextFromPreviousSnapshot && <p className="mt-1 text-xs text-gray-600">
                  {row.invoiceState === 'unavailable'
                    ? 'Last-known invoice context; absent from the current accounting snapshot.'
                    : 'Customer name from the last-known accounting snapshot.'}
                </p>}
                {row.invoiceState === 'unavailable' && !row.contextFromPreviousSnapshot &&
                  <p className="mt-1 text-xs text-gray-600">Invoice unavailable from the current accounting snapshot.</p>}
                {row.resolvedAt && <p className="mt-1 text-xs text-gray-600">Resolved {new Date(row.resolvedAt).toLocaleDateString()}</p>}
              </div>
              <div className="space-y-1 text-gray-700">
                <p>{row.overdueDays === null ? 'Invoice age unavailable' : row.overdueDays > 0 ? `${row.overdueDays} days overdue` : 'Not overdue'}</p>
                <p>Effective disputed equivalent: {baseAmount(row.effectiveDisputedBase, data.organisationBaseCurrency)}</p>
              </div>
            </div>
            <InvoiceDisputeList tenantId={data.tenantId} customerSourceId={row.customerSourceId ?? ''}
              customerName={row.customerName ?? 'unavailable customer'} invoices={[row]}
              showBulkActions={false} disabled={mutating} reload={() => reload()} onChanged={async () => true}
              onMutationStarted={() => { setMutating(true); setOutcome(null) }}
              onMutationPending={(message) => setOutcome({ stale: true, message })}
              onMutationResult={(refreshed, message) => { setMutating(false); setOutcome({ stale: !refreshed, message }) }}
              onMutationError={(message) => { setMutating(false); setOutcome({ stale: false, message }) }} />
          </article>)}
        </div>}
        {data.pageCount > 1 && !mutating && <nav aria-label="Dispute pages" className="flex items-center justify-between text-sm">
          {shownQuery.page > 1 ? <Link href={disputeWorklistUrl({ ...shownQuery, page: shownQuery.page - 1 }, data.tenantId)} className="underline">Previous</Link> : <span />}
          <span>Page {shownQuery.page} of {data.pageCount}</span>
          {shownQuery.page < data.pageCount ? <Link href={disputeWorklistUrl({ ...shownQuery, page: shownQuery.page + 1 }, data.tenantId)} className="underline">Next</Link> : <span />}
        </nav>}
      </>}
    </main>
  )
}
