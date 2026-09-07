'use client'

import { useMemo, useState } from 'react'
import {
  PLAYBOOK_CONCERNS,
  PLAYBOOK_CUSTOMERS,
  explainTopPlaybookCustomer,
  getInitialPlaybookConcerns,
  rankPlaybookCustomers,
  type PlaybookConcern,
} from '@/lib/credit-control-playbook'

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
})

const concernLabels: Record<PlaybookConcern, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

const concernClasses: Record<PlaybookConcern, string> = {
  low: 'border-emerald-700 bg-emerald-50 text-emerald-900',
  medium: 'border-amber-700 bg-amber-50 text-amber-950',
  high: 'border-rose-700 bg-rose-50 text-rose-950',
}

export default function PrioritisationPlaybook() {
  const [concerns, setConcerns] = useState(getInitialPlaybookConcerns)
  const rankedCustomers = useMemo(() => rankPlaybookCustomers(concerns), [concerns])
  const topCustomer = rankedCustomers[0]
  const topExplanation = explainTopPlaybookCustomer(topCustomer)
  const rankByCustomerId = Object.fromEntries(
    rankedCustomers.map((customer) => [customer.id, customer.rank])
  )

  function updateConcern(customerId: string, concern: PlaybookConcern) {
    setConcerns((current) => ({ ...current, [customerId]: concern }))
  }

  return (
    <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(19rem,0.92fr)] lg:items-start">
      <div className="space-y-4">
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-800">
            A useful experiment
          </p>
          <p className="mt-2 text-sm leading-6 text-gray-700">
            Raise <strong>Calder Kitchens</strong> to High concern. Imagine its owner has
            privately mentioned cash-flow difficulty, something the accounting data cannot show.
            It moves from sixth to fourth: materially closer to the top, but it does not
            automatically become first.
          </p>
        </div>

        <div className="flex items-center justify-between gap-4">
          <h3 className="text-xl">Add what you know</h3>
          <button
            type="button"
            onClick={() => setConcerns(getInitialPlaybookConcerns())}
            className="min-h-11 rounded-xl px-3 text-sm font-semibold text-sky-800 underline decoration-sky-300 underline-offset-4 hover:text-sky-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:ring-offset-2"
          >
            Reset example
          </button>
        </div>

        <div className="space-y-4">
          {PLAYBOOK_CUSTOMERS.map((customer) => {
            const selectedConcern = concerns[customer.id]

            return (
              <fieldset
                key={customer.id}
                className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
              >
                <legend className="sr-only">Your concern about {customer.name}</legend>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-900">{customer.name}</p>
                    <p className="mt-1 text-sm text-gray-600">
                      {currencyFormatter.format(customer.outstanding)} · {customer.daysOverdue}{' '}
                      days overdue · normally {customer.normalDaysLate === 0 ? 'on time' : `${customer.normalDaysLate} days late`}
                    </p>
                  </div>
                  <span className="rounded-full bg-gray-900 px-2.5 py-1 text-xs font-semibold text-white">
                    Now #{rankByCustomerId[customer.id]}
                  </span>
                </div>

                <p className="mt-3 text-sm leading-6 text-gray-600">
                  {customer.accountingContext}
                </p>

                <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Your concern about this customer
                </p>
                <p className="mt-1 text-xs leading-5 text-gray-500">
                  Medium is neutral. Low and High use the same Safe and Priority adjustments as
                  the main engine.
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {PLAYBOOK_CONCERNS.map((concern) => {
                    const selected = selectedConcern === concern

                    return (
                      <button
                        key={concern}
                        type="button"
                        aria-pressed={selected}
                        aria-label={`Set concern about ${customer.name} to ${concernLabels[concern]}`}
                        onClick={() => updateConcern(customer.id, concern)}
                        className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:ring-offset-2 ${
                          selected
                            ? concernClasses[concern]
                            : 'border-gray-300 bg-white text-gray-700 hover:border-sky-300 hover:bg-sky-50'
                        }`}
                      >
                        {concernLabels[concern]}
                      </button>
                    )
                  })}
                </div>

                {selectedConcern === 'high' && (
                  <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-950">
                    <span className="font-semibold">Example founder context:</span>{' '}
                    {customer.highConcernContext}
                  </p>
                )}
              </fieldset>
            )
          })}
        </div>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-24" aria-label="Current chase priority">
        <div
          className="rounded-2xl border border-sky-300 bg-sky-900 p-6 text-white shadow-sm"
          aria-live="polite"
          aria-atomic="true"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-200">
            Current first priority
          </p>
          <h3 className="mt-3 text-xl text-white">{topExplanation.heading}</h3>
          <p className="mt-3 text-sm leading-6 text-sky-50">{topExplanation.body}</p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg">Current chase order</h3>
            <span className="text-xs font-medium text-gray-500">Updates live</span>
          </div>
          <ol className="mt-4 space-y-3">
            {rankedCustomers.map((customer) => (
              <li
                key={customer.id}
                className={`rounded-xl border p-4 ${
                  customer.rank === 1
                    ? 'border-sky-300 bg-sky-50'
                    : 'border-gray-200 bg-white'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      customer.rank === 1
                        ? 'bg-sky-900 text-white'
                        : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {customer.rank}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="font-semibold text-gray-900">{customer.name}</p>
                      <p className="text-sm font-semibold text-gray-700">
                        {currencyFormatter.format(customer.outstanding)}
                      </p>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-gray-600">
                      {customer.shortReason}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <p className="px-1 text-xs leading-5 text-gray-500">
          No customer data is entered or sent anywhere. This example runs locally in your browser
          using six fictional businesses.
        </p>
      </aside>
    </div>
  )
}
