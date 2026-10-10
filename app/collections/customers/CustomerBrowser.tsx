'use client'

import { useId } from 'react'
import type { CustomerCollectionsSummaryRow } from './customer-workspace-types'
import { formatMoney, formatInvoicedBreakdown } from './customer-format'
import Button from '@/app/components/ui/Button'
import Field from '@/app/components/ui/Field'
import Input from '@/app/components/ui/Input'
import Select from '@/app/components/ui/Select'
import Checkbox from '@/app/components/ui/Checkbox'
import EmptyState from '@/app/components/ui/EmptyState'
import Spinner from '@/app/components/ui/Spinner'

export interface CustomerBrowserProps {
  rows: CustomerCollectionsSummaryRow[]; selectedId: string | null; currency: string | null; equivalent: boolean
  search: string; onSearch: (value: string) => void
  overdueOnly: boolean; onOverdueOnly: (value: boolean) => void
  sort: string; onSort: (value: string) => void; sortOptions: readonly { value: string; label: string }[]
  loading: boolean; refreshing: boolean; blocked?: boolean; onRefresh: () => void
  onSelect: (id: string) => void; summary?: string
}

/** Controlled discovery: filtering, ordering, selection and requests stay in the client. */
export default function CustomerBrowser(props: CustomerBrowserProps) {
  const searchId = useId(), sortId = useId(), overdueId = useId()
  return <section aria-label="Customer browser" className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold">{props.selectedId ? 'Change customer' : 'Find a customer'}</h2>
      <Button variant="ghost" className="min-h-11" onClick={props.onRefresh} disabled={props.refreshing}>{props.refreshing ? 'Refreshing…' : 'Refresh'}</Button>
    </div>
    <Field id={searchId} label="Find a customer">
      {control => <Input {...control} type="search" value={props.search} onChange={event => props.onSearch(event.target.value)} placeholder="Search name or email" className="min-h-11" />}
    </Field>
    <details className="border-b border-border-default">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-focus">Sort & filters{props.overdueOnly ? ' · Overdue only' : ''}</summary>
      <div className="space-y-3 pb-3">
        <Field id={sortId} label="Sort">{control => <Select {...control} value={props.sort} onChange={event => props.onSort(event.target.value)} className="min-h-11">{props.sortOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>}</Field>
        <label htmlFor={overdueId} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><Checkbox id={overdueId} checked={props.overdueOnly} onChange={event => props.onOverdueOnly(event.target.checked)} />Overdue only</label>
      </div>
    </details>
    <p className="text-xs text-text-secondary" role="status">{props.summary || `${props.rows.length} customers shown`}</p>
    {props.loading ? <div className="flex items-center gap-2 py-4 text-sm" role="status"><Spinner label={null} />Loading customers…</div>
      : props.blocked ? <p className="text-sm text-text-secondary">Refresh current details before selecting another customer.</p>
      : !props.rows.length ? <EmptyState title="No customers matched" description="Try another name or adjust the filters." />
      : <ul className="divide-y divide-border-default" aria-label="Customers">
        {props.rows.map(row => <li key={row.customer_source_id}>
          <button type="button" aria-pressed={props.selectedId === row.customer_source_id} onClick={() => props.onSelect(row.customer_source_id)}
            className={`w-full min-w-0 border-l-2 px-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${props.selectedId === row.customer_source_id ? 'border-selected-accent bg-selected' : 'border-transparent hover:bg-surface-subtle'}`}>
            <span className="block break-words font-semibold [overflow-wrap:anywhere]">{row.customer_name}</span>
            <span className="mt-1 block break-words text-xs text-text-secondary [overflow-wrap:anywhere]">{row.customer_email || 'No email recorded'}</span>
            <span className="mt-2 block break-words text-sm tabular-nums">{formatMoney(row.customer_to_chase_overdue_base, props.currency)} to chase{props.equivalent ? ' · equivalent' : ''}</span>
            <span className="mt-1 block break-words text-xs text-text-secondary">Gross outstanding {formatMoney(row.total_outstanding_base, props.currency)}</span>
            <span className="mt-1 block break-words text-xs text-text-secondary">Gross overdue {formatMoney(row.overdue_outstanding_base, props.currency)} · {row.overdue_invoices_count} invoices</span>
            {(props.equivalent || row.total_outstanding_base === null || row.overdue_outstanding_base === null) && <span className="mt-1 block break-words text-xs text-text-secondary [overflow-wrap:anywhere]">Invoiced outstanding: {formatInvoicedBreakdown(row.native_currency_breakdown, 'total_outstanding_native') || '—'} · Invoiced overdue: {formatInvoicedBreakdown(row.native_currency_breakdown, 'overdue_outstanding_native') || '—'}</span>}
            {row.customer_credit_applied_base > 0 && <span className="mt-1 block text-xs text-text-secondary">{formatMoney(row.customer_credit_applied_base, props.currency)} Xero credit deducted</span>}
            {row.customer_to_chase_overdue_base === 0 && <span className="mt-1 block text-xs text-text-secondary">No overdue amount to chase</span>}
            {row.has_active_dispute && <span className="mt-1 block text-xs text-text-secondary">Disputed debt · review invoice details</span>}
            {row.override_level !== 'normal' && <span className="mt-1 block text-xs text-text-secondary">{row.override_level === 'do_not_chase' ? 'Never chase' : row.override_level === 'priority' ? 'Priority adjustment' : 'Safe adjustment'}</span>}
          </button>
        </li>)}
      </ul>}
  </section>
}
