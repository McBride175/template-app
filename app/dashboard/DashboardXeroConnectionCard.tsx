import Card from '@/app/components/Card'
import { buildXeroConnectPath } from '@/lib/xero/oauth-return'

interface DashboardXeroConnectionCardProps {
  state: 'disconnected' | 'reconnect_required'
  tenantId?: string | null
}

export default function DashboardXeroConnectionCard({
  state,
  tenantId = null,
}: DashboardXeroConnectionCardProps) {
  const reconnecting = state === 'reconnect_required'
  const returnTo = tenantId
    ? `/dashboard?tenantId=${encodeURIComponent(tenantId)}`
    : '/dashboard'

  return (
    <Card>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            {reconnecting
              ? 'Reconnect Xero to refresh your priorities'
              : 'Connect Xero to see who to chase first'}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-gray-600">
            {reconnecting
              ? 'Your previously imported information has not been removed, but it may be out of date until the secure connection is restored.'
              : 'We use secure, read-only access to your Xero accounting data to prioritise customers and explain who needs attention.'}
          </p>
        </div>
        <a
          href={buildXeroConnectPath(returnTo)}
          className="inline-flex items-center justify-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 active:bg-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
        >
          {reconnecting ? 'Reconnect Xero' : 'Connect Xero'}
        </a>
      </div>
    </Card>
  )
}
