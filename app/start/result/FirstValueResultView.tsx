import Link from 'next/link'
import type { FirstValueReason } from '@/lib/collections/first-value'
import {
  resolveFirstValueOutcome,
  selectFirstValuePriorities,
} from '@/lib/collections/first-value'

export interface FirstValueResultRow {
  customer_source_id: string
  customer_name: string
  overdue_outstanding_base: number
  overdue_invoices_count: number
  weighted_avg_overdue_days: number
  override_level: 'safe' | 'normal' | 'priority' | 'do_not_chase'
  recommended_action: 'Review now' | 'Follow up' | 'Monitor' | 'No action'
  organisation_base_currency_code: string
  first_value_reasons: FirstValueReason[]
}

export interface FirstValueResultPayload {
  rows: FirstValueResultRow[]
  actionsTakenByCustomerId: Record<string, unknown>
  organisationBaseCurrency: string | null
  portfolio: {
    analysedOverdueBase: number
    analysedOverdueCustomerCount: number
    rankingStatus: 'complete' | 'provisional' | 'unavailable'
  } | null
  queue: {
    status: string
    mappedCustomerCount: number
    mappedInvoiceCount: number
    eligibleCustomerCount: number
    suppressedCustomerCount: number
    actionedTodayCount: number
    remainingCustomerCount: number
    reviewRequiredCustomerCount: number
    suppression?: {
      postponedCustomerCount: number
      promisedToPayCustomerCount: number
      nextReturnDate: string | null
    }
  }
  currencyHealth: {
    status: 'healthy' | 'degraded' | 'unavailable'
    affectedInvoiceCount: number
    affectedCustomerCount: number
  }
}

type Props = {
  data: FirstValueResultPayload
  tenantId: string
  organisationName: string | null
  lastSyncedAt: string | null
}

function formatMoney(amount: number, currencyCode: string | null) {
  try {
    if (!currencyCode) throw new Error('missing currency')
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(amount)
  }
}

function formatFreshness(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatReturnDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' })
}

function workspaceHref(tenantId: string) {
  return `/dashboard?tenantId=${encodeURIComponent(tenantId)}`
}

function WorkspaceLink({ tenantId, label }: { tenantId: string; label: string }) {
  return (
    <Link
      href={workspaceHref(tenantId)}
      className="inline-flex min-h-12 items-center justify-center rounded-xl bg-gray-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-gray-800"
    >
      {label}
    </Link>
  )
}

function AnalysisStamp({
  organisationName,
  lastSyncedAt,
  currencyCode,
}: {
  organisationName: string | null
  lastSyncedAt: string | null
  currencyCode: string | null
}) {
  const freshness = formatFreshness(lastSyncedAt)

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500">
      <span>
        Analysed {organisationName ? <strong className="font-semibold text-gray-700">{organisationName}</strong> : 'your Xero organisation'}
      </span>
      {currencyCode && <span aria-hidden="true">·</span>}
      {currencyCode && <span>Amounts in {currencyCode}</span>}
      {freshness && <span aria-hidden="true">·</span>}
      {freshness && <span>Updated {freshness}</span>}
    </div>
  )
}

function CurrencyNotice({ data }: { data: FirstValueResultPayload }) {
  if (data.currencyHealth.status !== 'degraded') return null

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <p className="font-semibold">This is a safe provisional ranking.</p>
      <p className="mt-1 text-amber-900">
        {data.currencyHealth.affectedCustomerCount} customer
        {data.currencyHealth.affectedCustomerCount === 1 ? '' : 's'} could not be valued reliably
        and {data.currencyHealth.affectedCustomerCount === 1 ? 'is' : 'are'} held out for review.
        The priorities below use only safely valued receivables.
      </p>
    </div>
  )
}

export default function FirstValueResultView({
  data,
  tenantId,
  organisationName,
  lastSyncedAt,
}: Props) {
  const priorities = selectFirstValuePriorities(
    data.rows,
    data.actionsTakenByCustomerId,
    3
  )
  const overdueCustomerCount = data.portfolio?.analysedOverdueCustomerCount ?? 0
  const outcome = resolveFirstValueOutcome({
    queueStatus: data.queue.status,
    priorityCount: priorities.length,
    overdueCustomerCount,
    reviewRequiredCustomerCount: data.queue.reviewRequiredCustomerCount,
    currencyHealthStatus: data.currencyHealth.status,
  })

  if (outcome === 'currency_unavailable') {
    return (
      <section className="mx-auto max-w-2xl py-8 sm:py-12">
        <div className="rounded-3xl border border-amber-200 bg-white p-7 shadow-sm sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-700">
            Analysis complete · action needed
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-gray-950 sm:text-4xl">
            Yuohme cannot safely rank this ledger yet
          </h1>
          <p className="mt-4 leading-relaxed text-gray-600">
            The organisation currency information is not reliable enough to compare balances. No
            chase priority is shown because doing so could be misleading.
          </p>
          <p className="mt-3 text-sm text-gray-500">
            {data.currencyHealth.affectedInvoiceCount} invoice
            {data.currencyHealth.affectedInvoiceCount === 1 ? '' : 's'} across{' '}
            {data.currencyHealth.affectedCustomerCount} customer
            {data.currencyHealth.affectedCustomerCount === 1 ? '' : 's'} need review.
          </p>
          <Link
            href={`/account?tenantId=${encodeURIComponent(tenantId)}`}
            className="mt-7 inline-flex min-h-12 items-center justify-center rounded-xl bg-gray-900 px-6 py-3 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Review Xero data
          </Link>
        </div>
      </section>
    )
  }

  if (outcome === 'currency_review_required') {
    return (
      <section className="mx-auto max-w-2xl py-8 sm:py-12">
        <div className="rounded-3xl border border-amber-200 bg-white p-7 shadow-sm sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-700">
            Analysis complete · review needed
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-gray-950 sm:text-4xl">
            Yuohme needs reliable currency values before ranking this ledger
          </h1>
          <p className="mt-4 leading-relaxed text-gray-600">
            {data.queue.reviewRequiredCustomerCount} customer
            {data.queue.reviewRequiredCustomerCount === 1 ? '' : 's'} could not be valued safely.
            Yuohme has not shown a chase priority because the comparison could be misleading.
          </p>
          <Link
            href={`/account?tenantId=${encodeURIComponent(tenantId)}`}
            className="mt-7 inline-flex min-h-12 items-center justify-center rounded-xl bg-gray-900 px-6 py-3 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Review Xero data
          </Link>
        </div>
      </section>
    )
  }

  if (outcome === 'no_receivables') {
    return (
      <section className="mx-auto max-w-2xl py-8 sm:py-12">
        <div className="rounded-3xl border border-sky-200 bg-white p-7 shadow-sm sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">
            Analysis complete
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-gray-950 sm:text-4xl">
            No receivables are available to prioritise yet
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-gray-700">
            Yuohme connected to your organisation successfully, but the current Xero snapshot
            contains no mapped customer balances or invoices to compare.
          </p>
          <div className="mt-5">
            <AnalysisStamp
              organisationName={organisationName}
              lastSyncedAt={lastSyncedAt}
              currencyCode={data.organisationBaseCurrency}
            />
          </div>
          <div className="mt-8">
            <WorkspaceLink tenantId={tenantId} label="Open Yuohme" />
          </div>
        </div>
      </section>
    )
  }

  if (outcome === 'no_overdue') {
    return (
      <section className="mx-auto max-w-2xl py-8 sm:py-12">
        <div className="rounded-3xl border border-emerald-200 bg-white p-7 shadow-sm sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">
            Analysis complete
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-gray-950 sm:text-4xl">
            Nothing needs chasing right now
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-gray-700">
            Yuohme analysed {data.queue.mappedCustomerCount} customer
            {data.queue.mappedCustomerCount === 1 ? '' : 's'} and found no overdue receivables.
          </p>
          <div className="mt-5">
            <AnalysisStamp
              organisationName={organisationName}
              lastSyncedAt={lastSyncedAt}
              currencyCode={data.organisationBaseCurrency}
            />
          </div>
          <div className="mt-8">
            <WorkspaceLink tenantId={tenantId} label="Open Yuohme" />
          </div>
        </div>
      </section>
    )
  }

  if (outcome === 'no_actionable') {
    const suppression = data.queue.suppression
    const nextReturnDate = formatReturnDate(suppression?.nextReturnDate)

    return (
      <section className="mx-auto max-w-2xl py-8 sm:py-12">
        <div className="rounded-3xl border border-sky-200 bg-white p-7 shadow-sm sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">
            Analysis complete
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-gray-950 sm:text-4xl">
            No customer needs action right now
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-gray-700">
            {formatMoney(
              data.portfolio?.analysedOverdueBase ?? 0,
              data.organisationBaseCurrency
            )}{' '}
            is overdue across {overdueCustomerCount} customer
            {overdueCustomerCount === 1 ? '' : 's'}, but none is currently available in the chase
            queue.
          </p>
          <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-2xl bg-gray-50 px-4 py-3">
              <p className="text-2xl font-semibold text-gray-950">{data.queue.actionedTodayCount}</p>
              <p className="mt-1 text-gray-600">Actioned today</p>
            </div>
            <div className="rounded-2xl bg-gray-50 px-4 py-3">
              <p className="text-2xl font-semibold text-gray-950">
                {suppression?.postponedCustomerCount ?? 0}
              </p>
              <p className="mt-1 text-gray-600">Postponed</p>
            </div>
            <div className="rounded-2xl bg-gray-50 px-4 py-3">
              <p className="text-2xl font-semibold text-gray-950">
                {suppression?.promisedToPayCustomerCount ?? 0}
              </p>
              <p className="mt-1 text-gray-600">Payment promises</p>
            </div>
          </div>
          {nextReturnDate && (
            <p className="mt-4 text-sm text-gray-600">
              The next deferred customer returns to the queue on {nextReturnDate}.
            </p>
          )}
          <div className="mt-8">
            <WorkspaceLink tenantId={tenantId} label="Open Yuohme" />
          </div>
        </div>
      </section>
    )
  }

  const [first, ...comparison] = priorities
  const totalOverdue = data.portfolio?.analysedOverdueBase ?? 0
  const provisional = data.currencyHealth.status === 'degraded'

  return (
    <section className="mx-auto max-w-3xl py-8 sm:py-12">
      <div className="space-y-7">
        <header>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">
            Your first priorities are ready
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-gray-950 sm:text-5xl">
            {formatMoney(totalOverdue, data.organisationBaseCurrency)} overdue across{' '}
            {overdueCustomerCount} customer{overdueCustomerCount === 1 ? '' : 's'}
          </h1>
          <div className="mt-4">
            <AnalysisStamp
              organisationName={organisationName}
              lastSyncedAt={lastSyncedAt}
              currencyCode={data.organisationBaseCurrency}
            />
          </div>
          {provisional && (
            <p className="mt-2 text-sm text-gray-500">
              Portfolio figure includes only receivables that can be valued safely.
            </p>
          )}
        </header>

        <CurrencyNotice data={data} />

        <article className="overflow-hidden rounded-3xl border border-sky-200 bg-white shadow-sm">
          <div className="border-b border-sky-100 bg-sky-50 px-6 py-4 sm:px-8">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-800">
              Start here
            </p>
          </div>
          <div className="p-6 sm:p-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-3xl font-semibold tracking-tight text-gray-950">
                  {first.customer_name}
                </h2>
                <p className="mt-2 text-xl font-semibold text-gray-900">
                  {formatMoney(first.overdue_outstanding_base, data.organisationBaseCurrency)} overdue
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  {first.overdue_invoices_count} overdue invoice
                  {first.overdue_invoices_count === 1 ? '' : 's'}
                </p>
              </div>
              <span className="inline-flex w-fit rounded-full bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white">
                {first.recommended_action}
              </span>
            </div>

            <div className="mt-7 rounded-2xl bg-gray-50 p-5">
              <h3 className="text-sm font-semibold text-gray-900">Why Yuohme put this first</h3>
              <ul className="mt-3 space-y-3">
                {first.first_value_reasons.map((reason) => (
                  <li key={`${reason.kind}-${reason.text}`} className="flex gap-3 text-sm leading-relaxed text-gray-700">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-600" aria-hidden="true" />
                    <span>{reason.text}</span>
                  </li>
                ))}
              </ul>
            </div>

            {priorities.length === 1 && (
              <p className="mt-5 text-sm text-gray-600">
                This is the only customer currently available in your chase queue.
              </p>
            )}
          </div>
        </article>

        {comparison.length > 0 && (
          <section aria-labelledby="next-priorities-heading">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 id="next-priorities-heading" className="text-xl font-semibold text-gray-950">
                  Next in the ranking
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  Yuohme compared the current eligible queue, not just the largest balance.
                </p>
              </div>
              <p className="text-sm text-gray-500">
                Showing {priorities.length} of {data.queue.remainingCustomerCount}
              </p>
            </div>
            <div className={`mt-4 grid gap-3 ${comparison.length > 1 ? 'sm:grid-cols-2' : ''}`}>
              {comparison.map((row, index) => (
                <article key={row.customer_source_id} className="rounded-2xl border border-gray-200 bg-white p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                    Priority {index + 2}
                  </p>
                  <h3 className="mt-2 text-lg font-semibold text-gray-950">{row.customer_name}</h3>
                  <p className="mt-1 text-sm font-medium text-gray-800">
                    {formatMoney(row.overdue_outstanding_base, data.organisationBaseCurrency)} overdue
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-gray-600">
                    {row.first_value_reasons[0]?.text ?? 'Current accounting signals place this customer next.'}
                  </p>
                </article>
              ))}
            </div>
          </section>
        )}

        <div className="flex flex-col items-start gap-2 border-t border-gray-200 pt-6">
          <WorkspaceLink tenantId={tenantId} label="Open today’s queue" />
          <p className="text-sm text-gray-500">
            View every priority, record collection actions and adjust your own customer context.
          </p>
        </div>
      </div>
    </section>
  )
}
