import type { InvoiceDisputeView as InvoiceRow } from '@/lib/collections/invoice-dispute-view'
import { actionStyles } from '@/app/components/ui/actionStyles'
import { fieldStyles } from '@/app/components/ui/fieldStyles'
import { promiseMoney as amount } from '@/lib/collections/promise-presentation'
const inputClass = fieldStyles('min-h-11 min-w-0 max-w-full')
const actionClass = actionStyles({ variant: 'secondary', className: 'min-h-11 whitespace-normal text-left' })
export interface DisputeManagementPanelProps {
 invoice: InvoiceRow; showBulkActions: boolean; noteEditingId: string | null; editingId: string | null
 mode: 'full' | 'partial'; partialAmount: string; note: string; saving: boolean; disabled: boolean; editingRevision: string | null
 setMode: (value: 'full' | 'partial') => void; setPartialAmount: (value: string) => void; setNote: (value: string) => void
 setNoteEditingId: (value: string | null) => void; setEditingId: (value: string | null) => void
 startEdit: (invoice: InvoiceRow) => void; startNoteEdit: (invoice: InvoiceRow) => void; save: (invoice: InvoiceRow) => void
 mutate: (operation: string, fields: Record<string, unknown>, success: string) => Promise<void>
}
/** Controlled presentation; the existing InvoiceDisputeList owns every command. */
export default function DisputeManagementPanel({ invoice, showBulkActions, noteEditingId, editingId, mode, partialAmount, note, saving, disabled, editingRevision, setMode, setPartialAmount, setNote, setNoteEditingId, setEditingId, startEdit, startNoteEdit, save, mutate }: DisputeManagementPanelProps) {
 return (<section aria-label="Dispute management" className="min-w-0 text-sm">
  <h5 className="font-semibold text-text-primary">Dispute</h5>
  {showBulkActions && invoice.invoiceState === 'open' && invoice.isResolved && (
    <p className="mt-2 text-xs text-text-secondary">Resolved — reactivate before disputing again.</p>
  )}
  {noteEditingId === invoice.invoiceSourceId ? (
    <div className="mt-3 space-y-2 border-t border-border-default pt-3">
      <label className="flex max-w-xl flex-col gap-1">Dispute note
        <textarea className={inputClass} disabled={saving || disabled} maxLength={2000} rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={actionClass} disabled={saving || disabled} onClick={() => void mutate('note', {
          disputeId: invoice.disputeId, expected_revision: editingRevision, note,
        }, 'Note saved.')}>Save note</button>
        <button type="button" className={actionClass} disabled={saving || disabled} onClick={() => setNoteEditingId(null)}>Cancel</button>
      </div>
    </div>
  ) : editingId === invoice.invoiceSourceId && invoice.invoiceState === 'open' ? (
    <div className="mt-3 space-y-3 border-t border-border-default pt-3">
      <fieldset disabled={saving || disabled} className="flex flex-wrap gap-4">
        <legend className="mb-1 font-medium">Disputed amount</legend>
        <label className="flex min-h-11 min-w-0 items-center gap-2"><input type="radio" name={`mode-${invoice.invoiceSourceId}`} checked={mode === 'full'} onChange={() => setMode('full')} />Dispute full outstanding amount ({amount(invoice.currentAmountDueNative, invoice.currencyCode)})</label>
        <label className="flex min-h-11 min-w-0 items-center gap-2"><input type="radio" name={`mode-${invoice.invoiceSourceId}`} checked={mode === 'partial'} onChange={() => setMode('partial')} />Dispute part</label>
      </fieldset>
      {mode === 'partial' && <label className="flex max-w-xs flex-col gap-1">Partial disputed amount ({invoice.currencyCode})
        <input className={inputClass} disabled={saving || disabled} type="text" inputMode="decimal" required value={partialAmount} onChange={(event) => setPartialAmount(event.target.value)} placeholder="0.00" />
      </label>}
      <label className="flex max-w-xl flex-col gap-1">Optional note
        <textarea className={inputClass} disabled={saving || disabled} maxLength={2000} rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={actionClass} disabled={saving || disabled} onClick={() => save(invoice)}>{saving ? 'Saving…' : 'Save dispute'}</button>
        <button type="button" className={actionClass} disabled={saving || disabled} onClick={() => setEditingId(null)}>Cancel</button>
      </div>
    </div>
  ) : (
    <div className="mt-3 flex flex-wrap gap-2">
      {invoice.invoiceState === 'open' && !invoice.isResolved && (
        <button type="button" className={actionClass} disabled={saving || disabled} onClick={() => startEdit(invoice)}>{invoice.isActive ? 'Edit dispute' : 'Mark disputed'}</button>
      )}
      {invoice.isActive && invoice.disputeId && (
        <button type="button" className={actionClass} disabled={saving || disabled} onClick={() => void mutate('resolve', {
          disputeId: invoice.disputeId, expected_revision: invoice.revision,
        }, 'Dispute resolved.')}>Resolve dispute</button>
      )}
      {invoice.needsReview && invoice.disputeId && (
        <button type="button" className={actionClass} disabled={saving || disabled} onClick={() => void mutate('confirm', {
          disputeId: invoice.disputeId, expected_revision: invoice.revision,
        }, 'Dispute confirmed against the current balance.')}>Keep as is</button>
      )}
      {invoice.isResolved && invoice.invoiceState === 'open' && invoice.disputeId && (
        <button type="button" className={actionClass} disabled={saving || disabled} onClick={() => void mutate('reactivate', {
          disputeId: invoice.disputeId, expected_revision: invoice.revision,
        }, 'Dispute reactivated.')}>Reactivate dispute</button>
      )}
      {invoice.disputeId && (
        <button type="button" className={actionClass} disabled={saving || disabled} onClick={() => startNoteEdit(invoice)}>Edit note</button>
      )}
    </div>
  )}
  {(invoice.disputeId || invoice.note) && <details className="mt-2"><summary className="min-h-11 cursor-pointer py-3 text-xs text-text-secondary focus-visible:outline-2 focus-visible:outline-focus">Dispute record & note</summary>
  {invoice.disputeId && (
    <p className="mt-2 break-words text-xs text-text-secondary [overflow-wrap:anywhere]">Recorded dispute: {amount(invoice.recordedDisputedAmountNative, invoice.currencyCode)}{invoice.disputeMode === 'full' ? ' (full amount intent)' : ''}</p>
  )}
  {invoice.note && editingId !== invoice.invoiceSourceId && noteEditingId !== invoice.invoiceSourceId && <p className="mt-2 whitespace-pre-wrap break-words text-text-primary [overflow-wrap:anywhere]">Note: {invoice.note}</p>}
  </details>}
  </section>)
}
