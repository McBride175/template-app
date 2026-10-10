import { useEffect, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import QueueInvoices from '@/app/collections/actions/QueueInvoices'
import { priorityInvoicesHref } from '@/app/collections/actions/queue-navigation-context'
import type { InvoiceDisputeView } from '@/lib/collections/invoice-dispute-view'
import { invoiceFixture, invoiceFixtures } from './customerFixture'
import ProductShell from '@/app/components/shell/ProductShell'
import QueueCustomer, { type QueueCustomerProps } from '@/app/collections/actions/QueueCustomer'
import QueueActionPanel, { type FollowUpChoice } from '@/app/collections/actions/QueueActionPanel'
import QueueOrder from '@/app/collections/actions/QueueOrder'
import QueueState from '@/app/collections/actions/QueueState'
import QueueNavigation, { revealPriority } from '@/app/collections/actions/QueueNavigation'
import FounderContextControl from '@/app/collections/FounderContextControl'
import Button from '@/app/components/ui/Button'
import Card from '@/app/components/ui/Card'
import Alert from '@/app/components/ui/Alert'
import AccountingRefreshStatus from '@/app/components/AccountingRefreshStatus'
import { accountingFixture } from './accountingFixture'
import type { ProductAccountingStatus } from '@/lib/accounting/product-refresh'

const customers = [
  { id: 'synthetic-1', name: 'Northbridge Supplies', amount: '£6,842.50' },
  { id: 'synthetic-2', name: 'Cedar & Finch Studio', amount: '£2,140.00' },
  { id: 'synthetic-3', name: 'Harbour Engineering', amount: '£4,500.00' },
  { id: 'synthetic-4', name: 'Westfield Print', amount: '£985.20' },
  { id: 'synthetic-5', name: 'Juniper Services', amount: '£3,760.00' },
  { id: 'synthetic-6', name: 'Oak & Ash Design', amount: '£510.75' },
]

interface PreviewProps {
  state?: 'populated' | 'loading' | 'complete' | 'no-overdue' | 'no-eligible' | 'error'
  name?: string
  amount?: string
  financialDetail?: boolean
  saving?: boolean
  uncertain?: boolean
  withAccounting?: boolean
  initialIndex?: number
  accountingStatus?: ProductAccountingStatus
  invoices?: InvoiceDisputeView[]
  invoiceStatus?: 'ready' | 'loading' | 'error'
  firstActionGuidance?: boolean
}

function QueuePreview({ state = 'populated', name, amount, financialDetail, saving = false, uncertain = false, withAccounting = false, initialIndex = 0, accountingStatus = accountingFixture, firstActionGuidance = false, invoices, invoiceStatus = 'ready' }: PreviewProps) {
  const [index, setIndex] = useState(initialIndex)
  const focusedPriority = useRef<HTMLElement>(null)
  const returning = useRef(false)
  useEffect(() => { if (returning.current) { returning.current = false; revealPriority(focusedPriority.current) } }, [index])
  const [choice, setChoice] = useState<FollowUpChoice>('tomorrow')
  const [showDates, setShowDates] = useState(false)
  const [date, setDate] = useState('')
  const [showNote, setShowNote] = useState(false)
  const [note, setNote] = useState('')
  const [event, setEvent] = useState('')
  const selected = customers[index]
  const props: Omit<QueueCustomerProps, 'children'> = {
    name: name ?? selected.name, amount: amount ?? selected.amount, email: 'collections@example.invalid',
    position: index + 1, count: customers.length, weightedDays: '28.6', lastPayment: '27 Sep 2026',
    recommendation: index === 0 ? 'Review now' : 'Follow up', adjustment: financialDetail ? 'priority' : 'normal',
    invoiceContext: invoices && <QueueInvoices key={selected.id} state={{ status: invoiceStatus, invoices, error: 'Invoice context could not load. Your collection actions are still available.' }} evaluationDate="2026-10-10" href={priorityInvoicesHref('synthetic', selected.id)} onRetry={() => setEvent('Preview invoice retry callback')} />,
    invoicesHref: `/customers?customerSourceId=${selected.id}`, historyHref: `/customers/${selected.id}/history`,
    // The normal story matches the compact API: no invented full explanation.
    grossOverdue: '£9,792.50', ...(financialDetail ? {
      totalOutstanding: '£14,120.00', disputed: '£1,200.00', promised: '£750.00', credit: '£1,000.00',
      reason: 'Supplied explanation: overdue exposure and a change from this customer’s usual payment pattern increase the accounting score.',
      breakdown: ['Synthetic server-supplied explanation, without browser recalculation.'],
    } : {}),
    detailActions: withAccounting ? <div className="sm:hidden"><Button variant="secondary" className="min-h-11" onClick={fn()}>Refresh priorities</Button></div> : undefined,
  }
  function select(next: number) { setIndex(next); setChoice('tomorrow'); setShowDates(false); setDate(''); setNote(''); setShowNote(false) }
  const navigation = <QueueNavigation index={index} count={customers.length} disabled={saving}
    onPrevious={() => select(index - 1)} onNext={() => select(index + 1)}
    onFirst={() => { returning.current = true; setIndex(0); setShowNote(false); setNote('') }} />
  return <ProductShell pathname="/dashboard" accountLabel="Synthetic example" onSignOut={fn()}>
    {withAccounting && <AccountingRefreshStatus status={accountingStatus} busy={false} error={null} onRefresh={fn()} onCheck={fn()} returnTo="/dashboard" />}
    <div className="space-y-3 sm:space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-semibold sm:text-2xl">Priorities</h1>
        <p className={`mt-1 text-sm text-text-secondary ${state === 'populated' ? 'hidden sm:block' : ''}`}>{state === 'populated' ? 'Next to chase · 6 remaining in your queue' : 'Work through your actionable collection queue.'}</p></div>
        {state === 'populated' && <div className="sm:hidden">{navigation}</div>}
        {withAccounting && <Button variant="ghost" className="hidden min-h-11 sm:inline-flex" onClick={fn()}>Refresh priorities</Button>}
      </div>
      {state === 'populated' ? <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_16rem]">
        <Card className="min-w-0 space-y-5 shadow-none sm:p-6">
          <div className="hidden flex-wrap items-center justify-between gap-2 border-b border-border-default pb-3 sm:flex">
            <p className="hidden text-xs text-text-secondary sm:block">Ranked by Yuohme · choose the appropriate contact method</p>
            {navigation}
          </div>
          <QueueCustomer {...props} focusRef={focusedPriority} contextControl={<FounderContextControl customerName={props.name} value={props.adjustment}
            saving={false} onChange={level => setEvent(`Preview context selection: ${level}`)} />}>
            <QueueActionPanel firstActionGuidance={firstActionGuidance} disabled={saving} saving={saving} uncertain={uncertain} followUp={choice}
              followUpLabel={choice === 'tomorrow' ? 'Tomorrow' : choice === 'two_days' ? 'In 2 days' : choice === 'three_days' ? 'In 3 days' : choice === 'next_week' ? 'Next week' : date || 'Choose date'}
              showFollowUp={showDates} datesAvailable minimumDate="2026-10-11" customDate={date}
              showNote={showNote} note={note} onToggleFollowUp={() => setShowDates(value => !value)}
              onFollowUp={setChoice} onCustomDate={setDate} onShowNote={() => setShowNote(true)} onNote={setNote}
              onRetry={() => setEvent('Preview retry callback')}
              onRecord={outcome => setEvent(JSON.stringify({ outcome, followUp: choice, date, note }))} />
          </QueueCustomer>
        </Card>
        <QueueOrder rows={customers.map(row => ({ ...row, amount: `${row.amount} to chase` }))}
          index={index} disabled={saving} onSelect={select} />
      </div> : state === 'loading' ? <QueueState title="Loading next customer…" description="Preparing your collection priorities." loading />
        : state === 'complete' ? <QueueState title="Queue complete" description="All eligible customers are actioned or deferred for today." />
          : state === 'no-overdue' ? <QueueState title="No overdue amount to chase" description="No mapped customers currently have an overdue amount to chase." />
            : state === 'no-eligible' ? <QueueState title="No eligible customers" description="No mapped customers currently meet the collection queue criteria." />
              : <><QueueState title="Priorities unavailable" description="Try refreshing the current queue again."><Button variant="secondary" className="min-h-11" onClick={fn()}>Refresh priorities</Button></QueueState><Alert variant="error">Unable to load collection priorities right now. Try refreshing again.</Alert></>}
      {event && <Alert variant="info" data-testid="preview-event">Preview callback only: {event}</Alert>}
      <p className="text-xs text-text-secondary">Synthetic presentation fixture. No authentication, accounting services or financial mutations.</p>
    </div>
  </ProductShell>
}

const meta = { title: 'Yuohme/CollectionQueue', component: QueuePreview,
  parameters: { layout: 'fullscreen', nextjs: { navigation: { pathname: '/dashboard' } } },
} satisfies Meta<typeof QueuePreview>
export default meta
type Story = StoryObj<typeof meta>

export const FirstPriority: Story = {}
export const CompactDashboard: Story = { args: { withAccounting: true } }
export const FirstAction: Story = { args: { withAccounting: true, firstActionGuidance: true } }
export const BackToFirst: Story = { args: { initialIndex: 2, withAccounting: true } }
export const RefreshWarning: Story = { args: { withAccounting: true, accountingStatus: {
  ...accountingFixture, accounting: { ...accountingFixture.accounting, ageSeconds: 100000, freshness: 'very_stale' },
} } }
export const LongCustomerName: Story = { args: { name: 'Northbridge International Engineering and Specialist Construction Services Limited — Northern Region' } }
export const LargeAmount: Story = { args: { amount: '£999,999,999.99' } }
export const PromisesDisputesCredits: Story = { args: { financialDetail: true } }
export const Loading: Story = { args: { state: 'loading' } }
export const EmptyQueue: Story = { args: { state: 'complete' } }
export const NoOverdue: Story = { args: { state: 'no-overdue' } }
export const NoEligible: Story = { args: { state: 'no-eligible' } }
export const Error: Story = { args: { state: 'error' } }
export const Saving: Story = { args: { saving: true } }
export const UncertainSave: Story = { args: { uncertain: true } }

// Phase 5D: pure presentation; transport/return continuity is tested with the real client separately.
export const PriorityInvoices: Story = { args: { invoices: invoiceFixtures, withAccounting: true } }
export const ManyInvoices: Story = { args: { invoices: [invoiceFixture, ...Array.from({ length: 5 }, (_, index) => ({ ...invoiceFixture,
  invoiceSourceId: `synthetic-extra-${index}`, invoiceNumber: `INV-${2000 + index}`, dueDate: `2026-09-0${index + 1}`, isActive: false, activePromise: null }))] } }
export const InvoiceLoading: Story = { args: { invoices: [], invoiceStatus: 'loading' } }
export const InvoiceError: Story = { args: { invoices: [], invoiceStatus: 'error' } }
export const NoOverdueInvoices: Story = { args: { invoices: [invoiceFixtures[3]] } }
export const InvoiceCoverage: Story = { args: { invoices: [invoiceFixture,
  { ...invoiceFixture, invoiceSourceId: 'synthetic-full-dispute', invoiceNumber: 'INV-1100', disputeMode: 'full', effectiveDisputedAmountNative: '5000', activePromise: null },
  { ...invoiceFixture, invoiceSourceId: 'synthetic-full-promise', invoiceNumber: 'INV-1101', isActive: false, activePromisedCoverageAmountNative: '5000' }] } }
export const InvoiceUnavailable: Story = { args: { invoices: [
  { ...invoiceFixture, invoiceSourceId: 'synthetic-unavailable', invoiceState: 'unavailable', currentAmountDueNative: null },
  { ...invoiceFixture, currencyCode: null, needsReview: true }] } }
export const InvoiceLongValues: Story = { args: { invoices: [{ ...invoiceFixture,
  invoiceNumber: 'INVOICE-NORTHBRIDGE-INTERNATIONAL-NORTHERN-REGION-2026-000001', currencyCode: 'USD', currentAmountDueNative: '9999999999999999.99' },
  { ...invoiceFixture, invoiceSourceId: 'synthetic-eur', invoiceNumber: 'EUR-001', currencyCode: 'EUR' }] } }
