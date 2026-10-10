import { useState } from 'react'
import ManagementDialog from '@/app/components/ui/ManagementDialog'
import DisputeManagementPanel from '@/app/collections/customers/DisputeManagementPanel'
import Alert from '@/app/components/ui/Alert'
import { promiseMoney } from '@/lib/collections/promise-presentation'
import { disputeCustomerHref } from '@/lib/collections/dispute-worklist'
import { disputeStatus, disputeWarning, disputeReference } from '@/app/disputes/dispute-presentation'
import type { DisputeWorklistRow } from '@/lib/collections/dispute-worklist'

export function SyntheticDisputePanel({ row, initialEditing = false }: { row: DisputeWorklistRow; initialEditing?: boolean }) {
 const [editingId, setEditingId] = useState<string | null>(initialEditing ? row.invoiceSourceId : null), [noteEditingId, setNoteEditingId] = useState<string | null>(null)
 const [mode, setMode] = useState<'full' | 'partial'>(row.disputeMode ?? 'full'), [partialAmount, setPartialAmount] = useState(row.recordedDisputedAmountNative ?? ''), [note, setNote] = useState(row.note ?? ''), [feedback, setFeedback] = useState('')
 const explain = async () => { setFeedback('Interaction preview only. No request was made and no dispute was saved.') }
 return <><DisputeManagementPanel {...{ invoice: row, showBulkActions: false, editingId, noteEditingId, mode, partialAmount, note, saving: false, disabled: false, editingRevision: row.revision, setMode, setPartialAmount, setNote, setEditingId, setNoteEditingId }}
  startEdit={() => { setEditingId(row.invoiceSourceId); setNoteEditingId(null) }} startNoteEdit={() => { setEditingId(null); setNoteEditingId(row.invoiceSourceId) }} save={() => void explain()} mutate={explain} />
 {feedback && <p role="status" className="mt-3 text-sm">{feedback}</p>}</>
}
export default function DisputeManagementPreview({ row, onClose, initialEditing = false }: { row: DisputeWorklistRow; onClose: () => void; initialEditing?: boolean }) {
 return <ManagementDialog title={row.customerName ?? 'Customer unavailable'} invoiceLabel={disputeReference(row)} blocked={false} onClose={onClose} closeLabel="Close dispute management" returnFocusSelector="[data-dispute-heading]" blockedMessage="Pending save preview">
  {disputeWarning(row) && <Alert variant="warning">{disputeWarning(row)}</Alert>}
  <div className="mb-3 mt-3 grid grid-cols-2 gap-3 text-sm"><div><p className="break-words font-semibold text-text-primary [overflow-wrap:anywhere]">{promiseMoney(row.effectiveDisputedAmountNative, row.currencyCode)}</p><p className="text-xs text-text-secondary">Effective disputed · {row.currencyCode}</p></div><div><p className="break-words font-semibold text-text-primary [overflow-wrap:anywhere]">{promiseMoney(row.currentAmountDueNative, row.currencyCode)}</p><p className="text-xs text-text-secondary">Current outstanding</p></div></div>
  <p className="mb-3 text-xs text-text-secondary">{disputeStatus(row)}</p><SyntheticDisputePanel row={row} initialEditing={initialEditing} />
  <details className="mt-3 border-t border-border-default"><summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-text-secondary focus-visible:outline-2 focus-visible:outline-focus">Invoice context</summary><div className="space-y-1 text-sm text-text-secondary"><p>Due {row.dueDate ?? 'Unavailable'}</p><p>Promise coverage: {promiseMoney(row.activePromisedCoverageAmountNative, row.currencyCode)}</p><p>Invoice amount after dispute & Promise coverage: {promiseMoney(row.toChaseAmountNative ?? row.collectibleAmountNative, row.currencyCode)}. Customer-level credit is separate.</p></div></details>
  {disputeCustomerHref(row, 'synthetic', '/disputes?tenantId=synthetic') && <a href={disputeCustomerHref(row, 'synthetic', '/disputes?tenantId=synthetic')!} className="mt-3 inline-flex min-h-11 items-center text-sm text-link underline">View invoice in Customers</a>}
 </ManagementDialog>
}
