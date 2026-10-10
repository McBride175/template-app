'use client'

import { useCallback, useEffect, useState } from 'react'

import type { FinancialMutationReconciliation } from '@/lib/collections/financial-mutation-reconciliation-server'
import { mountedFinancialQueueWindow } from '@/lib/collections/promise-refresh'

import InvoiceFrame from './InvoiceFrame'
import InvoiceDetails from './InvoiceDetails'
import { actionStyles } from '@/app/components/ui/actionStyles'
import { fieldStyles } from '@/app/components/ui/fieldStyles'
import EmptyState from '@/app/components/ui/EmptyState'
import Spinner from '@/app/components/ui/Spinner'
import InvoicePromise from './InvoicePromise'
import type { InvoiceDisputeView as InvoiceRow } from '@/lib/collections/invoice-dispute-view'

interface ApiResponse {
  ok?: boolean
  invoices?: InvoiceRow[]
  error?: string
  code?: string
  reconciliation?: FinancialMutationReconciliation
}

function amount(value: string | null, currencyCode: string | null) {
  if (value === null) return 'Unavailable'
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || !currencyCode) return `${value} ${currencyCode ?? ''}`.trim()
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: currencyCode,
      maximumFractionDigits: 8,
    }).format(numeric)
  } catch {
    return `${value} ${currencyCode}`
  }
}

function isBulkEligible(invoice: InvoiceRow) {
  return invoice.invoiceState === 'open' && !invoice.isResolved
}

const inputClass = fieldStyles('min-h-11 min-w-0 max-w-full')
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
  reload, showBulkActions = true, disabled = false, onMutationError, onPromiseRefresh, onReconciled, workspace = false,
}: InvoiceDisputeListProps & {
  invoices: InvoiceRow[]
  loading?: boolean
  loadError?: string | null
  reload: () => Promise<boolean>
  showBulkActions?: boolean
  disabled?: boolean
  workspace?: boolean
  onPromiseRefresh?: (invoiceId: string) => Promise<boolean>
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
  useEffect(() => { setSelectedIds([]) }, [invoices])

  async function mutate(operation: string, fields: Record<string, unknown>, success: string) {
    if (saving || disabled) return
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
        const invoiceRefresh = await reload()
        const summaryRefresh = await onChanged().catch(() => false)
        onMutationResult(invoiceRefresh && summaryRefresh, message)
        return
      }
      if (!response.ok || !body?.ok) throw new Error(body?.error || 'Could not save the dispute.')
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
      const invoicesRefreshed = await reload()
      const summaryRefreshed = await onChanged().catch(() => false)
      onMutationResult(invoicesRefreshed && summaryRefreshed,
        invoicesRefreshed && summaryRefreshed ? success :
          'Dispute saved, but current balances could not be refreshed. Refresh the page before making further changes.')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not save the dispute.'
      setError(message)
      onMutationError?.(message)
    } finally {
      setSaving(false)
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
      const entered = Number(partialAmount)
      const current = Number(invoice.currentAmountDueNative)
      if (!/^\d+(?:\.\d{1,8})?$/.test(partialAmount.trim()) || !Number.isFinite(entered) ||
        entered <= 0 || entered > current) {
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
            <InvoiceDetails compact={workspace} label={`Bulk invoice disputes (${eligibleSelectedIds.length} selected)`}><div className="flex flex-wrap items-center gap-2 pb-3">
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
          <div className="space-y-3">
            {invoices.map((invoice) => (
              <InvoiceFrame key={invoice.invoiceSourceId} invoice={invoice} selection={showBulkActions && isBulkEligible(invoice) ?
                <label className="flex min-h-11 min-w-11 cursor-pointer items-start justify-center"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-action-primary focus-visible:outline-2 focus-visible:outline-focus"
                  aria-label={`Select invoice ${invoice.invoiceNumber || invoice.invoiceSourceId} for full dispute`}
                  checked={selectedIds.includes(invoice.invoiceSourceId)} disabled={saving || disabled}
                  onChange={event => setSelectedIds(current => event.target.checked ? [...current, invoice.invoiceSourceId] : current.filter(id => id !== invoice.invoiceSourceId))} /></label> : undefined}>
                {showBulkActions && invoice.invoiceState === 'open' && invoice.isResolved && (
                  <p className="mt-2 text-xs text-text-secondary">Resolved — reactivate before disputing again.</p>
                )}
                <InvoiceDetails compact={workspace}>
                {invoice.disputeId && (
                  <p className="mt-2 text-xs text-text-secondary">Recorded dispute: {amount(invoice.recordedDisputedAmountNative, invoice.currencyCode)}{invoice.disputeMode === 'full' ? ' (full amount intent)' : ''}</p>
                )}
                {invoice.note && editingId !== invoice.invoiceSourceId && noteEditingId !== invoice.invoiceSourceId && <p className="mt-2 whitespace-pre-wrap text-text-primary">Note: {invoice.note}</p>}
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
                      <label className="flex min-w-0 items-start gap-2"><input type="radio" name={`mode-${invoice.invoiceSourceId}`} checked={mode === 'full'} onChange={() => setMode('full')} />Dispute full outstanding amount ({amount(invoice.currentAmountDueNative, invoice.currencyCode)})</label>
                      <label className="flex min-w-0 items-start gap-2"><input type="radio" name={`mode-${invoice.invoiceSourceId}`} checked={mode === 'partial'} onChange={() => setMode('partial')} />Dispute part</label>
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
                </InvoiceDetails>
                {onPromiseRefresh && <InvoicePromise invoice={invoice} tenantId={tenantId} onRefresh={onPromiseRefresh} onReconciled={onReconciled} onMutationStarted={onMutationStarted} onReconciliationUnavailable={() => onMutationResult(false, 'Promise saved, but current balances are not ready. Refresh the details before making further changes.')} disabled={disabled || saving} />}
              </InvoiceFrame>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
