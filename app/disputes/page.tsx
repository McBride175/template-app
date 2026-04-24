import Link from 'next/link'
import { redirect } from 'next/navigation'
import Card from '@/app/components/Card'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

function parseTenantId(value: string | string[] | undefined) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export default async function DisputesPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const resolvedSearchParams = (await searchParams) ?? {}
  const tenantId = parseTenantId(resolvedSearchParams.tenantId)

  if (!user) {
    const next = tenantId
      ? `/disputes?tenantId=${encodeURIComponent(tenantId)}`
      : '/disputes'
    redirect(`/login?next=${encodeURIComponent(next)}`)
  }

  const dashboardHref = tenantId
    ? `/dashboard?tenantId=${encodeURIComponent(tenantId)}`
    : '/dashboard'

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">Disputes</h1>
        <p className="mt-1 text-sm text-gray-600">
          Placeholder page for dispute workflows. More tools and views will be added here.
        </p>
      </header>

      <Card>
        <div className="space-y-3 text-sm text-gray-700">
          <p>No dispute modules are enabled yet.</p>
          <p>
            Use this page as the future home for disputed outcomes, dispute tracking, and
            resolution workflows.
          </p>
          <div>
            <Link
              href={dashboardHref}
              className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 font-medium text-gray-900 hover:bg-gray-50"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </Card>
    </div>
  )
}
