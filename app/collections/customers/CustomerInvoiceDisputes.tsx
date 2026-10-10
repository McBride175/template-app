'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { compareDecimalValues, normalizeDecimalValue } from '@/lib/money/currency'
import type { FinancialMutationReconciliation } from '@/lib/collections/financial-mutation-reconciliation-server'
import { mountedFinancialQueueWindow } from '@/lib/collections/promise-refresh'

import DisputeManagementPanel from './DisputeManagementPanel'
import InvoiceFrame from './InvoiceFrame'
import InvoiceDetails from './InvoiceDetails'
import { actionStyles } from '@/app/components/ui/actionStyles'
import EmptyState from '@/app/components/ui/EmptyState'
import Spinner from '@/app/components/ui/Spinner'
import InvoicePromise from './InvoicePromise'
import type { InvoiceDisputeView as InvoiceRow } from '@/lib/collections/invoice-dispute-view'

interface ApiResponse {
  ok?: boolean
  invoices?: InvoiceRow[]
  error?: string
  code?: string
  dispute?: { dispute_mode: 'full' | 'partial'; recorded_disputed_amount_native: string; note: string | null; is_active: boolean; revision: number | string }
  reconciliation?: FinancialMutationReconciliation
}


function isBulkEligible(invoice: InvoiceRow) {
  return invoice.invoiceState === 'open' && !invoice.isResolved
}

const actionClass = actionStyles({ variant: 'secondary', className: 'min-h-11 whitespace-normal text-left' })

interface InvoiceDisputeListProps {
  tenantId: string
  customerSourceId: string
  customerName: string
  onPromiseChanged?: () => Promise<boolean>
  onChanged: () => Promise<boolean>
  onMutationStarted: () => number | void
  onMutationPending: (message: string) => void
  onMutationResult: (refreshed: boolean, message: string) => void
  onMutationError?: (message: string) => void
  onReconciled?: (result: FinancialMutationReconciliation, sequence?: number) => Promise<boolean>
}

export default function CustomerInvoiceDisputes(props: InvoiceDisputeListProps) {
  const { tenantId, customerSourceId, onPromiseChanged } = props
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ tenantId, customerSourceId })
      const response = await fetch(`/api/collections/invoice-disputes?${params}`, {
        credentials: 'include', cache: 'no-store',
      })
      const body = await response.json().catch(() => null) as ApiResponse | null
      if (!response.ok || !body?.ok) throw new Error(body?.error || 'Could not load invoices.')
      setInvoices(body.invoices ?? [])
      return true
    } catch (cause) {
      setInvoices([])
      setError(cause instanceof Error ? cause.message : 'Could not load invoices.')
      return false
    } finally {
      setLoading(false)
    }
  }, [tenantId, customerSourceId])

  const refreshPromise = useCallback(async (invoiceSourceId: string) => {
    const params = new URLSearchParams({ tenantId, customerSourceId, invoiceSourceId })
    const invoiceRefresh = (async () => {
      const response = await fetch(`/api/collections/invoice-disputes?${params}`, { credentials: 'include', cache: 'no-store' })
      const body = await response.json() as ApiResponse
      if (!response.ok || !body.ok || !body.invoices?.length) return false
      const updated = body.invoices.find(invoice => invoice.invoiceSourceId === invoiceSourceId)
      if (!updated) return false
      setInvoices(current => current.map(invoice => invoice.invoiceSourceId === invoiceSourceId ? updated : invoice))
      return true
    })()
    const results = await Promise.allSettled([invoiceRefresh, onPromiseChanged?.() ?? Promise.resolve(true)])
    return results.every(result => result.status === 'fulfilled' && result.value === true)
  }, [tenantId, customerSourceId, onPromiseChanged])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => {
    if (loading || typeof window === 'undefined' || !window.location.hash.startsWith('#invoice-')) return
    try {
      document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView({ block: 'start' })
    } catch { /* Ignore malformed external fragments. */ }
  }, [invoices, loading])
  return <InvoiceDisputeList {...props} invoices={invoices} loading={loading}
    loadError={error} reload={reload} onPromiseRefresh={props.onPromiseChanged ? refreshPromise : undefined} />
}

/** Shared native editor and revision-safe mutation flow; data loading belongs to its surface. */
export function InvoiceDisputeList({
  tenantId, customerSourceId, customerName, onChanged, onMutationStarted,
  onMutationPending, onMutationResult, invoices, loading = false, loadError = null,
  reload, showBulkActions = true, disabled = false, onMutationError, onPromiseRefresh, onReconciled, workspace = false, managementOnly = false, onInteractionChange, onCommitted,
}: InvoiceDisputeListProps & {
  invoices: InvoiceRow[]
  loading?: boolean
  loadError?: string | null
  reload: () => Promise<boolean>
  showBulkActions?: boolean
  disabled?: boolean
  workspace?: boolean
  onPromiseRefresh?: (invoiceId: string) => Promise<boolean>
  managementOnly?: boolean
  onInteractionChange?: (state: { editing: boolean; saving: boolean; uncertain: boolean }) => void
  onCommitted?: (record: { dispute_mode: 'full' | 'partial'; recorded_disputed_amount_native: string; note: string | null; is_active: boolean; revision: number | string }, operation: string) => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null)
  const [mode, setMode] = useState<'full' | 'partial'>('full')
  const [partialAmount, setPartialAmount] = useState('')
  const [note, setNote] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [editingRevision, setEditingRevision] = useState<string | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const pending = useRef(false)
  useEffect(() => { setSelectedIds([]) }, [invoices])
  useEffect(() => { onInteractionChange?.({ editing: Boolean(editingId || noteEditingId), saving, uncertain }) }, [editingId, noteEditingId, saving, uncertain, onInteractionChange])
  async function checkCurrent() {
    if (pending.current) return
    pending.current = true; setSaving(true)
    const refreshed = await reload().catch(() => false)
    const summary = await onChanged().catch(() => false)
    if (refreshed && summary) {
      setUncertain(false); setEditingId(null); setNoteEditingId(null); setError(null)
      onMutationResult(true, 'Current dispute loaded. Review its recorded state before making another change; the earlier response was not confirmed.')
    } else onMutationPending('The earlier save is unconfirmed and current details could not be loaded. Check again before making another change.')
    pending.current = false; setSaving(false)
  }

  async function mutate(operation: string, fields: Record<string, unknown>, success: string) {
    if (pending.current || saving || disabled || uncertain) return
    pending.current = true
    let confirmed = false, unconfirmed = true
    const sequence = onMutationStarted()
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/collections/invoice-disputes', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, tenantId, ...fields,
          ...(onReconciled ? { reconcile: true, queue: mountedFinancialQueueWindow(tenantId) } : {}) }),
      })
      const body = await response.json().catch(() => null) as ApiResponse | null
      const changedAccounting = response.status === 409 &&
        (body?.code === 'invalid_amount' || body?.code === 'invalid_invoice')
      const missingInvoice = response.status === 404 && body?.code === 'not_found'
      if ((response.status === 409 && body?.code === 'conflict') || changedAccounting || missingInvoice) {
        const message = body?.error || 'This dispute or invoice changed. Review the latest version before saving.'
        onMutationPending(message)
        setEditingId(null)
        setNoteEditingId(null)
        const invoiceRefresh = await reload().catch(() => false)
        const summaryRefresh = await onChanged().catch(() => false)
        onMutationResult(invoiceRefresh && summaryRefresh, message)
        return
      }
      unconfirmed = !body || response.status >= 500 || (response.ok && !body.ok)
      if (!response.ok || !body?.ok) {
        if (managementOnly && unconfirmed) {
          setUncertain(true); onMutationPending('Save response unconfirmed. Check the current dispute before making another change.'); return
        }
        throw new Error(body?.error || 'Could not save the dispute.')
      }
      const record = body.dispute
      if (managementOnly && (!record || !['full', 'partial'].includes(record.dispute_mode) ||
        typeof record.is_active !== 'boolean' || typeof record.recorded_disputed_amount_native !== 'string' ||
        normalizeDecimalValue(record.recorded_disputed_amount_native) === null || record.revision == null)) {
        setUncertain(true); onMutationPending('Save response incomplete. Check the current dispute before making another change.'); return
      }
      confirmed = true
      if (body.dispute) onCommitted?.(body.dispute, operation)
      setEditingId(null)
      setNoteEditingId(null)
      if (onReconciled && body.reconciliation) {
        const ready = await onReconciled(body.reconciliation, typeof sequence === 'number' ? sequence : undefined).catch(() => false)
        onMutationResult(ready, ready ? success :
          'Dispute saved, but current balances are not ready. Refresh the details before making further changes.')
        return
      }
      onMutationPending('Dispute saved. Refreshing current balances…')
      setEditingId(null)
      setNoteEditingId(null)
      const invoicesRefreshed = await reload().catch(() => false)
      const summaryRefreshed = await onChanged().catch(() => false)
      onMutationResult(invoicesRefreshed && summaryRefreshed,
        invoicesRefreshed && summaryRefreshed ? success :
          'Dispute saved, but current balances could not be refreshed. Refresh the page before making further changes.')
    } catch (cause) {
      if (confirmed) { onMutationResult(false, 'Dispute saved, but current details could not be refreshed. Restore current details before another change.'); return }
      if (managementOnly && unconfirmed) {
        setUncertain(true); onMutationPending('Save response unconfirmed. Check the current dispute before making another change.'); return
      }
      const message = cause instanceof Error ? cause.message : 'Could not save the dispute.'
      setError(message)
      onMutationError?.(message)
    } finally {
      pending.current = false; setSaving(false)
    }
  }

  function startEdit(invoice: InvoiceRow) {
    setEditingId(invoice.invoiceSourceId)
    setNoteEditingId(null)
    setMode(invoice.disputeMode ?? 'full')
    setPartialAmount(invoice.disputeMode === 'partial' ? invoice.recordedDisputedAmountNative ?? '' : '')
    setNote(invoice.note ?? '')
    setEditingRevision(invoice.revision)
    setError(null)
  }

  function startNoteEdit(invoice: InvoiceRow) {
    setEditingId(null)
    setNoteEditingId(invoice.invoiceSourceId)
    setNote(invoice.note ?? '')
    setEditingRevision(invoice.revision)
    setError(null)
  }

  function save(invoice: InvoiceRow) {
    if (mode === 'partial') {
      if (!/^\d+(?:\.\d{1,8})?$/.test(partialAmount.trim()) || compareDecimalValues(partialAmount.trim(), '0') !== 1 ||
        compareDecimalValues(partialAmount.trim(), invoice.currentAmountDueNative) === null ||
        compareDecimalValues(partialAmount.trim(), invoice.currentAmountDueNative) === 1) {
        setError('Enter a positive amount no greater than the current invoice balance.')
        return
      }
    }
    void mutate(mode, {
      invoiceSourceId: invoice.invoiceSourceId,
      ...(mode === 'partial' ? { disputedAmountNative: partialAmount.trim() } : {}),
      note,
      ...(editingRevision ? { expected_revision: editingRevision } : {}),
    }, 'Dispute saved. Collection amounts have been refreshed.')
  }

  const bulkEligibleInvoices = invoices.filter(isBulkEligible)
  const bulkEligibleIds = bulkEligibleInvoices.map((invoice) => invoice.invoiceSourceId)
  const eligibleSelectedIds = bulkEligibleIds.filter((id) => selectedIds.includes(id))
  const revisionEntries = (ids: string[]) => bulkEligibleInvoices
    .filter((invoice) => ids.includes(invoice.invoiceSourceId) && invoice.revision)
    .map((invoice) => ({ invoiceSourceId: invoice.invoiceSourceId, revision: invoice.revision }))

  if (managementOnly) return <div className="min-w-0 space-y-3">
    {(error || loadError) && <p role="alert" className="text-sm text-feedback-error">{error || loadError}</p>}
    {invoices.map(invoice => <DisputeManagementPanel key={invoice.invoiceSourceId} {...{ invoice, showBulkActions: false, noteEditingId, editingId, mode, partialAmount, note, saving, disabled: disabled || uncertain, editingRevision, setMode, setPartialAmount, setNote, setNoteEditingId, setEditingId, startEdit, startNoteEdit, save, mutate }} />)}
    {uncertain && <button type="button" className={actionClass} disabled={saving} onClick={() => void checkCurrent()}>Check current dispute</button>}
  </div>

  return (
    <section aria-label={`Invoices for ${customerName}`} className={workspace ? 'min-w-0 space-y-3' : 'space-y-4 bg-gray-50 p-4'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-text-primary">{workspace ? `Invoices (${invoices.length})` : `Invoices for ${customerName}`}</h3>
          <p className="text-xs text-text-secondary">Amounts use invoice currency.{workspace ? ' Customer To chase includes applicable customer credit.' : ''}</p>
        </div>
        <button type="button" className={actionClass} onClick={() => void reload()} disabled={loading || saving || disabled}>Refresh invoices</button>
      </div>
      {(error || loadError) && <p role="alert" className="text-sm text-feedback-error">{error || loadError}</p>}
      {loading ? <div role="status" className="flex items-center gap-2 py-4 text-sm"><Spinner label={null} />Loading invoices…</div> : invoices.length === 0 ? (
        <EmptyState title="No invoices to review" description="No current or previously disputed invoices are available for this customer." />
      ) : (
        <>
          {showBulkActions && bulkEligibleInvoices.length > 0 && (
            <InvoiceDetails compact label={eligibleSelectedIds.length ? `Bulk actions · ${eligibleSelectedIds.length} selected` : 'Bulk actions'}><div className="flex flex-wrap items-center gap-2 pb-3">
              <button type="button" className={actionClass} disabled={saving || disabled || eligibleSelectedIds.length === 0}
                onClick={() => void mutate('bulk_full', { customerSourceId, invoiceSourceIds: eligibleSelectedIds,
                  expectedRevisions: revisionEntries(eligibleSelectedIds) }, `${eligibleSelectedIds.length} invoice disputes saved.`)}>
                Dispute selected in full ({eligibleSelectedIds.length})
              </button>
              <button type="button" className={actionClass} disabled={saving || disabled}
                onClick={() => void mutate('bulk_full', { customerSourceId, invoiceSourceIds: bulkEligibleIds,
                  expectedRevisions: revisionEntries(bulkEligibleIds) },
                  `${bulkEligibleIds.length} invoice disputes saved.`)}>
                Dispute all eligible current invoices in full ({bulkEligibleIds.length})
              </button>
            </div></InvoiceDetails>
          )}
          <div className="min-w-0 border-t border-border-default">
            {invoices.map((invoice) => (
              <InvoiceFrame key={invoice.invoiceSourceId} invoice={invoice} defaultExpanded={!workspace} selection={showBulkActions && isBulkEligible(invoice) ?
                <label className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center"><input type="checkbox" className="h-5 w-5 shrink-0 accent-action-primary focus-visible:outline-2 focus-visible:outline-focus"
                  aria-label={`Select invoice ${invoice.invoiceNumber || invoice.invoiceSourceId} for full dispute`}
                  checked={selectedIds.includes(invoice.invoiceSourceId)} disabled={saving || disabled}
                  onChange={event => setSelectedIds(current => event.target.checked ? [...current, invoice.invoiceSourceId] : current.filter(id => id !== invoice.invoiceSourceId))} /></label> : undefined}>
                <DisputeManagementPanel {...{ invoice, showBulkActions, noteEditingId, editingId, mode, partialAmount, note, saving, disabled, editingRevision, setMode, setPartialAmount, setNote, setNoteEditingId, setEditingId, startEdit, startNoteEdit, save, mutate }} />
                {onPromiseRefresh && <InvoicePromise invoice={invoice} tenantId={tenantId} onRefresh={onPromiseRefresh} onReconciled={onReconciled} onMutationStarted={onMutationStarted} onReconciliationUnavailable={() => onMutationResult(false, 'Promise saved, but current balances are not ready. Refresh the details before making further changes.')} disabled={disabled || saving} />}
              </InvoiceFrame>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
