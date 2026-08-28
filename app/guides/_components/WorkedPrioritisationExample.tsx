import Card from '@/app/components/Card'
import type { CustomerRisk, WorkedExample } from '@/content/seo-pages'

interface WorkedPrioritisationExampleProps {
  example: WorkedExample
}

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
})

const riskLabels: Record<CustomerRisk, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

const riskClassNames: Record<CustomerRisk, string> = {
  low: 'bg-green-100 text-green-800',
  medium: 'bg-amber-100 text-amber-800',
  high: 'bg-red-100 text-red-800',
}

export default function WorkedPrioritisationExample({
  example,
}: WorkedPrioritisationExampleProps) {
  const rankedCustomers = [...example.customers].sort((a, b) => a.rank - b.rank)

  return (
    <div className="mt-4">
      <p className="leading-7 text-gray-700" style={{ color: 'var(--gray-700)' }}>
        {example.introduction}
      </p>

      <ol className="mt-5 grid gap-4 lg:grid-cols-3">
        {rankedCustomers.map((customer) => (
          <li key={customer.name}>
            <Card className="h-full rounded-xl p-5">
              <div className="flex items-start justify-between gap-3">
                <h3
                  className="text-base font-semibold leading-6 text-gray-900"
                  style={{ color: 'var(--gray-900)', fontSize: '1rem', lineHeight: '1.5rem' }}
                >
                  {customer.name}
                </h3>
                <span className="shrink-0 rounded-full bg-gray-900 px-2.5 py-1 text-xs font-semibold text-white">
                  Rank {customer.rank}
                </span>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-4 text-sm">
                <div>
                  <dt className="text-xs text-gray-500">Outstanding</dt>
                  <dd className="mt-1 font-semibold text-gray-900">
                    {currencyFormatter.format(customer.valueOutstanding)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Average days late</dt>
                  <dd className="mt-1 font-semibold text-gray-900">
                    {customer.averageDaysLate} days
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Since last payment</dt>
                  <dd className="mt-1 font-semibold text-gray-900">
                    {customer.daysSinceLastPayment} days
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Founder risk</dt>
                  <dd className="mt-1">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${riskClassNames[customer.founderRisk]}`}
                    >
                      {riskLabels[customer.founderRisk]}
                    </span>
                  </dd>
                </div>
              </dl>

              {customer.founderRiskReason && (
                <p
                  className="mt-4 border-t border-gray-200 pt-3 text-xs leading-5 text-gray-600"
                  style={{ color: 'var(--gray-600)' }}
                >
                  <span className="font-semibold text-gray-700">Founder context:</span>{' '}
                  {customer.founderRiskReason}
                </p>
              )}

              <p
                className="mt-3 text-sm leading-6 text-gray-700"
                style={{ color: 'var(--gray-700)' }}
              >
                <span className="font-semibold text-gray-900">Why rank {customer.rank}:</span>{' '}
                {customer.rankReason}
              </p>
            </Card>
          </li>
        ))}
      </ol>

      <p className="mt-5 leading-7 text-gray-700" style={{ color: 'var(--gray-700)' }}>
        {example.conclusion}
      </p>
    </div>
  )
}
