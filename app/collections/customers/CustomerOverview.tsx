import type { ReactNode } from 'react'
import Link from 'next/link'
import type { CustomerCollectionsSummaryRow } from './customer-workspace-types'
import { formatDate, formatMoney, formatInvoicedBreakdown, getStatusLabel } from './customer-format'
import { formatCurrentOverdueAge, formatHistoricalPaymentTiming, formatRelativeLateness } from '@/lib/collections/payment-behavior-copy'
import Badge from '@/app/components/ui/Badge'

/** Only server-derived customer amounts and established display formatters. */
export default function CustomerOverview({ row, currency, equivalent, historyHref, contextControl }: {
  row: CustomerCollectionsSummaryRow; currency: string | null; equivalent: boolean
  historyHref?: string; contextControl?: ReactNode
}) {
  return <section id="customer-overview" tabIndex={-1} aria-label="Customer financial overview" className="min-w-0 space-y-4">
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="break-words text-xl font-semibold leading-tight [overflow-wrap:anywhere] sm:text-2xl">{row.customer_name}</h2>
        <p className="mt-1 break-words text-sm text-text-secondary [overflow-wrap:anywhere]">{row.customer_email || 'No email recorded'}</p>
      </div>
      <Badge>{getStatusLabel(row)}</Badge>
    </div>
    <div className="grid min-w-0 gap-3 border-y border-border-default py-3 sm:grid-cols-[minmax(0,1fr)_1fr]">
      <div className="min-w-0">
        <p className="text-sm text-text-secondary">To chase{equivalent ? ' · base currency equivalent' : ''}</p>
        <p className="break-words text-2xl font-semibold text-text-primary tabular-nums [overflow-wrap:anywhere] sm:text-3xl">{formatMoney(row.customer_to_chase_overdue_base, currency)}</p>
        {row.customer_to_chase_overdue_base === 0 && <p className="mt-1 text-xs text-text-secondary">No overdue amount to chase. Outstanding debt may still remain.</p>}
        {row.customer_credit_applied_base > 0 && <p className="mt-1 text-xs text-text-secondary">{formatMoney(row.customer_credit_applied_base, currency)} Xero credit deducted</p>}
      </div>
      <dl className="grid min-w-0 grid-cols-2 gap-3 text-sm sm:grid-cols-1">
        <div><dt className="text-text-secondary">Gross outstanding{equivalent ? ' · equivalent' : ''}</dt><dd className="break-words font-semibold tabular-nums">{formatMoney(row.total_outstanding_base, currency)}</dd></div>
        <div><dt className="text-text-secondary">Gross overdue{equivalent ? ' · equivalent' : ''}</dt><dd className="break-words font-semibold tabular-nums">{formatMoney(row.overdue_outstanding_base, currency)}</dd></div>
      </dl>
    </div>
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <div><dt className="text-text-secondary">Typical payment timing</dt><dd>{formatHistoricalPaymentTiming(row.historical_normal_days_late)}</dd></div>
      <div><dt className="text-text-secondary">Versus normal</dt><dd>{formatRelativeLateness(row.relative_lateness_days)}</dd></div>
    </dl>
    <nav aria-label="Customer views" className="flex flex-wrap gap-x-5 border-b border-border-default">
      <a href="#customer-invoices" className="inline-flex min-h-11 items-center font-semibold text-link underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-focus">Invoices</a>
      <a href="#customer-promises" className="inline-flex min-h-11 items-center font-semibold text-link underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-focus">Promises</a>
      {historyHref && <Link href={historyHref} className="inline-flex min-h-11 items-center font-semibold text-link underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-focus">View history</Link>}
    </nav>
    <details className="border-b border-border-default">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-focus">Financial & payment details</summary>
      <dl className="grid gap-3 pb-3 text-sm sm:grid-cols-2">
        <div><dt className="text-text-secondary">Current overdue age</dt><dd>{formatCurrentOverdueAge(row.weighted_avg_overdue_days)}</dd></div>
        <div><dt className="text-text-secondary">Historical invoices</dt><dd>{row.historical_paid_invoice_count}</dd></div>
        <div><dt className="text-text-secondary">Overdue invoices</dt><dd>{row.overdue_invoices_count}</dd></div>
        <div><dt className="text-text-secondary">Oldest actionable overdue</dt><dd>{row.oldest_overdue_days ?? '—'} days</dd></div>
        <div><dt className="text-text-secondary">Last payment</dt><dd>{formatDate(row.last_payment_date)}</dd></div>
        <div><dt className="text-text-secondary">Open / total invoices</dt><dd>{row.open_invoices_count} / {row.total_invoices_count}</dd></div>
        {row.has_active_dispute && <div><dt className="text-text-secondary">Disputed outstanding / overdue</dt><dd>{row.effective_disputed_outstanding_base_decimal === null ? 'Base amount unavailable' : formatMoney(Number(row.effective_disputed_outstanding_base_decimal), currency)} / {row.effective_disputed_overdue_base_decimal === null ? 'Base amount unavailable' : formatMoney(Number(row.effective_disputed_overdue_base_decimal), currency)}</dd></div>}
        {(equivalent || row.total_outstanding_base === null || row.overdue_outstanding_base === null) && <div className="sm:col-span-2"><dt className="text-text-secondary">Invoiced amounts · original currencies</dt><dd className="break-words">Outstanding: {formatInvoicedBreakdown(row.native_currency_breakdown, 'total_outstanding_native') || '—'}<br />Overdue: {formatInvoicedBreakdown(row.native_currency_breakdown, 'overdue_outstanding_native') || '—'}</dd></div>}
      </dl>
    </details>
    {contextControl && <details id="customer-context" className="scroll-mt-4 border-b border-border-default">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-focus">Priority adjustment · {row.override_level === 'do_not_chase' ? 'Never chase' : row.override_level === 'priority' ? 'Priority' : row.override_level === 'safe' ? 'Safe' : 'Normal'}</summary>
      <div className="space-y-3 pb-4 text-sm"><p className="text-text-secondary">Normal uses accounting data alone. Priority, Safe and Never chase remain in place until you change them. Use a dated outcome or invoice promise for temporary follow-up.</p>{contextControl}</div>
    </details>}
  </section>
}
