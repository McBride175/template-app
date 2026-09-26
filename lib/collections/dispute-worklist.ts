import { compareDecimalValues } from '@/lib/money/currency'
import type { InvoiceDisputeView } from '@/lib/collections/invoice-dispute-view'

export type DisputeWorklistStatus = 'active' | 'needs_review' | 'resolved' | 'settled' | 'unavailable' | 'all'
export type DisputeWorklistSort = 'amount_desc' | 'amount_asc' | 'oldest' | 'newest' | 'customer'

export interface DisputeWorklistQuery {
  status: DisputeWorklistStatus
  customer: string
  q: string
  sort: DisputeWorklistSort
  page: number
  pageSize: number
}

/** Explicit read DTO. Base amounts are nullable validated valuations, never native subtotals. */
export interface DisputeWorklistRow extends InvoiceDisputeView {
  disputeId: string
  revision: string
  sourceSystem: string
  customerSourceId: string | null
  customerName: string | null
  contextFromPreviousSnapshot: boolean
  overdueDays: number | null
  createdAt: string
  resolvedAt: string | null
  isOperationallySettled: boolean
  grossOutstandingBase: string | null
  effectiveDisputedBase: string | null
  collectibleBase: string | null
  customerHref: string | null
}

export interface DisputeWorklistResponse {
  ok: true
  tenantId: string
  organisationBaseCurrency: string | null
  rows: DisputeWorklistRow[]
  customers: Array<{ sourceId: string; name: string }>
  query: DisputeWorklistQuery
  total: number
  pageCount: number
}

export function parseDisputeWorklistQuery(params: Pick<URLSearchParams, 'get'>): DisputeWorklistQuery {
  const status = params.get('status')
  const sort = params.get('sort')
  const boundedInteger = (value: string | null, fallback: number, max: number) =>
    value && /^\d+$/.test(value) ? Math.max(1, Math.min(max, Number(value))) : fallback
  return {
    status: ['active', 'needs_review', 'resolved', 'settled', 'unavailable', 'all'].includes(status ?? '')
      ? status as DisputeWorklistStatus : 'active',
    customer: (params.get('customer') ?? '').trim().slice(0, 200),
    q: (params.get('q') ?? '').trim().slice(0, 200),
    sort: ['amount_desc', 'amount_asc', 'oldest', 'newest', 'customer'].includes(sort ?? '')
      ? sort as DisputeWorklistSort : 'amount_desc',
    page: boundedInteger(params.get('page'), 1, 1000000),
    pageSize: boundedInteger(params.get('pageSize'), 25, 100),
  }
}

export function disputeWorklistUrl(query: DisputeWorklistQuery, tenantId: string | null) {
  const params = new URLSearchParams({ status: query.status, sort: query.sort,
    page: String(query.page), pageSize: String(query.pageSize) })
  if (tenantId) params.set('tenantId', tenantId)
  if (query.customer) params.set('customer', query.customer)
  if (query.q) params.set('q', query.q)
  return `/disputes?${params}`
}

/** UTC invoice ageing, matching collections: due date is never reset by disputes. */
export function disputeInvoiceOverdueDays(dueDate: string | null, today: string) {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null
  const due = Date.parse(`${dueDate}T00:00:00Z`)
  return Number.isFinite(due) ? Math.max(0, Math.floor((Date.parse(`${today}T00:00:00Z`) - due) / 86400000)) : null
}

export function selectDisputeWorklistRows(rows: DisputeWorklistRow[], query: DisputeWorklistQuery) {
  const search = query.q.toLocaleLowerCase()
  const selected = rows.filter((row) => {
    const active = row.isActive && row.invoiceState === 'open'
    const matchesStatus = query.status === 'all' ||
      (query.status === 'active' && active) ||
      (query.status === 'needs_review' && active && row.needsReview) ||
      (query.status === 'resolved' && row.isResolved) ||
      (query.status === 'settled' && row.isActive && row.isOperationallySettled) ||
      (query.status === 'unavailable' && ['unavailable', 'invalid'].includes(row.invoiceState))
    return matchesStatus && (!query.customer || row.customerSourceId === query.customer) &&
      (!search || [row.customerName, row.invoiceNumber, row.reference].some((value) =>
        value?.toLocaleLowerCase().includes(search)))
  })
  selected.sort((a, b) => {
    let comparison = 0
    if (query.sort === 'amount_desc' || query.sort === 'amount_asc') {
      if (a.effectiveDisputedBase === null) return b.effectiveDisputedBase === null
        ? a.disputeId.localeCompare(b.disputeId) : 1
      if (b.effectiveDisputedBase === null) return -1
      comparison = (compareDecimalValues(a.effectiveDisputedBase, b.effectiveDisputedBase) ?? 0) *
        (query.sort === 'amount_desc' ? -1 : 1)
    } else if (query.sort === 'oldest') {
      if (a.overdueDays === null) return b.overdueDays === null ? a.disputeId.localeCompare(b.disputeId) : 1
      if (b.overdueDays === null) return -1
      comparison = b.overdueDays - a.overdueDays || (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
    } else if (query.sort === 'newest') comparison = b.createdAt.localeCompare(a.createdAt)
    else comparison = (a.customerName ?? '').localeCompare(b.customerName ?? '')
    return comparison || a.disputeId.localeCompare(b.disputeId)
  })
  const pageCount = Math.max(1, Math.ceil(selected.length / query.pageSize))
  const page = Math.min(query.page, pageCount)
  return { rows: selected.slice((page - 1) * query.pageSize, page * query.pageSize),
    total: selected.length, pageCount, query: { ...query, page } }
}
