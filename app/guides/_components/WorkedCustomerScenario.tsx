import Card from '@/app/components/Card'
import type { WorkedCustomerScenario as WorkedCustomerScenarioContent } from '@/content/seo-pages'

interface WorkedCustomerScenarioProps {
  scenario: WorkedCustomerScenarioContent
}

export default function WorkedCustomerScenario({
  scenario,
}: WorkedCustomerScenarioProps) {
  return (
    <Card className="mt-5 rounded-xl p-6 sm:p-8">
      <h3
        className="text-lg font-semibold text-gray-900"
        style={{ color: 'var(--gray-900)' }}
      >
        {scenario.customer}
      </h3>

      <dl className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Normal payment behaviour
          </dt>
          <dd className="mt-2 text-sm leading-6 text-gray-700">
            {scenario.baseline}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Current situation
          </dt>
          <dd className="mt-2 text-sm leading-6 text-gray-700">
            {scenario.currentSituation}
          </dd>
        </div>
        {scenario.riskContext && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Customer context
            </dt>
            <dd className="mt-2 text-sm leading-6 text-gray-700">
              {scenario.riskContext}
            </dd>
          </div>
        )}
        <div className="border-t border-gray-200 pt-5 sm:col-span-2">
          <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            What the evidence suggests
          </dt>
          <dd className="mt-2 leading-7 text-gray-700">
            {scenario.interpretation}
          </dd>
        </div>
        <div className="rounded-xl bg-gray-100 p-5 sm:col-span-2">
          <dt className="text-sm font-semibold text-gray-900">Recommended next action</dt>
          <dd className="mt-2 text-sm leading-6 text-gray-700">
            {scenario.nextAction}
          </dd>
        </div>
      </dl>
    </Card>
  )
}
