'use client'
import Link from 'next/link'
import { useId, useState } from 'react'
import Button from '@/app/components/ui/Button'
import Field from '@/app/components/ui/Field'
import Input from '@/app/components/ui/Input'
import Select from '@/app/components/ui/Select'
import Alert from '@/app/components/ui/Alert'
import EmptyState from '@/app/components/ui/EmptyState'
import Spinner from '@/app/components/ui/Spinner'
import { actionStyles } from '@/app/components/ui/actionStyles'
import { promiseDate, promiseMoney, promiseOutcome } from '@/lib/collections/promise-presentation'
import { promiseCustomerHref, promiseDateLabels, promiseWorklistUrl, type PromiseWorklistQuery, type PromiseWorklistResponse } from '@/lib/collections/promise-worklist'

export function PromiseFilters({ query, onNavigate, busy = false }: { query: PromiseWorklistQuery; onNavigate: (query: PromiseWorklistQuery) => void; busy?: boolean }) {
  const id = useId(), [q, setQ] = useState(query.q), [status, setStatus] = useState(query.status), [date, setDate] = useState(query.date), [expanded, setExpanded] = useState(false)
  const controlsId = `${id}-controls`
  const filtered = Boolean(query.q || query.status !== 'active' || query.date !== 'all')
  return <form aria-label="Promise filters" onSubmit={event => { event.preventDefault(); if (busy) return; onNavigate({ ...query, q: q.trim(), status, date: status === 'active' ? date : 'all', page: 1 }) }}
    className="flex min-w-0 flex-wrap items-end gap-2">
    <Field id={`${id}-search`} label="Customer or invoice" className="order-1 min-w-0 flex-1 sm:min-w-48">{props => <Input {...props} type="search" value={q} maxLength={100} onChange={e => setQ(e.target.value)} placeholder="Search promises" className="min-h-11" />}</Field>
    <Button variant="ghost" className="order-3 min-h-11 w-full justify-between px-0 sm:hidden" aria-expanded={expanded} aria-controls={controlsId} onClick={() => setExpanded(value => !value)}>
      <span>Filters · {query.status === 'active' ? 'Active' : query.status === 'history' ? 'History' : query.status}{query.date !== 'all' ? ` · ${query.date === 'passed' ? 'Date passed' : query.date === 'today' ? 'Due today' : 'Upcoming'}` : ''}</span><span>{expanded ? 'Close' : 'Show'}</span>
    </Button>
    <div id={controlsId} className={`${expanded ? 'grid' : 'hidden'} order-4 w-full grid-cols-2 gap-2 sm:contents`}>
    <Field id={`${id}-status`} label="Commitments" className="min-w-0 sm:order-2 sm:w-44">{props => <Select {...props} value={status} className="min-h-11" onChange={e => setStatus(e.target.value as typeof status)}>
      <option value="active">Active</option><option value="history">History · all outcomes</option><option value="kept">Kept</option><option value="missed">Missed</option><option value="unclear">Unclear</option><option value="cancelled">Cancelled</option>
    </Select>}</Field>
    <Field id={`${id}-date`} label="Promise date" className="min-w-0 sm:order-3 sm:w-44">{props => <Select {...props} value={status === 'active' ? date : 'all'} disabled={status !== 'active'} className="min-h-11" onChange={e => setDate(e.target.value as typeof date)}>
      <option value="all">All dates</option><option value="passed">Date passed · active</option><option value="today">Due today</option><option value="upcoming">Upcoming</option>
    </Select>}</Field>
    </div>
    <div className="order-2 flex gap-2 sm:order-4"><Button type="submit" disabled={busy} className="min-h-11"><span className="sm:hidden">Apply</span><span className="hidden sm:inline">Apply filters</span></Button>
      {filtered && <Button variant="ghost" disabled={busy} className="min-h-11" onClick={() => { setQ(''); setStatus('active'); setDate('all'); onNavigate({ ...query, q: '', status: 'active', date: 'all', page: 1 }) }}>Clear</Button>}</div>
  </form>
}
export default function PromiseWorklist({ query, data, loading, error, onRetry, onNavigate }: {
  query: PromiseWorklistQuery; data: PromiseWorklistResponse | null; loading: boolean; error: string | null;
  onRetry: () => void; onNavigate: (query: PromiseWorklistQuery) => void
}) {
  const returnHref = promiseWorklistUrl(query, data?.tenantId)
  return <div className="min-w-0 space-y-3 sm:space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h1 className="text-xl font-semibold sm:text-2xl">Promises</h1>
      <p className="mt-1 hidden text-sm text-text-secondary sm:block">Payment commitments across customers. Priorities remains your collection worklist.</p></div>
      <Button variant="secondary" className="min-h-11" disabled={loading} onClick={onRetry}>Refresh list</Button></div>
    <PromiseFilters key={returnHref} query={query} onNavigate={onNavigate} busy={loading} />
    {error && <Alert variant="error" role="alert">{error}<Button variant="secondary" className="ml-2 min-h-11" onClick={onRetry}>Retry promises</Button></Alert>}
    {loading && <div role="status" className="flex min-h-32 items-center gap-2 text-sm text-text-secondary"><Spinner label={null} />Loading commitments…</div>}
    {!loading && !error && data && <>
      {!data.organisationDate && <Alert variant="warning">Organisation date context is unavailable. Active commitments retain their recorded status; date categories cannot be established.</Alert>}
      <div className="flex flex-wrap justify-between gap-1 text-xs text-text-secondary"><p>{data.total} matching commitment{data.total === 1 ? '' : 's'}<span className="hidden sm:inline">{query.status === 'active' ? ' · Earliest promise date first' : ' · Latest promise date first'}</span>.</p>
        {data.organisationDate && <p>Organisation date: {promiseDate(data.organisationDate)}<span className="hidden sm:inline"> · {data.timezone}</span></p>}</div>
      {data.rows.length === 0 ? <EmptyState title={query.q || query.date !== 'all' ? 'No promises match these filters' : query.status === 'active' ? 'No active promises' : 'No historical commitments'}
        description={data.total ? 'This page is no longer available. Return to the first page for the current worklist.' : 'Existing invoice promises appear here. Customer invoices remain available for investigation and management.'}>
        {query.page > 1 && <Button className="min-h-11" onClick={() => onNavigate({ ...query, page: 1 })}>First page</Button>}
      </EmptyState> : <ol aria-label="Promise commitments" className="divide-y divide-border-default border-y border-border-default">
        {data.rows.map(row => <li key={row.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div className="min-w-0"><h2 className="break-words text-sm font-semibold sm:text-base">{row.customerName ?? 'Customer name unavailable'}</h2><p className="break-all text-xs text-text-secondary">Invoice {row.invoiceReference}</p></div>
          <div className="min-w-0 max-w-40 text-right sm:max-w-none sm:text-left"><p className="text-[11px] text-text-secondary">Promised · {row.currencyCode || 'Currency unavailable'}</p><p className="break-all text-base font-semibold tabular-nums text-text-primary">{promiseMoney(row.promisedAmountNative, row.currencyCode || null)}</p></div>
          <div className="col-span-1 min-w-0 sm:col-span-1"><p className="text-sm">{row.promisedDate ? promiseDate(row.promisedDate) : 'Promise date unavailable'}</p><p className="mt-0.5 text-xs font-medium">{row.status === 'active' ? promiseDateLabels[row.dateCategory] : promiseOutcome[row.status]}</p></div>
          <Link href={promiseCustomerHref(row, data.tenantId, returnHref)} className={actionStyles({ variant: 'ghost', className: 'min-h-11 self-start px-1 text-sm underline underline-offset-4' })}
            aria-label={`${row.status === 'active' ? 'Manage promise' : 'View promise'} for ${row.customerName ?? row.customerSourceId}, invoice ${row.invoiceReference}`}>
            {row.status === 'active' ? 'Manage promise' : 'View promise'}</Link>
          {(row.contextUnavailable || row.financialUnavailable) && <p role="note" className="col-span-full text-xs text-feedback-warning">
            {row.contextUnavailable && 'Current customer or invoice context unavailable. '}{row.financialUnavailable && 'Some financial values are unavailable. '}Recorded commitment retained; investigate in Customers.</p>}
          <details className="col-span-full min-w-0"><summary className="w-fit min-h-11 cursor-pointer py-3 text-xs text-text-secondary focus-visible:outline-2 focus-visible:outline-focus">Payment progress{row.note ? ' & note' : ''}</summary>
            <div className="space-y-2 pb-2 text-sm text-text-secondary"><p>Qualifying payment recorded: {promiseMoney(row.qualifyingPaidAmountNative, row.currencyCode || null)}</p><p className="text-xs">Recorded accounting evidence only. An active promise with a passed date has not been declared missed.</p>
              <p>Current invoice outstanding: {promiseMoney(row.currentOutstandingNative, row.currencyCode || null)}{row.currentInvoiceStatus ? ` · ${row.currentInvoiceStatus}` : ' · Accounting context unavailable'}</p>
              {row.note && <p className="whitespace-pre-wrap break-words"><span className="font-semibold">Note: </span>{row.note}</p>}
              {row.resolvedAt && <p>Recorded outcome: {new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(row.resolvedAt))} (UTC date)</p>}
            </div>
          </details>
        </li>)}
      </ol>}
      {data.pageCount > 1 && <nav aria-label="Promise pages" className="flex items-center justify-between gap-2 text-sm">
        <Button variant="secondary" className="min-h-11" disabled={query.page <= 1} onClick={() => onNavigate({ ...query, page: query.page - 1 })}>Previous</Button>
        <span>Page {query.page} of {data.pageCount}</span><Button variant="secondary" className="min-h-11" disabled={query.page >= data.pageCount} onClick={() => onNavigate({ ...query, page: query.page + 1 })}>Next</Button>
      </nav>}
    </>}
  </div>
}
