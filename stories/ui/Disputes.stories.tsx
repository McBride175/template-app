import { promiseMoney } from '@/lib/collections/promise-presentation'
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import ProductShell from '@/app/components/shell/ProductShell'
import DisputeWorklist from '@/app/disputes/DisputeWorklist'
import InvoiceFrame from '@/app/collections/customers/InvoiceFrame'
import DisputeManagementPreview, { SyntheticDisputePanel } from './DisputeManagementPreview'
import { disputeFixture, disputeFixtures, disputeResponse, disputeQuery } from './disputeFixture'
import { selectDisputeWorklistRows, type DisputeWorklistRow, type DisputeWorklistQuery } from '@/lib/collections/dispute-worklist'
interface Props { mode?: 'normal' | 'promise' | 'mixed' | 'all' | 'review' | 'resolved' | 'unavailable' | 'long' | 'loading' | 'empty' | 'error' | 'before'; manage?: 'partial' | 'review' | 'resolved' | 'unavailable' }
function Preview({ mode = 'normal', manage }: Props) {
 const [query, setQuery] = useState<DisputeWorklistQuery>({ ...disputeQuery, status: mode === 'all' || mode === 'mixed' || mode === 'long' ? 'all' as const : mode === 'resolved' ? 'resolved' as const : mode === 'review' ? 'needs_review' as const : mode === 'unavailable' ? 'unavailable' as const : 'active' as const })
 const [selected, setSelected] = useState<DisputeWorklistRow | null>(manage ? disputeFixtures[{ partial: 1, review: 2, resolved: 4, unavailable: 6 }[manage]] : null)
 const all = mode === 'promise' ? [disputeFixture] : mode === 'long' ? disputeFixtures.map((row,i) => i ? row : { ...row, customerName: 'Northbridge International Engineering and Specialist Construction Services Limited', invoiceNumber: 'INV-INTERNATIONAL-REFERENCE-1234567890123456789', effectiveDisputedAmountNative: '9999999999999999.99' }) : mode === 'mixed' ? [...disputeFixtures, { ...disputeFixtures[1], disputeId: 'synthetic-usd', invoiceSourceId: 'synthetic-usd-invoice', invoiceNumber: 'INV-USD-1150', currencyCode: 'USD', effectiveDisputedBase: null }] : disputeFixtures
 const result = selectDisputeWorklistRows(mode === 'empty' ? [] : all, query)
 return <ProductShell pathname="/disputes" pageHasMain accountLabel="Synthetic example" onSignOut={() => {}}>
  {mode === 'before' ? <main className="mx-auto max-w-5xl space-y-4 sm:px-6 sm:py-8"><h1 className="text-2xl font-semibold">Disputes — earlier presentation</h1>{disputeFixtures.slice(0,2).map(row => <article key={row.disputeId} data-before-dispute className="overflow-hidden rounded-lg border border-border-default bg-surface"><div className="flex flex-wrap justify-between gap-3 p-4 text-sm"><div><h2 className="font-semibold">{row.customerName}</h2><p className="mt-1 inline-block underline">View customer / invoice</p></div><div className="space-y-1"><p>42 days overdue</p><p>Effective disputed equivalent: {promiseMoney(row.effectiveDisputedBase, 'GBP')}</p></div></div><section className="space-y-4 bg-surface-subtle p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-base font-semibold">Invoices for {row.customerName}</h3><p className="text-xs text-text-secondary">Amounts use invoice currency.</p></div><button className="min-h-11 rounded-control border px-4 text-sm">Refresh invoices</button></div><div className="border-t border-border-default"><InvoiceFrame invoice={row} defaultExpanded><SyntheticDisputePanel row={row} /></InvoiceFrame></div></section></article>)}</main>
   : <DisputeWorklist query={query} tenantId="synthetic" data={mode === 'loading' || mode === 'error' ? null : { ...disputeResponse(result.rows, result.query), total: result.total, pageCount: result.pageCount }} loading={mode === 'loading'} error={mode === 'error' ? 'Could not load disputes.' : null} onRetry={() => {}} onNavigate={setQuery} onManage={setSelected} />}
  {selected && <DisputeManagementPreview row={selected} onClose={() => setSelected(null)} initialEditing={manage === 'partial'} />}
 </ProductShell>
}
const meta = { title: 'Yuohme/Disputes', component: Preview, parameters: { layout: 'fullscreen', nextjs: { navigation: { pathname: '/disputes' } } }, args: {} } satisfies Meta<typeof Preview>
export default meta
type Story = StoryObj<typeof meta>
export const Active: Story = {}
export const PromiseAndDispute: Story = { args: { mode: 'promise' } }
export const MixedCurrencies: Story = { args: { mode: 'mixed' } }
export const AllStates: Story = { args: { mode: 'all' } }
export const NeedsReview: Story = { args: { mode: 'review' } }
export const Resolved: Story = { args: { mode: 'resolved' } }
export const Unavailable: Story = { args: { mode: 'unavailable' } }
export const LongValues: Story = { args: { mode: 'long' } }
export const Loading: Story = { args: { mode: 'loading' } }
export const Empty: Story = { args: { mode: 'empty' } }
export const Error: Story = { args: { mode: 'error' } }
export const PartialEditor: Story = { args: { manage: 'partial' } }
export const ReviewManagement: Story = { args: { manage: 'review' } }
export const ResolvedManagement: Story = { args: { manage: 'resolved', mode: 'resolved' } }
export const UnavailableManagement: Story = { args: { manage: 'unavailable', mode: 'unavailable' } }
export const EarlierPresentation: Story = { args: { mode: 'before' } }
