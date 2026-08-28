import type { PrioritisationSignal } from '@/content/seo-pages'

interface PrioritisationSignalsProps {
  signals: readonly PrioritisationSignal[]
  decisionRules: string[]
}

export default function PrioritisationSignals({
  signals,
  decisionRules,
}: PrioritisationSignalsProps) {
  return (
    <div className="mt-5 space-y-5">
      <ul className="grid gap-3 sm:grid-cols-2">
        {signals.map((signal) => (
          <li key={signal.key} className="rounded-xl border border-gray-200 bg-white p-4">
            <h3
              className="text-sm font-semibold text-gray-900"
              style={{ color: 'var(--gray-900)', fontSize: '0.875rem', lineHeight: '1.5rem' }}
            >
              {signal.label}
            </h3>
            <p
              className="mt-1 text-sm leading-6 text-gray-600"
              style={{ color: 'var(--gray-600)' }}
            >
              {signal.explanation}
            </p>
          </li>
        ))}
      </ul>

      <div className="rounded-xl bg-gray-100 p-5">
        <p
          className="text-sm font-semibold text-gray-900"
          style={{ color: 'var(--gray-900)' }}
        >
          Read the signals together
        </p>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-gray-700">
          {decisionRules.map((rule) => (
            <li key={rule} className="flex gap-3">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-700" />
              <span>{rule}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
