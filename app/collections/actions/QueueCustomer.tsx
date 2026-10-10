'use client'

import Link from 'next/link'
import { useId, type ReactNode, type Ref } from 'react'
import Badge from '@/app/components/ui/Badge'

export interface QueueCustomerProps {
  position: number
  count: number
  name: string
  email: string | null
  amount: string
  equivalent?: boolean
  grossOverdue?: string
  totalOutstanding?: string
  disputed?: string
  promised?: string
  credit?: string
  nativeAmounts?: string
  weightedDays: string
  lastPayment: string
  recommendation: string
  reason?: string
  breakdown?: string[]
  score?: string
  adjustment: 'normal' | 'priority' | 'safe' | 'do_not_chase'
  invoicesHref: string
  historyHref?: string
  recentActivity?: ReactNode
  contextControl?: ReactNode
  detailActions?: ReactNode
  focusRef?: Ref<HTMLElement>
  children: ReactNode
}

// Display supplied values only. Ranking, eligibility and money remain server-owned.
export default function QueueCustomer({ position, count, name, email, amount,
  equivalent, grossOverdue, totalOutstanding, disputed, promised, credit, nativeAmounts,
  weightedDays, lastPayment, recommendation, reason, breakdown, score, adjustment,
  invoicesHref, historyHref, recentActivity, contextControl, detailActions, focusRef, children }: QueueCustomerProps) {
  const headingId = useId()
  return <article ref={focusRef} tabIndex={-1} aria-labelledby={headingId} className="min-w-0 scroll-mt-4 space-y-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus sm:space-y-6">
    <div className="space-y-3 sm:space-y-4">
      <p className="text-sm font-semibold text-text-secondary" aria-live="polite">Priority {position} of {count}</p>
      <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <h2 id={headingId} className="break-words text-xl font-semibold leading-tight [overflow-wrap:anywhere] sm:text-2xl">{name}</h2>
          <p className="mt-1 break-words text-sm text-text-secondary [overflow-wrap:anywhere]">{email || 'No email on file'}</p>
          {adjustment !== 'normal' && <Badge className="mt-2">{adjustment === 'priority' ? 'Priority adjustment' : adjustment === 'safe' ? 'Safe adjustment' : 'Never chase'}</Badge>}
        </div>
        <div className="min-w-0 sm:max-w-xs sm:text-right">
          <p className="text-sm font-medium text-text-secondary">{equivalent ? 'Equivalent to chase' : 'To chase'}</p>
          <p className="mt-1 break-words text-2xl font-semibold tabular-nums text-text-primary sm:text-3xl [overflow-wrap:anywhere]">{amount}</p>
          {credit && <p className="mt-1 text-xs text-text-secondary">{credit} Xero credit deducted</p>}
          {(promised || disputed) && <p className="mt-1 text-xs text-text-secondary">{[promised && `${promised} currently promised`, disputed && `${disputed} disputed overdue`].filter(Boolean).join(' · ')}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 border-y border-border-default py-2 text-sm sm:gap-y-2 sm:py-3">
        <p><span className="text-text-secondary">Score-based prompt: </span><strong className="font-semibold text-text-primary">{recommendation}</strong></p>
        <p><span className="text-text-secondary">Weighted overdue age: </span><span className="text-text-primary">{weightedDays} days</span></p>
      </div>
      {reason && <p className="text-sm leading-relaxed text-text-secondary">{reason}</p>}
    </div>

    {children}

    <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border-default pt-3 text-sm">
      <Link href={invoicesHref} className="inline-flex min-h-11 items-center rounded-control font-semibold text-link underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-focus">Manage invoices</Link>
      {historyHref && <Link href={historyHref} className="inline-flex min-h-11 items-center rounded-control font-medium text-link underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-focus">View full history</Link>}
      <p className="w-full text-xs text-text-secondary">Manage invoice promises and disputes with their invoices.</p>
    </div>

    <details className="border-t border-border-default">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-focus">
        {detailActions ? <><span className="sm:hidden">Financial details &amp; queue refresh</span><span className="hidden sm:inline">Financial detail &amp; priority explanation</span></> : 'Financial detail & priority explanation'}
      </summary>
      <div className="space-y-4 pb-2 text-sm">
        {!reason && <p className="text-sm text-text-secondary">Accounting data and your priority adjustments determine this order. Choose the appropriate contact method.</p>}
        <dl className="grid gap-3 sm:grid-cols-2">
          {[
            ['Gross overdue', grossOverdue], ['Total outstanding', totalOutstanding],
            ['Disputed overdue', disputed], ['Currently promised (overdue)', promised],
            ['Xero credit deducted', credit], ['Last payment', lastPayment],
          ].filter(([, value]) => value).map(([label, value]) => <div key={label} className="min-w-0">
            <dt className="text-xs text-text-secondary">{label}</dt>
            <dd className="break-words font-medium tabular-nums [overflow-wrap:anywhere]">{value}</dd>
          </div>)}
        </dl>
        {nativeAmounts && <p className="break-words text-text-secondary">{nativeAmounts} to chase in invoice currency</p>}
        <p className="text-xs text-text-secondary">Amounts have different scopes. Credits apply at customer level; promises and disputes remain attached to invoices.</p>
        {score && <p className="text-xs text-text-secondary">Priority score: {score}</p>}
        {breakdown?.length ? <ul className="list-disc space-y-1 pl-5 text-text-secondary">{breakdown.map(line => <li key={line}>{line}</li>)}</ul>
          : <p className="text-xs text-text-secondary">Detailed score drivers and payment-pattern comparisons are not available in this view.</p>}
        {recentActivity && <div className="border-t border-border-default pt-3">{recentActivity}</div>}
        {detailActions}
      </div>
    </details>
    {contextControl && <details className="border-t border-border-default">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-focus">Customer context</summary>
      <div className="pt-2">{contextControl}</div>
    </details>}
  </article>
}
