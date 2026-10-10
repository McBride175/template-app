import type { FormEvent, RefObject } from 'react'
import PromiseCommitment from './PromiseCommitment'
import type { InvoiceDisputeView } from '@/lib/collections/invoice-dispute-view'
import { promiseDate, promiseEventText, promiseMoney, promiseOutcome, type PromiseView, type PromiseEventView } from '@/lib/collections/promise-presentation'
import { actionStyles } from '@/app/components/ui/actionStyles'
import { fieldStyles } from '@/app/components/ui/fieldStyles'

const inputClass = fieldStyles('min-h-11 min-w-0 max-w-full')
const buttonClass = actionStyles({ variant: 'secondary', className: 'min-h-11 whitespace-normal' })

export interface InvoicePromisePanelProps {
  id: string; invoice: InvoiceDisputeView; active: PromiseView | null; current: PromiseView | null
  editing: boolean; cancellation: boolean; eligible: boolean; locked: boolean; saving: boolean
  amount: string; date: string; note: string; setAmount: (value: string) => void; setDate: (value: string) => void; setNote: (value: string) => void
  fieldErrors: Record<string, string>; error: string | null; message: string | null; refreshNeeded: boolean
  historyOpen: boolean; historyLoading: boolean; historyError: string | null; eventLoading: string | null
  history: Array<{ promise: PromiseView; events: PromiseEventView[] | null }>
  formRef?: RefObject<HTMLFormElement | null>; actionRef?: RefObject<HTMLButtonElement | null>
  open: () => void; save: (event: FormEvent) => void; close: () => void
  showHistory: () => void; loadEvents: (id: string) => void; refreshSaved: () => void
}

/** Controlled promise presentation; command/retry/lifecycle state stays in InvoicePromise. */
export default function InvoicePromisePanel({ id, invoice, active, current, editing, cancellation, eligible, locked, saving,
  amount, date, note, setAmount, setDate, setNote, fieldErrors, error, message, refreshNeeded, historyOpen,
  historyLoading, historyError, eventLoading, history, formRef, actionRef, open, save, close, showHistory, loadEvents, refreshSaved }: InvoicePromisePanelProps) {
  return <section aria-label={`Invoice promise for ${invoice.invoiceNumber || invoice.reference || invoice.invoiceSourceId}`} className="min-w-0 space-y-2 text-sm">
    <h5 className="font-semibold text-text-primary">Promise</h5>
    {editing ? <form ref={formRef} onSubmit={save} noValidate aria-busy={saving} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 sm:max-w-xl">
        <div><label htmlFor={`${id}-amount`} className="mb-1 block font-medium">Promise amount ({invoice.currencyCode})</label>
          <input id={`${id}-amount`} className={`${inputClass} w-full`} inputMode="decimal" autoComplete="off" maxLength={100} value={amount} onChange={event => setAmount(event.target.value)} disabled={saving}
            aria-invalid={Boolean(fieldErrors.amount)} aria-describedby={fieldErrors.amount ? `${id}-amount-error` : undefined} />
          {fieldErrors.amount && <p id={`${id}-amount-error`} className="mt-1 text-feedback-error">{fieldErrors.amount}</p>}
        </div>
        {!cancellation && <div><label htmlFor={`${id}-date`} className="mb-1 block font-medium">Promised date</label>
          <input id={`${id}-date`} className={`${inputClass} w-full`} type="date" value={date} onChange={event => setDate(event.target.value)} disabled={saving}
            aria-invalid={Boolean(fieldErrors.date)} aria-describedby={fieldErrors.date ? `${id}-date-error` : undefined} />
          {fieldErrors.date && <p id={`${id}-date-error`} className="mt-1 text-feedback-error">{fieldErrors.date}</p>}
        </div>}
      </div>
      {!cancellation && <div className="max-w-xl"><label htmlFor={`${id}-note`} className="mb-1 block">Optional promise note</label>
        <textarea id={`${id}-note`} className={`${inputClass} w-full`} rows={2} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} disabled={saving}
          aria-invalid={Boolean(fieldErrors.note)} aria-describedby={fieldErrors.note ? `${id}-note-error` : undefined} />
        {fieldErrors.note && <p id={`${id}-note-error`} className="mt-1 text-feedback-error">{fieldErrors.note}</p>}
      </div>}
      <div className="flex flex-wrap gap-2"><button type="submit" className={actionStyles({ className: 'min-h-11' })} disabled={locked}>{saving ? 'Saving…' : cancellation ? 'Cancel promise' : 'Save promise'}</button>
        <button type="button" className={buttonClass} disabled={saving} onClick={close}>Close</button></div>
    </form> : <div className="flex flex-wrap gap-2">
      {(active || eligible) && <button ref={actionRef} type="button" className={buttonClass} onClick={open} disabled={locked || Boolean(active && !active.revision)}>{active ? 'Edit promise' : current || history.length ? 'Record new promise' : 'Record promise'}</button>}
      <button type="button" className={buttonClass} onClick={() => void showHistory()} aria-expanded={historyOpen} aria-controls={`${id}-history`} disabled={saving || historyLoading}>Promise history</button>
    </div>}
    {current?.status === 'active' ? <details className="border-t border-border-default">
      <summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-text-secondary focus-visible:outline-2 focus-visible:outline-focus">Commitment details & note</summary>
      <PromiseCommitment invoice={invoice} current={current} editing={editing} />
    </details> : <PromiseCommitment invoice={invoice} current={current} editing={editing} />}
    {error && <p role="alert" className="text-feedback-error">{error}</p>}
    {message && <p role="status" aria-live="polite" className="text-text-secondary">{message}</p>}
    {refreshNeeded && <button type="button" className={buttonClass} disabled={saving} onClick={() => void refreshSaved()}>Refresh invoice details</button>}
    {historyOpen && <div id={`${id}-history`} className="space-y-3 pt-2" aria-label="Promise history">
      {historyLoading ? <p role="status">Loading promise history…</p> : history.length === 0 && !historyError ? <p className="text-text-secondary">No promises recorded.</p> : history.map(item => <div key={item.promise.id}>
        <p className="text-text-primary">{promiseMoney(item.promise.promisedAmountNative, item.promise.currencyCode ?? invoice.currencyCode)} by {promiseDate(item.promise.promisedDate)} · {promiseOutcome[item.promise.status]}</p>
        {item.promise.note && <p className="mt-1 break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-text-secondary">{item.promise.note}</p>}
        {item.events === null ? <button type="button" className="min-h-11 text-text-primary underline" disabled={eventLoading === item.promise.id} onClick={() => void loadEvents(item.promise.id)}>{eventLoading === item.promise.id ? 'Loading changes…' : 'Show changes'}</button>
          : <ol className="mt-2 space-y-2 border-l border-border-default pl-3">{[...item.events].sort((a, b) => BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1).map(event => <li key={event.id}>
            <p className="break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-text-primary">{promiseEventText(event, item.promise.currencyCode ?? invoice.currencyCode)}</p><p className="text-xs text-text-secondary">Recorded {promiseDate(event.occurredAt)}</p>
          </li>)}</ol>}
        {item.events?.length === 100 && <p className="mt-1 text-xs text-text-secondary">Showing the 100 most recent changes.</p>}
      </div>)}
      {history.length === 50 && <p className="text-xs text-text-secondary">Showing the 50 most recent commitments.</p>}
      {historyError && <p role="alert" className="text-feedback-error">{historyError}</p>}
    </div>}
  </section>
}
