import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import ProductShell from '@/app/components/shell/ProductShell'
import QueueCustomer, { type QueueCustomerProps } from '@/app/collections/actions/QueueCustomer'
import QueueActionPanel, { type FollowUpChoice } from '@/app/collections/actions/QueueActionPanel'
import QueueOrder from '@/app/collections/actions/QueueOrder'
import QueueState from '@/app/collections/actions/QueueState'
import FounderContextControl from '@/app/collections/FounderContextControl'
import Button from '@/app/components/ui/Button'
import Card from '@/app/components/ui/Card'
import Alert from '@/app/components/ui/Alert'

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
}

function QueuePreview({ state = 'populated', name, amount, financialDetail, saving = false, uncertain = false }: PreviewProps) {
  const [index, setIndex] = useState(0)
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
    invoicesHref: '/customers?customerSourceId=synthetic-1', historyHref: '/customers/synthetic-1/history',
    // The normal story matches the compact API: no invented full explanation.
    grossOverdue: '£9,792.50', ...(financialDetail ? {
      totalOutstanding: '£14,120.00', disputed: '£1,200.00', promised: '£750.00', credit: '£1,000.00',
      reason: 'Supplied explanation: overdue exposure and a change from this customer’s usual payment pattern increase the accounting score.',
      breakdown: ['Synthetic server-supplied explanation, without browser recalculation.'],
    } : {}),
  }
  function select(next: number) { setIndex(next); setChoice('tomorrow'); setShowDates(false); setDate(''); setNote(''); setShowNote(false) }
  return <ProductShell pathname="/dashboard" accountLabel="Synthetic example" onSignOut={fn()}>
    <div className="space-y-5">
      <div><h1 className="text-2xl font-semibold">Priorities</h1>
        <p className="mt-1 text-sm text-text-secondary">{state === 'populated' ? 'Next to chase · 6 remaining in your queue' : 'Work through your actionable collection queue.'}</p>
      </div>
      {state === 'populated' ? <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_16rem]">
        <Card className="min-w-0 space-y-5 shadow-none sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-default pb-3">
            <p className="hidden text-xs text-text-secondary sm:block">Ranked by Yuohme · choose the appropriate contact method</p>
            <div className="flex gap-2" role="group" aria-label="Queue navigation">
              <Button variant="secondary" size="sm" className="min-h-11" disabled={saving || index === 0} onClick={() => select(index - 1)}>Previous</Button>
              <Button variant="secondary" size="sm" className="min-h-11" disabled={saving || index === customers.length - 1} onClick={() => select(index + 1)}>Next</Button>
            </div>
          </div>
          <QueueCustomer {...props} contextControl={<FounderContextControl customerName={props.name} value={props.adjustment}
            saving={false} onChange={level => setEvent(`Preview context selection: ${level}`)} />}>
            <QueueActionPanel disabled={saving} saving={saving} uncertain={uncertain} followUp={choice}
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
