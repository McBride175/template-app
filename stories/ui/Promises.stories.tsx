import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import ProductShell from '@/app/components/shell/ProductShell'
import PromiseWorklist from '@/app/promises/PromiseWorklist'
import { parsePromiseWorklist, promiseDateCategory, type PromiseWorklistRow, type PromiseWorklistQuery } from '@/lib/collections/promise-worklist'
const date = '2026-10-10'
const promiseFixtures: PromiseWorklistRow[] = [
  ['Northbridge Supplies', 'INV-1048', '2026-10-08', 'active', 'GBP', '4000', '1250'],
  ['Cedar & Finch Studio', 'INV-2034', '2026-10-10', 'active', 'EUR', '2750.50', '0'],
  ['Northbridge Supplies', 'INV-1053', '2026-10-12', 'active', 'GBP', '1800', '0'],
  ['Aster Engineering', 'INV-3201', '2026-10-14', 'active', 'USD', '5600', '2400'],
  ['Brookfield Services', 'INV-4070', '2026-10-02', 'kept', 'GBP', '3000', '3000'],
  ['Cedar & Finch Studio', 'INV-2001', '2026-10-01', 'missed', 'EUR', '850', '150'],
  ['Westhaven Trading', 'INV-5001', '2026-10-01', 'unclear', 'USD', '2400', '0'],
  ['Aster Engineering', 'INV-3008', '2026-09-28', 'cancelled', 'USD', '1250', '0'],
].map(([name, ref, promisedDate, status, currencyCode, amount, paid], index) => ({
  id: `promise-${index}`, customerSourceId: index === 2 ? 'customer-0' : `customer-${index}`, invoiceSourceId: `invoice-${index}`,
  customerName: name, invoiceReference: ref, promisedDate, status: status as PromiseWorklistRow['status'], currencyCode,
  promisedAmountNative: amount, qualifyingPaidAmountNative: paid, dateCategory: promiseDateCategory(promisedDate, date),
  note: index === 0 ? 'Accounts team expects the next payment run to include this invoice. Call if the remittance has not arrived.' : null,
  currentInvoiceStatus: status === 'kept' ? 'PAID' : 'AUTHORISED', currentOutstandingNative: status === 'kept' ? '0' : amount,
  contextUnavailable: false, financialUnavailable: false, resolvedAt: status === 'active' ? null : '2026-10-04T10:00:00Z',
}))
interface Props { mode?: 'active' | 'history'; state?: 'normal' | 'loading' | 'empty' | 'error' | 'unavailable'; long?: boolean; pagination?: boolean }
function Preview({ mode = 'active', state = 'normal', long = false, pagination = false }: Props) {
  const [query, setQuery] = useState<PromiseWorklistQuery>({ ...parsePromiseWorklist(new URLSearchParams()), status: mode }), [feedback, setFeedback] = useState('')
  const all = long ? promiseFixtures.map((row, i) => i === 0 ? { ...row, customerName: 'Northbridge International Engineering and Specialist Construction Services Limited — Northern Region', invoiceReference: 'INV-INTERNATIONAL-REFERENCE-12345678901234567890', promisedAmountNative: '9999999999999999.99' } : row) : promiseFixtures
  const rows = state === 'empty' ? [] : all.filter(row => (query.status === 'history' ? row.status !== 'active' : row.status === query.status)
    && (!query.q || `${row.customerName} ${row.invoiceReference}`.toLowerCase().includes(query.q.toLowerCase()))
    && (query.date === 'all' || row.dateCategory === query.date))
    .sort((a,b) => (query.status === 'active' ? 1 : -1) * (a.promisedDate ?? '').localeCompare(b.promisedDate ?? '') || a.id.localeCompare(b.id))
  const unavailable = state === 'unavailable'
  return <ProductShell pathname="/promises" accountLabel="Synthetic example" onSignOut={() => {}}>
    <PromiseWorklist query={query} loading={state === 'loading'} error={state === 'error' ? 'Could not load promises. Please retry.' : null}
      data={{ ok: true, tenantId: 'synthetic', organisationDate: unavailable ? null : date, timezone: unavailable ? null : 'Europe/London', query,
        rows: unavailable ? rows.map((row,i) => ({ ...row, dateCategory: 'unavailable', ...(i === 0 ? { promisedAmountNative: null, qualifyingPaidAmountNative: null, currencyCode: '', contextUnavailable: true, financialUnavailable: true, currentOutstandingNative: null } : {}) })) : rows,
        total: pagination ? 54 : rows.length, pageCount: pagination ? 3 : 1 }}
      onRetry={() => setFeedback('Synthetic retry callback. No request made.')} onNavigate={next => { setQuery(next); setFeedback('Synthetic navigation. No financial request made.') }} />
    {feedback && <p role="status" data-testid="promise-preview-event" className="mt-3 text-xs">{feedback}</p>}
  </ProductShell>
}
const meta = { title: 'Yuohme/Promises', component: Preview, parameters: { layout: 'fullscreen', nextjs: { navigation: { pathname: '/promises' } } }, args: {} } satisfies Meta<typeof Preview>
export default meta
type Story = StoryObj<typeof meta>
export const Active: Story = {}
export const History: Story = { args: { mode: 'history' } }
export const LongValues: Story = { args: { long: true } }
export const Loading: Story = { args: { state: 'loading' } }
export const Empty: Story = { args: { state: 'empty' } }
export const Error: Story = { args: { state: 'error' } }
export const Unavailable: Story = { args: { state: 'unavailable' } }
export const Pagination: Story = { args: { pagination: true } }
