import Card from '@/app/components/Card'
import type { WorkedProcessExample as WorkedProcessExampleData } from '@/content/seo-pages'

interface WorkedProcessExampleProps {
  example: WorkedProcessExampleData
}

const exampleTextColors = {
  heading: { color: 'var(--gray-900)' },
  body: { color: 'var(--gray-700)' },
  muted: { color: 'var(--gray-600)' },
} as const

export default function WorkedProcessExample({
  example,
}: WorkedProcessExampleProps) {
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

      <div className="border-b border-gray-200 p-5 sm:p-6">
        <h3
          className="text-sm font-semibold text-gray-900"
          style={exampleTextColors.heading}
        >
          Previous approach
        </h3>
        <p
          className="mt-2 text-sm leading-6 text-gray-700"
          style={exampleTextColors.body}
        >
          {example.previousApproach}
        </p>
      </div>

      <div className="border-b border-gray-200 p-5 sm:p-6">
        <h3
          className="text-sm font-semibold text-gray-900"
          style={exampleTextColors.heading}
        >
          Process introduced
        </h3>
        <ol className="mt-4 space-y-3">
          {example.processIntroduced.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm leading-6 text-gray-700">
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white"
              >
                {index + 1}
              </span>
              <span style={exampleTextColors.body}>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      <dl className="grid gap-px bg-gray-200 sm:grid-cols-2">
        <div className="bg-white p-5 sm:p-6">
          <dt
            className="text-sm font-semibold text-gray-900"
            style={exampleTextColors.heading}
          >
            How it is run
          </dt>
          <dd
            className="mt-2 text-sm leading-6 text-gray-700"
            style={exampleTextColors.body}
          >
            {example.operatingRhythm}
          </dd>
        </div>
        <div className="bg-sky-50 p-5 sm:p-6">
          <dt
            className="text-sm font-semibold text-gray-900"
            style={exampleTextColors.heading}
          >
            Operational result
          </dt>
          <dd
            className="mt-2 text-sm leading-6 text-gray-700"
            style={exampleTextColors.body}
          >
            {example.result}
          </dd>
        </div>
      </dl>

      <div className="border-t border-gray-200 p-5 sm:p-6">
        <p
          className="text-xs font-semibold uppercase tracking-wide text-gray-500"
          style={exampleTextColors.muted}
        >
          Takeaway
        </p>
        <p
          className="mt-2 text-sm leading-6 text-gray-700"
          style={exampleTextColors.body}
        >
          {example.lesson}
        </p>
      </div>
    </Card>
  )
}
