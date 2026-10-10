import type { PromiseView } from './promise-presentation'
import { validPromiseDate } from './promise-evidence'

export type PromiseWorklistStatus = 'active' | 'history' | 'kept' | 'missed' | 'unclear' | 'cancelled'
export type PromiseDateCategory = 'passed' | 'today' | 'upcoming' | 'unavailable'
export interface PromiseWorklistQuery { status: PromiseWorklistStatus; date: 'all' | 'passed' | 'today' | 'upcoming'; q: string; page: number; pageSize: number }
export class PromiseWorklistInputError extends Error {}
const statuses = ['active', 'history', 'kept', 'missed', 'unclear', 'cancelled'] as const
export function parsePromiseWorklist(params: URLSearchParams): PromiseWorklistQuery {
  const status = params.get('status') ?? 'active', date = params.get('date') ?? 'all', q = (params.get('q') ?? '').trim()
  const integer = (name: string, fallback: number, max: number) => {
    const value = params.get(name) ?? String(fallback)
    if (!/^[1-9]\d*$/.test(value) || Number(value) > max) throw new PromiseWorklistInputError('Invalid pagination.')
    return Number(value)
  }
  if (!statuses.includes(status as PromiseWorklistStatus) || !['all','passed','today','upcoming'].includes(date)
    || q.length > 100 || /[\u0000-\u001f\u007f]/.test(q)) throw new PromiseWorklistInputError('Invalid filters.')
  return { status: status as PromiseWorklistStatus, date: status === 'active' ? date as PromiseWorklistQuery['date'] : 'all', q,
    page: integer('page', 1, 10000), pageSize: integer('pageSize', 25, 50) }
}
export function promiseWorklistUrl(query: PromiseWorklistQuery, tenantId?: string | null) {
  const params = new URLSearchParams({ status: query.status, date: query.date, page: String(query.page), pageSize: String(query.pageSize) })
  if (tenantId) params.set('tenantId', tenantId)
  if (query.q) params.set('q', query.q)
  return `/promises?${params}`
}
/** Server supplied date only. An elapsed date does not change lifecycle status. */
export function promiseDateCategory(date: string | null | undefined, organisationDate: string | null): PromiseDateCategory {
  if (!validPromiseDate(date) || !validPromiseDate(organisationDate)) return 'unavailable'
  return date! < organisationDate! ? 'passed' : date === organisationDate ? 'today' : 'upcoming'
}
export const promiseDateLabels = { passed: 'Date passed · Still active', today: 'Due today', upcoming: 'Upcoming', unavailable: 'Date context unavailable' } as const
export interface PromiseWorklistRow extends PromiseView {
  customerSourceId: string; invoiceSourceId: string; customerName: string | null; invoiceReference: string;
  currencyCode: string; dateCategory: PromiseDateCategory; currentInvoiceStatus: string | null;
  currentOutstandingNative: string | null; contextUnavailable: boolean; financialUnavailable: boolean
}
export interface PromiseWorklistResponse {
  ok: true; tenantId: string; organisationDate: string | null; timezone: string | null;
  query: PromiseWorklistQuery; rows: PromiseWorklistRow[]; total: number; pageCount: number
}
export function promiseCustomerHref(row: PromiseWorklistRow, tenantId: string, returnHref: string) {
  const params = new URLSearchParams({ tenantId, customerSourceId: row.customerSourceId, promisesReturn: returnHref })
  return `/customers?${params}#invoice-${encodeURIComponent(row.invoiceSourceId)}`
}
/** Only this workspace's normalized filters can be carried back; never an arbitrary redirect. */
export function promisesReturnHref(value: string | null | undefined, tenantId: string | null) {
  if (!value || value.length > 1500 || !tenantId) return null
  try {
    const url = new URL(value, 'http://navigation.local')
    if (url.origin !== 'http://navigation.local' || url.pathname !== '/promises' || url.hash
      || url.searchParams.get('tenantId') !== tenantId) return null
    return promiseWorklistUrl(parsePromiseWorklist(url.searchParams), tenantId)
  } catch { return null }
}

export function withPromisesOrigin(href: string, origin: string | null, tenantId: string | null) {
  const validated = promisesReturnHref(origin, tenantId)
  if (!validated) return href
  const url = new URL(href, 'http://navigation.local')
  url.searchParams.set('promisesReturn', validated)
  return `${url.pathname}${url.search}${url.hash}`
}
