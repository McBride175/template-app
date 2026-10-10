'use client'
import Link from 'next/link'
import Button from '@/app/components/ui/Button'
import Alert from '@/app/components/ui/Alert'
import Spinner from '@/app/components/ui/Spinner'
import EmptyState from '@/app/components/ui/EmptyState'
import DisputesFilters from './DisputesFilters'
import { disputeWorklistUrl, disputeCustomerHref, type DisputeWorklistQuery, type DisputeWorklistResponse, type DisputeWorklistRow } from '@/lib/collections/dispute-worklist'
import { promiseMoney } from '@/lib/collections/promise-presentation'
import { disputeStatus, disputeWarning, disputeReference } from './dispute-presentation'
export default function DisputeWorklist({ query, tenantId, data, loading, error, onRetry, onNavigate, onManage }: {
 query: DisputeWorklistQuery; tenantId: string | null; data: DisputeWorklistResponse | null; loading: boolean; error: string | null
 onRetry: () => void; onNavigate: (query: DisputeWorklistQuery) => void; onManage: (row: DisputeWorklistRow) => void
}) {
 const returnHref = disputeWorklistUrl(data?.query ?? query, data?.tenantId ?? tenantId)
 return <main className="min-w-0 space-y-3 sm:space-y-5">
   <header className="flex flex-wrap items-center justify-between gap-2"><div><h1 tabIndex={-1} data-dispute-heading className="text-xl font-semibold sm:text-2xl">Disputes</h1>
    <p className="mt-1 hidden text-sm text-text-secondary sm:block">Review and manage disputed invoices.</p></div>
    <Button variant="secondary" className="min-h-11" disabled={loading} onClick={onRetry}>Refresh list</Button></header>
   <DisputesFilters key={returnHref} query={data?.query ?? query} tenantId={data?.tenantId ?? tenantId} customers={data?.customers ?? []} blocked={loading} onNavigate={onNavigate} />
   {error && <Alert variant="error" role="alert">{error}{data && <p className="mt-1 text-sm">Last-loaded records remain visible. Retry to restore the current list.</p>}<Button className="ml-2 min-h-11" variant="secondary" onClick={onRetry}>Retry disputes</Button></Alert>}
   {loading && !data && <p role="status" className="flex min-h-24 items-center gap-2 text-sm"><Spinner label={null} />Loading disputes…</p>}
   {data && <>
    <p className="text-xs text-text-secondary">{data.total} matching dispute{data.total === 1 ? '' : 's'}.<span className="hidden sm:inline"> Amount sorting uses {data.organisationBaseCurrency ?? 'available base currency'} equivalents; unavailable valuations follow comparable amounts.</span></p>
    {data.rows.length ? <ol aria-label="Disputes worklist" className="divide-y divide-border-default border-y border-border-default">
     {data.rows.map(row => { const warning = disputeWarning(row), href = disputeCustomerHref(row, data.tenantId, returnHref)
      return <li key={row.disputeId} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_auto] items-center gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
       <div className="min-w-0">{href ? <Link href={href} className="block min-h-11 min-w-0 rounded-control focus-visible:outline-2 focus-visible:outline-focus" aria-label={`View invoice ${disputeReference(row)} for ${row.customerName ?? 'unavailable customer'}`}><h2 className="break-words text-sm font-semibold [overflow-wrap:anywhere]">{row.customerName ?? 'Customer unavailable'}</h2><p className="break-words text-xs text-link underline underline-offset-4 [overflow-wrap:anywhere]">{disputeReference(row)}</p></Link> : <><h2 className="break-words text-sm font-semibold [overflow-wrap:anywhere]">{row.customerName ?? 'Customer unavailable'}</h2><p className="break-words text-xs text-text-secondary [overflow-wrap:anywhere]">{disputeReference(row)}</p></>}</div>
       <div className="min-w-0 text-right sm:text-left"><p className="break-words font-semibold tabular-nums text-text-primary [overflow-wrap:anywhere]">{promiseMoney(row.effectiveDisputedAmountNative, row.currencyCode)}</p><p className="text-[11px] text-text-secondary">Effective disputed{row.currencyCode ? ` · ${row.currencyCode}` : ' · Currency unavailable'}</p></div>
       <p className="col-span-2 min-w-0 text-xs text-text-secondary sm:col-span-1">{disputeStatus(row)}</p>
       <Button variant="ghost" className="col-start-3 row-span-2 row-start-1 min-h-11 px-1 text-xs underline underline-offset-4 sm:col-start-4 sm:row-span-1" onClick={() => onManage(row)} aria-label={`Manage dispute for ${row.customerName ?? row.customerSourceId ?? 'unavailable customer'}, invoice ${disputeReference(row)}`}>Manage</Button>
       {warning && <p role="note" className="col-span-full break-words text-xs text-feedback-warning">{warning}</p>}
      </li>
     })}
    </ol> : <EmptyState title="No disputes match this view" description="Change the filters to review other dispute records. Resolution and accounting settlement remain separate." />}
    {data.pageCount > 1 && <nav aria-label="Dispute pages" className="flex items-center justify-between gap-2 text-sm"><Button variant="secondary" className="min-h-11" disabled={data.query.page <= 1} onClick={() => onNavigate({ ...data.query, page: data.query.page - 1 })}>Previous</Button><span>Page {data.query.page} of {data.pageCount}</span><Button variant="secondary" className="min-h-11" disabled={data.query.page >= data.pageCount} onClick={() => onNavigate({ ...data.query, page: data.query.page + 1 })}>Next</Button></nav>}
   </>}
 </main>
}
