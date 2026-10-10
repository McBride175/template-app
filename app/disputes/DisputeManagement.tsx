'use client'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import ManagementDialog from '@/app/components/ui/ManagementDialog'
import Button from '@/app/components/ui/Button'
import Alert from '@/app/components/ui/Alert'
import Spinner from '@/app/components/ui/Spinner'
import { actionStyles } from '@/app/components/ui/actionStyles'
import { InvoiceDisputeList } from '@/app/collections/customers/CustomerInvoiceDisputes'
import type { InvoiceDisputeView } from '@/lib/collections/invoice-dispute-view'
import type { FinancialMutationReconciliation } from '@/lib/collections/financial-mutation-reconciliation-server'
import { notifyPromiseActionabilityChanged } from '@/lib/collections/promise-refresh'
import { disputeCustomerHref, type DisputeWorklistRow, type DisputeWorklistResponse } from '@/lib/collections/dispute-worklist'
import { promiseMoney } from '@/lib/collections/promise-presentation'
import { disputeReference, disputeStatus, disputeWarning } from './dispute-presentation'

type Interaction = { editing: boolean; saving: boolean; uncertain: boolean }
type Saved = { dispute_mode: 'full' | 'partial'; recorded_disputed_amount_native: string; note: string | null; is_active: boolean; revision: number | string }
export default function DisputeManagement({ row, tenantId, returnHref, onReload, onClose, onBusy }: {
 row: DisputeWorklistRow; tenantId: string; returnHref: string; onReload: () => Promise<DisputeWorklistResponse | null>
 onClose: () => void; onBusy: (value: boolean) => void
}) {
 const [invoice, setInvoice] = useState<InvoiceDisputeView | null>(row.customerSourceId && !['unavailable', 'invalid'].includes(row.invoiceState) ? null : row)
 const [customerId, setCustomerId] = useState(row.customerSourceId)
 const [investigationAvailable, setInvestigationAvailable] = useState(Boolean(row.customerHref))
 const [error, setError] = useState<string | null>(null), [outcome, setOutcome] = useState<{ stale: boolean; message: string; warning?: boolean } | null>(null)
 const [interaction, setInteraction] = useState<Interaction>({ editing: false, saving: false, uncertain: false })
 const [saved, setSaved] = useState<Saved | null>(null)
 const operationalOnly = !customerId || ['unavailable', 'invalid'].includes(invoice?.invoiceState ?? row.invoiceState)
 const pending = useRef<AbortController | null>(null), sequence = useRef(0), mounted = useRef(true), operation = useRef('')
 const changed = useCallback((value: Interaction) => { setInteraction(value); onBusy(value.saving || value.uncertain) }, [onBusy])
 const load = useCallback(async () => {
  if (!mounted.current) return false
  if (operationalOnly) {
   const list = await onReload(), found = list?.rows.find(value => value.disputeId === row.disputeId && value.invoiceSourceId === row.invoiceSourceId)
   if (found && mounted.current) { setInvoice(found); setCustomerId(found.customerSourceId); setInvestigationAvailable(Boolean(found.customerHref)); setSaved(null); return true }
   return false
  }
  pending.current?.abort(); const controller = new AbortController(), version = ++sequence.current; pending.current = controller; setError(null)
  try {
   const params = new URLSearchParams({ tenantId, customerSourceId: customerId!, invoiceSourceId: row.invoiceSourceId })
   const response = await fetch(`/api/collections/invoice-disputes?${params}`, { credentials: 'include', cache: 'no-store', signal: controller.signal })
   const body = await response.json(), found = body.invoices?.find((value: InvoiceDisputeView) => value.invoiceSourceId === row.invoiceSourceId && value.disputeId === row.disputeId)
   if (!response.ok || !body.ok || !found) throw new Error('Current dispute details could not be loaded. Retry to review this record safely.')
   if (!mounted.current || controller.signal.aborted || version !== sequence.current) return false
   setInvoice(found); setSaved(null); return true
  } catch (cause) { if (mounted.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load this dispute.'); return false }
 }, [onReload, tenantId, customerId, row.invoiceSourceId, row.disputeId, operationalOnly])
 useEffect(() => { mounted.current = true; if (!operationalOnly) void load(); return () => { mounted.current = false; pending.current?.abort() } }, [load, operationalOnly])
 useEffect(() => () => onBusy(false), [onBusy])
 useEffect(() => {
  if (!interaction.editing && !interaction.saving && !interaction.uncertain) return
  const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
  window.addEventListener('beforeunload', protect); return () => window.removeEventListener('beforeunload', protect)
 }, [interaction])
 const blocked = interaction.saving || interaction.uncertain
 const close = () => { if (blocked || (interaction.editing && !window.confirm('Discard unsaved dispute changes?'))) return; onClose() }
 const href = disputeCustomerHref({ ...row, customerSourceId: customerId, customerHref: investigationAvailable ? row.customerHref ?? '/customers' : null }, tenantId, returnHref)
 const reconcile = async (result: FinancialMutationReconciliation) => {
  if (!mounted.current) return false
  // An accounting-unavailable record has no financial reconciliation to assert.
  // Existing note/resolution operations recover the owned operational record only.
  if (operationalOnly) return load()
  if (result.tenantId !== tenantId || result.customerSourceId !== customerId) return false
  const current = result.reconciliationReady ? result.detail.invoices.find(value => value.invoiceSourceId === row.invoiceSourceId && value.disputeId === row.disputeId) : null
  if (current) { setInvoice(current); setSaved(null) }
  if (result.reconciliationReady && !['note', 'confirm'].includes(operation.current)) notifyPromiseActionabilityChanged(tenantId, result)
  // One read of the current worklist; the manager remains mounted if the row leaves its filter.
  const list = await onReload()
  if (!current && result.reconciliationReady) return false
  return Boolean(current && list)
 }
 return <ManagementDialog title={row.customerName ?? 'Customer unavailable'} invoiceLabel={disputeReference(row)} blocked={blocked} onClose={close}
  closeLabel="Close dispute management" returnFocusSelector="[data-dispute-heading]" blockedMessage="Keep this panel open while the save is pending. If its response is uncertain, check the current dispute before another operation.">
  {error && <Alert variant="warning" role="alert">{error}{!invoice && <Button className="mt-2 min-h-11" variant="secondary" onClick={() => void load()}>Retry dispute details</Button>}</Alert>}
  {!invoice && !error && <p role="status" className="flex min-h-20 items-center gap-2 text-sm"><Spinner label={null} />Loading current dispute…</p>}
  {invoice && <>
   {disputeWarning(invoice) && <Alert variant="warning">{disputeWarning(invoice)}</Alert>}
   <div className="mb-3 mt-3 grid min-w-0 grid-cols-2 gap-x-3 gap-y-1 text-sm"><div><p className="break-words font-semibold tabular-nums text-text-primary [overflow-wrap:anywhere]">{promiseMoney(invoice.effectiveDisputedAmountNative, invoice.currencyCode)}</p><p className="text-xs text-text-secondary">Effective disputed · {invoice.currencyCode ?? 'Currency unavailable'}</p></div><div><p className="break-words font-semibold tabular-nums text-text-primary [overflow-wrap:anywhere]">{promiseMoney(invoice.currentAmountDueNative, invoice.currencyCode)}</p><p className="text-xs text-text-secondary">Current outstanding</p></div><p className="col-span-2 text-xs text-text-secondary">{disputeStatus(invoice)}{saved ? ' · Last loaded figures; saved record below' : ''}</p></div>
   {saved && <p role="status" className="mb-3 break-words text-sm [overflow-wrap:anywhere]">Saved record: {saved.is_active ? `${saved.dispute_mode === 'full' ? 'Full' : 'Partial'} dispute` : 'Resolved by user'} · recorded {promiseMoney(saved.recorded_disputed_amount_native, invoice.currencyCode)}{saved.note ? ` · ${saved.note}` : ''}. Current effective amounts require refreshed accounting context.</p>}
   {outcome && <Alert role={outcome.stale ? 'alert' : 'status'} variant={outcome.stale || outcome.warning ? 'warning' : 'success'}>{outcome.message}
     {outcome.stale && !interaction.uncertain && <Button variant="secondary" className="mt-2 min-h-11" disabled={interaction.saving} onClick={async () => { const ready = await load(); const list = !operationalOnly ? await onReload() : ready; if (ready && list) setOutcome({ stale: false, message: 'Current dispute details restored. Review before continuing.' }) }}>Restore current details</Button>}
   </Alert>}
   <InvoiceDisputeList managementOnly tenantId={tenantId} customerSourceId={customerId ?? ''} customerName={row.customerName ?? 'Customer unavailable'} invoices={[invoice]} showBulkActions={false}
    disabled={Boolean(outcome?.stale)} reload={load} onChanged={async () => !operationalOnly ? Boolean(await onReload()) : true} onReconciled={reconcile}
    onInteractionChange={changed} onCommitted={(record, op) => { operation.current = op; if (mounted.current && record) setSaved({ dispute_mode: record.dispute_mode, recorded_disputed_amount_native: record.recorded_disputed_amount_native, note: record.note, is_active: record.is_active, revision: record.revision }) }}
    onMutationStarted={() => { onBusy(true); setOutcome(null) }} onMutationPending={message => setOutcome({ stale: true, message, warning: true })}
    onMutationResult={(ready, message) => setOutcome(previous => ({ stale: !ready, message, warning: previous?.warning }))} onMutationError={message => setOutcome({ stale: false, message, warning: true })} />
   <details className="mt-3 border-t border-border-default"><summary className="min-h-11 cursor-pointer py-3 text-xs font-medium text-text-secondary focus-visible:outline-2 focus-visible:outline-focus">Invoice context</summary><div className="space-y-1 text-sm text-text-secondary"><p>Due {invoice.dueDate ?? 'Unavailable'}</p><p>Promise coverage: {promiseMoney(invoice.activePromisedCoverageAmountNative, invoice.currencyCode)}</p><p>Invoice amount after dispute & Promise coverage: {promiseMoney(invoice.toChaseAmountNative ?? invoice.collectibleAmountNative, invoice.currencyCode)}. Customer-level credit is separate.</p>{row.contextFromPreviousSnapshot && <p>Some identity labels are last-known accounting context; unavailable balances are not restored from historical snapshots.</p>}</div></details>
  </>}
  {href && <Link href={href} aria-disabled={blocked || undefined} tabIndex={blocked ? -1 : undefined} onClick={event => { if (blocked || (interaction.editing && !window.confirm('Discard unsaved dispute changes and view the invoice?'))) event.preventDefault() }} className={actionStyles({ variant: 'ghost', className: 'mt-3 min-h-11 px-0 underline' })}>View invoice in Customers</Link>}
 </ManagementDialog>
}
