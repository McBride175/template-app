/** Opaque source IDs only: bounded, no controls; never an index, money or redirect URL. */
export function queueCustomerId(value: string | null | undefined) {
  return value && value.length <= 200 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value) ? value : null
}
export function prioritiesReturnHref(tenantId: string | null, customerSourceId?: string | null) {
  const params = new URLSearchParams()
  if (tenantId) params.set('tenantId', tenantId)
  const id = queueCustomerId(customerSourceId)
  if (id) params.set('queueCustomerSourceId', id)
  return `/dashboard${params.size ? `?${params}` : ''}#collection-actions`
}
export function priorityInvoicesHref(tenantId: string | null, customerSourceId: string) {
  const params = new URLSearchParams({ customerSourceId, queueCustomerSourceId: customerSourceId })
  if (tenantId) params.set('tenantId', tenantId)
  return `/customers?${params}#customer-invoices`
}

export function withQueueOrigin(href: string, customerSourceId?: string | null) {
  const id = queueCustomerId(customerSourceId)
  if (!id) return href
  const url = new URL(href, 'http://navigation.local')
  url.searchParams.set('queueCustomerSourceId', id)
  return `${url.pathname}${url.search}${url.hash}`
}
