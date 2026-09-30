export function customerHistoryUrl(customerSourceId: string, tenantId: string) {
  return `/customers/${encodeURIComponent(customerSourceId)}/history?tenantId=${encodeURIComponent(tenantId)}`
}
