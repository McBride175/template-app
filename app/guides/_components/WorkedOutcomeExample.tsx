import Card from '@/app/components/Card'
import type { WorkedOutcomeExample as WorkedOutcomeExampleData } from '@/content/seo-pages'

interface WorkedOutcomeExampleProps {
  example: WorkedOutcomeExampleData
}

const exampleTextColors = {
  heading: { color: 'var(--gray-900)' },
  body: { color: 'var(--gray-700)' },
  muted: { color: 'var(--gray-600)' },
} as const

export default function WorkedOutcomeExample({
  example,
}: WorkedOutcomeExampleProps) {
  return (
    <Card className="mt-5 overflow-hidden rounded-xl p-0">
      <div className="border-b border-gray-200 bg-gray-50 p-5 sm:p-6">
        <p
          className="text-xs font-semibold uppercase tracking-wide text-gray-500"
          style={exampleTextColors.muted}
        >
          Business context
        </p>
        <p
          className="mt-2 leading-7 text-gray-700"
          style={exampleTextColors.body}
        >
          {example.businessContext}
        </p>
      </div>

      <dl className="grid gap-px bg-gray-200 sm:grid-cols-2">
        <div className="bg-white p-5 sm:p-6">
          <dt className="text-sm font-semibold text-gray-900">Starting position</dt>
          <dd className="mt-2 text-sm leading-6 text-gray-700">
            {example.startingPosition}
          </dd>
        </div>
        <div className="bg-white p-5 sm:p-6">
          <dt className="text-sm font-semibold text-gray-900">Main constraint</dt>
          <dd className="mt-2 text-sm leading-6 text-gray-700">
            {example.primaryConstraint}
          </dd>
        </div>
      </dl>

      <div className="border-t border-gray-200 p-5 sm:p-6">
        <h3
          className="text-sm font-semibold text-gray-900"
          style={exampleTextColors.heading}
        >
          Changes made
        </h3>
        <ol className="mt-4 space-y-3">
          {example.changesMade.map((change, index) => (
            <li key={change} className="flex gap-3 text-sm leading-6 text-gray-700">
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white"
              >
                {index + 1}
              </span>
              <span>{change}</span>
            </li>
          ))}
        </ol>
      </div>

      <dl className="grid gap-px border-t border-gray-200 bg-gray-200 sm:grid-cols-2">
        <div className="bg-sky-50 p-5 sm:p-6">
          <dt className="text-sm font-semibold text-gray-900">Result</dt>
          <dd className="mt-2 text-sm leading-6 text-gray-700">{example.result}</dd>
        </div>
        <div className="bg-white p-5 sm:p-6">
          <dt className="text-sm font-semibold text-gray-900">Takeaway</dt>
          <dd className="mt-2 text-sm leading-6 text-gray-700">{example.lesson}</dd>
        </div>
      </dl>
    </Card>
  )
}
