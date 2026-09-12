'use client'

import { useRouter } from 'next/navigation'
import Button from '@/app/components/Button'
import Card from '@/app/components/Card'

export default function MultiCurrencyPlanGate() {
  const router = useRouter()

  return (
    <Card>
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Multi-currency collections require Pro
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Your current receivables include more than one invoiced currency. Upgrade to Pro to
            continue using collections across multiple currencies.
          </p>
        </div>
        <Button
          onClick={() => router.push('/pricing?reason=multi-currency')}
          variant="primary"
          size="md"
        >
          Upgrade to Pro
        </Button>
      </div>
    </Card>
  )
}
