'use client'

import Link from 'next/link'
import { useId, useState } from 'react'
import Button from '@/app/components/ui/Button'
import Field from '@/app/components/ui/Field'
import Input from '@/app/components/ui/Input'
import Select from '@/app/components/ui/Select'
import { disputeWorklistUrl, type DisputeWorklistQuery } from '@/lib/collections/dispute-worklist'

export interface DisputesFiltersProps {
  query: DisputeWorklistQuery
  tenantId: string | null
  customers: readonly { sourceId: string; name: string }[]
  blocked: boolean
  initialExpanded?: boolean
}

// Only disclosure state lives here. The existing GET form still applies the query.
export default function DisputesFilters({ query, tenantId, customers, blocked, initialExpanded = false }: DisputesFiltersProps) {
  const [expanded, setExpanded] = useState(initialExpanded)
  const controlsId = useId(), searchId = useId(), statusId = useId(), customerId = useId(), sortId = useId()
  const activeCount = Number(query.status !== 'active') + Number(Boolean(query.customer)) + Number(Boolean(query.q))
  const changed = activeCount > 0 || query.sort !== 'amount_desc'
  const resetHref = disputeWorklistUrl({ ...query, status: 'active', customer: '', q: '', sort: 'amount_desc', page: 1 }, tenantId)
  return <form action="/disputes" method="get" className="rounded-lg border border-border-default bg-surface p-3 sm:p-4">
    {tenantId && <input type="hidden" name="tenantId" value={tenantId} />}
    <input type="hidden" name="pageSize" value={query.pageSize} />
    <fieldset disabled={blocked} className="flex min-w-0 flex-wrap items-end gap-3 text-sm disabled:opacity-60">
      <legend className="sr-only">Filter and sort disputes</legend>
      <Field id={searchId} label="Search customer or invoice" className="order-1 min-w-0 flex-1 sm:min-w-48">
        {control => <Input {...control} name="q" type="search" maxLength={200} defaultValue={query.q} className="min-h-11" />}
      </Field>
      <Button type="submit" className="order-2 min-h-11"><span className="sm:hidden">Apply</span><span className="hidden sm:inline">Apply filters</span></Button>
      <Button variant="ghost" className="order-3 min-h-11 w-full justify-between px-0 sm:hidden"
        aria-expanded={expanded} aria-controls={controlsId} onClick={() => setExpanded(value => !value)}>
        <span>Filters{activeCount ? ` · ${activeCount} active` : query.sort !== 'amount_desc' ? ' · Custom sort' : ' · Active'}</span><span>{expanded ? 'Close' : 'Show'}</span>
      </Button>
      <div id={controlsId} className={`${expanded ? 'flex' : 'hidden'} order-4 w-full flex-wrap items-end gap-3 sm:contents`}>
        <Field id={statusId} label="Status" className="min-w-0 w-full sm:order-3 sm:w-auto">
          {control => <Select {...control} name="status" defaultValue={query.status} className="min-h-11">
            <option value="active">Active</option><option value="needs_review">Needs review</option>
            <option value="resolved">Resolved by user</option><option value="settled">Settled in accounting</option>
            <option value="unavailable">Invoice unavailable</option><option value="all">All disputes</option>
          </Select>}
        </Field>
        <Field id={customerId} label="Customer" className="min-w-0 w-full sm:order-4 sm:w-auto sm:max-w-64">
          {control => <Select {...control} name="customer" defaultValue={query.customer} className="min-h-11">
            <option value="">All customers</option>{customers.map(customer => <option key={customer.sourceId} value={customer.sourceId}>{customer.name}</option>)}
          </Select>}
        </Field>
        <Field id={sortId} label="Sort" className="min-w-0 w-full sm:order-5 sm:w-auto">
          {control => <Select {...control} name="sort" defaultValue={query.sort} className="min-h-11">
            <option value="amount_desc">Highest effective disputed amount</option><option value="amount_asc">Lowest effective disputed amount</option>
            <option value="oldest">Oldest invoice overdue age</option><option value="newest">Newest dispute</option><option value="customer">Customer name</option>
          </Select>}
        </Field>
      </div>
      {changed && <Link href={resetHref} aria-disabled={blocked || undefined} tabIndex={blocked ? -1 : undefined}
        onClick={event => { if (blocked) event.preventDefault() }}
        className="order-5 inline-flex min-h-11 items-center rounded-control font-medium text-link underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-focus sm:order-6">Clear filters</Link>}
      {!changed && expanded && <Button type="reset" variant="ghost" className="order-5 min-h-11 px-0 sm:hidden">Reset filters</Button>}
    </fieldset>
  </form>
}
