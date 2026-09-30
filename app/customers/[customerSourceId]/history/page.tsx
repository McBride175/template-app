import { notFound, redirect } from 'next/navigation'
import { CustomerHistoryOperationError, readCustomerHistory } from '@/lib/collections/customer-history-server'
import CustomerHistoryClient from '@/app/customers/[customerSourceId]/history/CustomerHistoryClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Customer history | Yuohme', robots: { index: false, follow: false } }

export default async function CustomerHistoryPage({ params, searchParams }: {
  params: Promise<{ customerSourceId: string }>
  searchParams: Promise<{ tenantId?: string | string[] }>
}) {
  const { customerSourceId } = await params
  const query = await searchParams
  const tenantId = typeof query.tenantId === 'string' ? query.tenantId : null
  if (!tenantId) notFound()
  let data: Awaited<ReturnType<typeof readCustomerHistory>>
  try {
    data = await readCustomerHistory({ tenantId, sourceSystem: 'xero', customerSourceId })
  } catch (error) {
    if (error instanceof CustomerHistoryOperationError) {
      if (error.code === 'unauthorized') {
        const next = `/customers/${encodeURIComponent(customerSourceId)}/history?tenantId=${encodeURIComponent(tenantId)}`
        redirect(`/login?next=${encodeURIComponent(next)}`)
      }
      if (error.code === 'forbidden' || error.code === 'not_found' || error.code === 'invalid_input') notFound()
    }
    throw error
  }
  return <CustomerHistoryClient tenantId={tenantId} customerSourceId={customerSourceId}
    customerName={data.customer.name} initialEvents={data.events} initialCursor={data.nextCursor} />
}
