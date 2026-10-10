import 'server-only'
import { authenticateDisputeTenant } from '@/lib/collections/invoice-disputes-server'
import { applyXeroAuthoritativeSnapshot } from '@/lib/xero/authoritative-snapshot'
import { assertInvoicePromiseSnapshotCurrent } from '@/lib/collections/invoice-promises-loading'
import { normalizeXeroOrganisationTimezone } from '@/lib/xero/organisation-timezone'
import { normalizeCurrencyCode, normalizeDecimalValue, compareDecimalValues } from '@/lib/money/currency'
import { validPromiseDate } from './promise-evidence'
import { promiseDateCategory, PromiseWorklistInputError, type PromiseWorklistQuery, type PromiseWorklistResponse, type PromiseWorklistRow } from './promise-worklist'

type Context = Awaited<ReturnType<typeof authenticateDisputeTenant>>
type Row = Record<string, unknown>
const COLUMNS = 'id,user_id,tenant_id,source_system,customer_source_id,invoice_source_id,currency_code,promised_amount_native::text,qualifying_paid_amount_native::text,promised_date,status,note,created_at,resolved_at'
const terminal = ['kept','missed','unclear','cancelled']
const identity = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 500 && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v)
const quoted = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
// No floating-point parsing. Missing/invalid financial values remain unavailable.
function money(v: unknown, positive = false) {
  if (typeof v !== 'string') return null
  const normalized = normalizeDecimalValue(v), comparison = compareDecimalValues(v, '0')
  return normalized !== null && comparison !== null && (positive ? comparison > 0 : comparison >= 0) ? normalized : null
}
function scoped(context: Context, table: string, columns: string) {
  return applyXeroAuthoritativeSnapshot(context.admin.from(table).select(columns)
    .eq('user_id', context.userId).eq('tenant_id', context.tenantId).eq('source_system', 'xero'), context.snapshot)
}
export function organisationDateAt(timezone: string | null, now: Date): string | null {
  if (!timezone || Number.isNaN(now.getTime())) return null
  try {
    const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
    const value = `${parts.find(p => p.type === 'year')?.value}-${parts.find(p => p.type === 'month')?.value}-${parts.find(p => p.type === 'day')?.value}`
    return validPromiseDate(value) ? value : null
  } catch { return null }
}
async function searchScope(context: Context, q: string) {
  if (!q) return null
  // Literal substring search; refuse broad matches rather than truncate silently.
  const pattern = `%${q.replace(/[\\%_*]/g, '\\$&')}%`
  const responses = await Promise.all([
    scoped(context, 'canonical_customers', 'source_id').ilike('name', pattern).order('source_id').limit(201),
    scoped(context, 'canonical_invoices', 'source_id').ilike('invoice_number', pattern).order('source_id').limit(201),
  ])
  if (responses.some(r => r.error)) throw new Error('Promise search unavailable')
  if (responses.some(r => (r.data?.length ?? 0) > 200)) throw new PromiseWorklistInputError('Too many customer or invoice matches. Use a more specific search.')
  const groups = responses.map(r => [...new Set(((r.data ?? []) as unknown as Row[]).map(row => row.source_id).filter(identity))])
  return [`customer_source_id.eq.${quoted(q)}`, `invoice_source_id.eq.${quoted(q)}`,
    ...groups.flatMap((ids, index) => ids.length ? [`${index === 0 ? 'customer_source_id' : 'invoice_source_id'}.in.(${ids.map(quoted).join(',')})`] : [])].join(',')
}
function uniqueIdentities(rows: Row[], context: Context) {
  const map = new Map<string, Row | null>()
  for (const row of rows) {
    if (row.user_id !== context.userId || row.tenant_id !== context.tenantId || row.source_system !== 'xero' || !identity(row.source_id)) throw new Error('Promise identity scope mismatch')
    map.set(row.source_id, map.has(row.source_id) ? null : row)
  }
  return map
}
export function projectPromiseWorklist(rows: Row[], customers: Row[], invoices: Row[], context: Pick<Context, 'userId' | 'tenantId'>, date: string | null): PromiseWorklistRow[] {
  const scope = context as Context, customerMap = uniqueIdentities(customers, scope), invoiceMap = uniqueIdentities(invoices, scope), seen = new Set<string>()
  return rows.map(row => {
    if (row.user_id !== context.userId || row.tenant_id !== context.tenantId || row.source_system !== 'xero'
      || !identity(row.id) || !identity(row.invoice_source_id) || !identity(row.customer_source_id)
      || !['active', ...terminal].includes(String(row.status)) || seen.has(row.id)) throw new Error('Promise record unavailable')
    seen.add(row.id)
    const customer = customerMap.get(row.customer_source_id), candidate = invoiceMap.get(row.invoice_source_id)
    const invoice = candidate?.customer_source_id === row.customer_source_id ? candidate : null
    const currency = normalizeCurrencyCode(row.currency_code), amount = money(row.promised_amount_native, true), paid = money(row.qualifying_paid_amount_native)
    const invoiceCurrency = normalizeCurrencyCode(invoice?.transaction_currency_code)
    const outstanding = invoice && currency && invoiceCurrency === currency ? money(invoice.amount_due_native) : null
    return { id: row.id, customerSourceId: row.customer_source_id, invoiceSourceId: row.invoice_source_id,
      customerName: typeof customer?.name === 'string' ? customer.name : null,
      invoiceReference: typeof invoice?.invoice_number === 'string' && invoice.invoice_number.trim() ? invoice.invoice_number : row.invoice_source_id,
      currencyCode: currency ?? '', status: row.status as PromiseWorklistRow['status'], promisedAmountNative: amount,
      qualifyingPaidAmountNative: paid, promisedDate: validPromiseDate(row.promised_date) ? row.promised_date : undefined,
      dateCategory: promiseDateCategory(typeof row.promised_date === 'string' ? row.promised_date : null, date),
      note: typeof row.note === 'string' ? row.note : null, createdAt: typeof row.created_at === 'string' ? row.created_at : undefined,
      resolvedAt: typeof row.resolved_at === 'string' && Number.isFinite(Date.parse(row.resolved_at)) ? row.resolved_at : null,
      currentInvoiceStatus: typeof invoice?.status === 'string' ? invoice.status : null, currentOutstandingNative: outstanding,
      contextUnavailable: !customer || !invoice, financialUnavailable: !currency || amount === null || paid === null || (Boolean(invoice) && outstanding === null) }
  })
}
export async function loadPromiseWorklist(params: { tenantId: string | null; query: PromiseWorklistQuery; now?: Date }): Promise<PromiseWorklistResponse> {
  if (params.tenantId !== null && (!identity(params.tenantId) || params.tenantId.length > 200)) throw new PromiseWorklistInputError('Invalid organisation identity.')
  const context = await authenticateDisputeTenant(params.tenantId)
  const org = await scoped(context, 'canonical_organisations', 'timezone_iana,source_timezone,country_code').limit(2)
  if (org.error) throw new Error('Promise organisation context unavailable')
  const organisation = (org.data?.length === 1 ? org.data[0] : null) as unknown as Row | null
  const normalized = normalizeXeroOrganisationTimezone(organisation?.source_timezone, organisation?.country_code)
  const timezone = typeof organisation?.timezone_iana === 'string' ? organisation.timezone_iana : normalized
  const date = organisationDateAt(timezone, params.now ?? new Date()), query = params.query
  if (query.date !== 'all' && !date) throw new PromiseWorklistInputError('Organisation date is unavailable. Use All dates until accounting timezone context is restored.')
  const search = await searchScope(context, query.q)
  let read = context.admin.from('invoice_promises').select(COLUMNS, { count: 'exact' })
    .eq('user_id', context.userId).eq('tenant_id', context.tenantId).eq('source_system', 'xero')
  if (query.status === 'history') read = read.in('status', terminal)
  else read = read.eq('status', query.status)
  if (query.date === 'passed') read = read.lt('promised_date', date!)
  if (query.date === 'today') read = read.eq('promised_date', date!)
  if (query.date === 'upcoming') read = read.gt('promised_date', date!)
  if (search) read = read.or(search)
  const start = (query.page - 1) * query.pageSize
  const result = await read.order('promised_date', { ascending: query.status === 'active', nullsFirst: false }).order('id', { ascending: true }).range(start, start + query.pageSize - 1)
  if (result.error || result.count === null) throw new Error('Promise worklist unavailable')
  const rows = (result.data ?? []) as Row[]
  // Validate operational ownership/identities before any identity hydration.
  projectPromiseWorklist(rows, [], [], context, date)
  const customerIds = [...new Set(rows.map(row => String(row.customer_source_id)))], invoiceIds = [...new Set(rows.map(row => String(row.invoice_source_id)))]
  const [customers, invoices] = rows.length ? await Promise.all([
    scoped(context, 'canonical_customers', 'user_id,tenant_id,source_system,source_id,name').in('source_id', customerIds).limit(query.pageSize + 1),
    scoped(context, 'canonical_invoices', 'user_id,tenant_id,source_system,source_id,customer_source_id,invoice_number,status,transaction_currency_code,amount_due_native::text').in('source_id', invoiceIds).limit(query.pageSize + 1),
  ]) : [{ data: [], error: null }, { data: [], error: null }]
  if (customers.error || invoices.error || (customers.data?.length ?? 0) > query.pageSize || (invoices.data?.length ?? 0) > query.pageSize) throw new Error('Promise identity context unavailable')
  await assertInvoicePromiseSnapshotCurrent(context)
  return { ok: true, tenantId: context.tenantId, organisationDate: date, timezone: date ? timezone : null, query,
    rows: projectPromiseWorklist(rows, (customers.data ?? []) as unknown as Row[], (invoices.data ?? []) as unknown as Row[], context, date), total: result.count!, pageCount: Math.max(1, Math.ceil(result.count! / query.pageSize)) }
}
