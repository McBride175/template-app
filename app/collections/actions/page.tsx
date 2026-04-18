import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

function parseTenantId(value: string | string[] | undefined) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export default async function CollectionActionsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const resolvedSearchParams = (await searchParams) ?? {}
  const tenantId = parseTenantId(resolvedSearchParams.tenantId)
  if (tenantId) {
    redirect(`/dashboard?tenantId=${encodeURIComponent(tenantId)}#collection-actions`)
  }

  redirect('/dashboard#collection-actions')
}
