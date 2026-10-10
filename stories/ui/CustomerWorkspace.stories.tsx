import { useId, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import ProductShell from '@/app/components/shell/ProductShell'
import CustomerOverview from '@/app/collections/customers/CustomerOverview'
import CustomerPromises from '@/app/collections/customers/CustomerPromises'
import CustomerBrowser from '@/app/collections/customers/CustomerBrowser'
import CustomerSelectionPanel from '@/app/collections/customers/CustomerSelectionPanel'
import InvoiceFrame from '@/app/collections/customers/InvoiceFrame'
import InvoiceDetails from '@/app/collections/customers/InvoiceDetails'
import InvoicePromisePanel from '@/app/collections/customers/InvoicePromisePanel'
import CustomerTimeline from '@/app/collections/customers/CustomerTimeline'
import CustomerHistoryView from '@/app/collections/customers/CustomerHistoryView'
import type { CustomerCollectionsSummaryRow } from '@/app/collections/customers/customer-workspace-types'
import type { InvoiceDisputeView } from '@/lib/collections/invoice-dispute-view'
import type { PromiseView } from '@/lib/collections/promise-presentation'
import Button from '@/app/components/ui/Button'
import Select from '@/app/components/ui/Select'
import Alert from '@/app/components/ui/Alert'
import EmptyState from '@/app/components/ui/EmptyState'
import Spinner from '@/app/components/ui/Spinner'
import { customerFixture, customerFixtures, invoiceFixture, invoiceFixtures, historyFixtures } from './customerFixture'

// Controlled view fixtures only. No live feature client, API, auth or accounting provider.
function PromisePreview({ invoice = invoiceFixture, failed = false }: { invoice?: InvoiceDisputeView; failed?: boolean }) {
  const id = useId(), formRef = useRef<HTMLFormElement>(null), actionRef = useRef<HTMLButtonElement>(null)
  const [current, setCurrent] = useState<PromiseView | null>(invoice.activePromise ?? invoice.latestPromise ?? null)
  const active = current?.status === 'active' ? current : null
  const [editing, setEditing] = useState(false), [amount, setAmount] = useState(''), [date, setDate] = useState(''), [note, setNote] = useState('')
  const [message, setMessage] = useState<string | null>(null), [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const cancellation = Boolean(active) && (amount === '' || amount === '0')
  return <InvoicePromisePanel id={id} invoice={invoice} active={active} current={current} editing={editing} eligible={invoice.invoiceState === 'open'}
    cancellation={cancellation} locked={false} saving={false} amount={amount} date={date} note={note} setAmount={setAmount} setDate={setDate} setNote={setNote}
    formRef={formRef} actionRef={actionRef} fieldErrors={{}} error={failed ? 'Accounting details are not ready. Refresh accounting and try again.' : null}
    message={message} refreshNeeded={failed} historyOpen={historyOpen} historyLoading={false} historyError={null} eventLoading={null}
    history={current ? [{ promise: current, events: historyLoaded ? [] : null }] : []}
    open={() => { setAmount(active?.promisedAmountNative ?? ''); setDate(active?.promisedDate ?? ''); setNote(active?.note ?? ''); setEditing(true); queueMicrotask(() => formRef.current?.querySelector('input')?.focus()) }}
    close={() => { setEditing(false); actionRef.current?.focus() }}
    save={event => { event.preventDefault(); setCurrent({ id: 'synthetic-promise', revision: '4', status: cancellation ? 'cancelled' : 'active',
      promisedAmountNative: cancellation ? current?.promisedAmountNative ?? null : amount, promisedDate: cancellation ? current?.promisedDate : date,
      qualifyingPaidAmountNative: '0', note }); setEditing(false); setMessage('Synthetic promise saved. No request made.'); actionRef.current?.focus() }}
    showHistory={() => setHistoryOpen(value => !value)} loadEvents={() => setHistoryLoaded(true)} refreshSaved={() => setMessage('Synthetic refresh callback.')} />
}
function InvoicePreview({ invoices = invoiceFixtures, failed = false }: { invoices?: InvoiceDisputeView[]; failed?: boolean }) {
  return <section id="customer-invoices" aria-label="Customer invoice workspace" className="min-w-0 space-y-3">
    <h3 className="text-base font-semibold">Invoices ({invoices.length})</h3><p className="text-xs text-text-secondary">Amounts use invoice currency. Customer To chase includes applicable customer credit.</p>
    {!invoices.length && <EmptyState title="No invoices to review" description="No current or previously disputed invoices are available for this customer." />}
    {invoices.map(invoice => <InvoiceFrame key={invoice.invoiceSourceId} invoice={invoice}>
      <InvoiceDetails compact><p className="text-sm text-text-secondary">Reference: {invoice.reference || '—'}</p><p className="mt-2 text-sm text-text-secondary">{invoice.note}</p><Button variant="secondary" className="mt-2 min-h-11">{invoice.isActive ? 'Edit dispute' : invoice.isResolved ? 'Edit note' : 'Mark disputed'}</Button></InvoiceDetails>
      <PromisePreview invoice={invoice} failed={failed} />
    </InvoiceFrame>)}
  </section>
}
function HistoryPreview() {
  const [feedback, setFeedback] = useState<string | null>(null)
  return <ProductShell pathname="/customers/synthetic-1/history" accountLabel="Synthetic example" onSignOut={() => {}} pageHasMain>
    <CustomerHistoryView tenantId="synthetic" customerSourceId="synthetic-1" customerName="Northbridge Supplies" events={historyFixtures}
      busy={false} error={null} feedback={feedback} hasMore onDelete={() => setFeedback('Synthetic delete callback. No request made.')}
      onMore={() => setFeedback('Synthetic pagination callback.')} />
  </ProductShell>
}
interface Props { initialSelected?: boolean; customer?: CustomerCollectionsSummaryRow; state?: 'normal' | 'loading' | 'empty' | 'error' | 'unavailable'; equivalent?: boolean; history?: boolean; invoices?: InvoiceDisputeView[] }
function Workspace({ initialSelected = true, customer = customerFixture, state = 'normal', equivalent = false, history = false, invoices = invoiceFixtures }: Props) {
  const [selected, setSelected] = useState<string | null>(initialSelected ? customer.customer_source_id : null), [search, setSearch] = useState(''), [sort, setSort] = useState('overdue_outstanding:desc'), [overdue, setOverdue] = useState(false)
  const [adjustment, setAdjustment] = useState(customer.override_level), [message, setMessage] = useState('')
  const all = [customer, ...customerFixtures.slice(1)]
  const selectedRow = all.find(row => row.customer_source_id === selected)
  const found = state === 'empty' ? [] : all.filter(row => `${row.customer_name} ${row.customer_email}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  return <ProductShell pathname="/customers" accountLabel="Synthetic example" onSignOut={() => {}}>
    <div className="min-w-0 space-y-4 sm:space-y-6">
      <h1 className={selected ? 'sr-only text-2xl font-semibold sm:not-sr-only' : 'text-xl font-semibold sm:text-2xl'}>Customers</h1>
      {message && <Alert>{message}</Alert>}
      {state === 'error' && <Alert variant="error">Could not load customer detail. Retry using the current selection.</Alert>}
      {state === 'unavailable' && <Alert variant="warning">Currency evidence is incomplete. Native invoice amounts remain available; base totals are unavailable.</Alert>}
      <div className="grid min-w-0 items-start gap-3 sm:gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <CustomerSelectionPanel key={selected ?? 'browse'} selected={Boolean(selected)}><CustomerBrowser rows={found} selectedId={selected} currency="GBP" equivalent={equivalent}
          search={search} onSearch={setSearch} overdueOnly={overdue} onOverdueOnly={setOverdue} sort={sort} onSort={setSort}
          sortOptions={[{ value: 'overdue_outstanding:desc', label: 'Gross overdue (high to low)' }, { value: 'customer_name:asc', label: 'Customer name (A to Z)' }]}
          loading={state === 'loading'} refreshing={false} onRefresh={() => setMessage('Synthetic refresh callback. No request made.')}
          onSelect={id => setSelected(current => current === id ? null : id)} /></CustomerSelectionPanel>
        <div className="min-w-0 space-y-5">
          {state === 'loading' ? <div role="status" className="flex items-center gap-2"><Spinner label={null} />Loading selected customer and invoices…</div>
          : selectedRow ? <><a href="/dashboard?tenantId=synthetic#collection-actions" className="inline-flex min-h-11 items-center text-sm text-link underline underline-offset-4">Back to Priorities</a>
            {history ? <><h2 className="break-words text-xl font-semibold">{selectedRow.customer_name}</h2><CustomerTimeline events={historyFixtures} busy={false} onDelete={() => setMessage('Synthetic delete callback. No request made.')} customerHref="/customers?tenantId=synthetic&customerSourceId=synthetic-1" /><Button variant="secondary" className="min-h-11" onClick={() => setMessage('Synthetic pagination callback.')}>Load more history</Button></>
            : <><CustomerOverview row={{ ...selectedRow, override_level: adjustment }} currency="GBP" equivalent={equivalent}
                historyHref={`/customers/${selectedRow.customer_source_id}/history?tenantId=synthetic`}
                contextControl={<Select aria-label="Customer context" value={adjustment} onChange={event => setAdjustment(event.target.value as typeof adjustment)} className="min-h-11"><option value="normal">Normal</option><option value="priority">Priority</option><option value="safe">Safe</option><option value="do_not_chase">Never chase</option></Select>} />
              <InvoicePreview invoices={invoices} failed={state === 'error'} /><CustomerPromises invoices={invoices} /></>}
          </> : <EmptyState title="Select a customer" description="Find an account to review its financial position, invoices and collection history." />}
        </div>

      </div>
      <p className="text-xs text-text-secondary">Fictional presentation fixtures. No authenticated session or financial services.</p>
    </div>
  </ProductShell>
}
const meta = { title: 'Yuohme/CustomerWorkspace', component: Workspace, parameters: { layout: 'fullscreen', nextjs: { navigation: { pathname: '/customers' } } }, args: {} } satisfies Meta<typeof Workspace>
export default meta
type Story = StoryObj<typeof meta>
export const SelectedCustomer: Story = {}
export const CustomerList: Story = { args: { initialSelected: false } }
export const LongCustomerName: Story = { args: { customer: { ...customerFixture, customer_name: 'Northbridge International Engineering and Specialist Construction Services Limited — Northern Region' } } }
export const LargeAmounts: Story = { args: { customer: { ...customerFixture, customer_to_chase_overdue_base: 999999999.99, total_outstanding_base: 1250000000 } } }
export const MultiCurrency: Story = { args: { equivalent: true, customer: { ...customerFixture, native_currency_breakdown: [{ currency_code: 'EUR', total_outstanding_native: '16800', overdue_outstanding_native: '11200' }, ...customerFixture.native_currency_breakdown] } } }
export const NoOverdueToChase: Story = { args: { customer: { ...customerFixture, customer_to_chase_overdue_base: 0 } } }
export const CurrencyUnavailable: Story = { args: { state: 'unavailable', customer: { ...customerFixture, total_outstanding_base: null, overdue_outstanding_base: null }, invoices: [{ ...invoiceFixture, invoiceState: 'invalid', currencyCode: null, currentAmountDueNative: null, activePromise: null }] } }
export const ActivityHistory: Story = { render: () => <HistoryPreview /> }
export const Loading: Story = { args: { state: 'loading' } }
export const Empty: Story = { args: { state: 'empty', initialSelected: false } }
export const Error: Story = { args: { state: 'error' } }
export const EmptyInvoices: Story = { args: { invoices: [] } }
export const InvoiceStates: Story = { args: { invoices: [...invoiceFixtures, { ...invoiceFixture, invoiceSourceId: 'synthetic-unavailable', invoiceState: 'unavailable', currentAmountDueNative: null, activePromise: null }, { ...invoiceFixture, invoiceSourceId: 'synthetic-review', needsReview: true }] } }
export const TerminalPromises: Story = { args: { invoices: (['kept','missed','unclear','cancelled'] as const).map((status, index) => ({
  ...invoiceFixture, invoiceSourceId: `synthetic-terminal-${index}`, invoiceNumber: `INV-HISTORY-${index}`, invoiceState: 'settled', currentAmountDueNative: '0',
  effectiveDisputedAmountNative: '0', activePromisedCoverageAmountNative: '0', activePromise: null,
  latestPromise: { id: `synthetic-terminal-promise-${index}`, status, promisedAmountNative: '1000', promisedDate: '2026-10-01', qualifyingPaidAmountNative: status === 'kept' ? '1000' : '0' },
})) } }
