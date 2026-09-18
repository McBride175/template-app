'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  FOUNDER_CONTEXT_OPTIONS,
  type FounderContextLevel,
} from '@/lib/collections/founder-context'

interface FounderContextControlProps {
  customerName: string
  value: FounderContextLevel
  saving: boolean
  disabled?: boolean
  manageHref?: string
  onChange: (level: FounderContextLevel, persistentExclusionConfirmed: boolean) => void
}

function optionClasses(selected: boolean) {
  return selected
    ? 'border-gray-900 bg-gray-900 text-white shadow-sm'
    : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50'
}

export default function FounderContextControl({
  customerName,
  value,
  saving,
  disabled = false,
  manageHref,
  onChange,
}: FounderContextControlProps) {
  const [confirmingDoNotChase, setConfirmingDoNotChase] = useState(false)
  const selectedOption = FOUNDER_CONTEXT_OPTIONS.find((option) => option.value === value)

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">Know something Yuohme doesn&apos;t?</p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-gray-600">
            Yuohme ranked this customer from Xero. Optionally add durable context that the
            accounting data cannot show.
          </p>
        </div>
        {manageHref && (
          <Link
            href={manageHref}
            className="text-xs font-medium text-gray-600 underline decoration-gray-300 underline-offset-4 hover:text-gray-900"
          >
            Manage all customer context
          </Link>
        )}
      </div>

      <div
        className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"
        role="group"
        aria-label={`Customer context for ${customerName}`}
      >
        {FOUNDER_CONTEXT_OPTIONS.map((option) => {
          const selected = option.value === value

          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              disabled={disabled || saving}
              onClick={() => {
                if (option.value === value) return
                if (option.value === 'do_not_chase') {
                  setConfirmingDoNotChase(true)
                  return
                }
                setConfirmingDoNotChase(false)
                onChange(option.value, false)
              }}
              className={`inline-flex min-h-11 items-center justify-center rounded-md border px-2 py-2 text-center text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${optionClasses(selected)}`}
            >
              {option.label}
              {selected && <span className="sr-only"> (selected)</span>}
            </button>
          )
        })}
      </div>

      <p className="mt-2 min-h-5 text-xs leading-relaxed text-gray-600">
        {selectedOption?.description}
        {value === 'do_not_chase'
          ? ' Use Postpone or a payment promise when the timing is only temporary.'
          : ''}
      </p>

      {confirmingDoNotChase && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <p>
            Do not chase removes {customerName} from the chase queue until you change this setting.
            For a temporary delay, use Postpone or record a payment promise instead.
          </p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmingDoNotChase(false)}
              disabled={saving}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmingDoNotChase(false)
                onChange('do_not_chase', true)
              }}
              disabled={saving}
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-amber-900 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-60"
            >
              Confirm Do not chase
            </button>
          </div>
        </div>
      )}

      <p className="mt-1 min-h-5 text-xs text-gray-500" aria-live="polite">
        {saving ? 'Saving customer context…' : ''}
      </p>
    </div>
  )
}
