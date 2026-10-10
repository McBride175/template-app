import { useState } from 'react'
import InvoicePromisePanel from '@/app/collections/customers/InvoicePromisePanel'
import PromiseManagementDialog from '@/app/promises/PromiseManagementDialog'
import type { PromiseWorklistRow } from '@/lib/collections/promise-worklist'
import { invoiceFixture } from './customerFixture'

/** Controlled synthetic view only: real shared panel, no live controller, session or API. */
export default function PromiseManagementPreview({ row, onClose, onSaved }: { row: PromiseWorklistRow; onClose: () => void; onSaved: (row: PromiseWorklistRow) => void }) {
  const [current, setCurrent] = useState({ ...row, revision: '3' }), [editing, setEditing] = useState(false), [historyOpen, setHistoryOpen] = useState(false)
  const [amount, setAmount] = useState(row.promisedAmountNative ?? ''), [date, setDate] = useState(row.promisedDate ?? ''), [note, setNote] = useState(row.note ?? '')
  const [message, setMessage] = useState<string | null>(null), [events, setEvents] = useState(false)
  const active = current.status === 'active' ? current : null, cancellation = Boolean(active && !amount.trim())
  const invoice = { ...invoiceFixture, invoiceSourceId: row.invoiceSourceId, invoiceNumber: row.invoiceReference, currencyCode: row.currencyCode, activePromise: active ? { ...active, status: 'active' as const, activeCoverageAmountNative: null } : null, activePromisedCoverageAmountNative: null }
  return <PromiseManagementDialog title={row.customerName ?? 'Customer'} invoiceLabel={row.invoiceReference} blocked={false} onClose={onClose}>
    <InvoicePromisePanel id="synthetic-management" invoice={invoice} active={active} current={current} editing={editing} eligible={false} locked={false} saving={false} cancellation={cancellation} editCloseLabel="Cancel edit" showCancellation
      amount={amount} date={date} note={note} setAmount={setAmount} setDate={setDate} setNote={setNote}
      fieldErrors={{}} error={null} message={message} refreshNeeded={false} historyOpen={historyOpen} historyLoading={false} historyError={null} eventLoading={null}
      history={[{ promise: current, events: events ? [] : null }]} loadEvents={() => setEvents(true)} showHistory={() => setHistoryOpen(!historyOpen)} refreshSaved={() => {}}
      open={() => setEditing(true)} close={() => setEditing(false)} save={event => {
        event.preventDefault(); const next = { ...current, promisedAmountNative: cancellation ? current.promisedAmountNative : amount, promisedDate: date, note, status: cancellation ? 'cancelled' as const : current.status }
        setCurrent(next); onSaved(next); setEditing(false); setMessage('Synthetic save confirmed. No financial request made.')
      }} />
    <p className="mt-3 text-xs text-text-secondary">Synthetic interaction preview. No accounting access.</p>
  </PromiseManagementDialog>
}
