'use client'

import { useCallback, useEffect, useState } from 'react'

import type { InvoiceDisputeView as InvoiceRow } from '@/lib/collections/invoice-dispute-view'

interface ApiResponse {
  ok?: boolean
  invoices?: InvoiceRow[]
  error?: string
  code?: string
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

function date(value: string | null) {
  if (!value) return '—'
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString()
}

function status(invoice: InvoiceRow) {
  if (invoice.invoiceState === 'settled') {
    if (invoice.isResolved) return 'Resolved by you · settled in accounting'
    return invoice.isActive ? 'Settled in accounting · dispute remains unresolved' : 'Settled in accounting'
  }
  if (invoice.invoiceState === 'unavailable') return 'Unavailable in current accounting data'
  if (invoice.invoiceState === 'invalid') return 'Accounting balance unavailable'
  if (invoice.isResolved) return 'Resolved by you'
  if (invoice.isActive) return `${invoice.disputeMode === 'full' ? 'Full' : 'Partial'} dispute${invoice.needsReview ? ' · Needs review' : ''}`
  return 'No dispute'
}

const inputClass = 'min-h-11 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900'
const actionClass = 'min-h-11 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50'

interface InvoiceDisputeListProps {
  tenantId: string
  customerSourceId: string
  customerName: string
  onChanged: () => Promise<boolean>
  onMutationStarted: () => void
  onMutationPending: (message: string) => void
  onMutationResult: (refreshed: boolean, message: string) => void
  onMutationError?: (message: string) => void
}

export default function CustomerInvoiceDisputes(props: InvoiceDisputeListProps) {
  const { tenantId, customerSourceId } = props
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

  useEffect(() => { void reload() }, [reload])
  useEffect(() => {
    if (loading || typeof window === 'undefined' || !window.location.hash.startsWith('#invoice-')) return
    try {
      document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView({ block: 'start' })
    } catch { /* Ignore malformed external fragments. */ }
  }, [invoices, loading])
  return <InvoiceDisputeList {...props} invoices={invoices} loading={loading}
    loadError={error} reload={reload} />
}

/** Shared native editor and revision-safe mutation flow; data loading belongs to its surface. */
export function InvoiceDisputeList({
  tenantId, customerSourceId, customerName, onChanged, onMutationStarted,
  onMutationPending, onMutationResult, invoices, loading = false, loadError = null,
  reload, showBulkActions = true, disabled = false, onMutationError,
}: InvoiceDisputeListProps & {
  invoices: InvoiceRow[]
  loading?: boolean
  loadError?: string | null
  reload: () => Promise<boolean>
  showBulkActions?: boolean
  disabled?: boolean
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
    onMutationStarted()
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/collections/invoice-disputes', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, tenantId, ...fields }),
      })
      const body = await response.json().catch(() => null) as ApiResponse | null
      if (response.status === 409 && body?.code === 'conflict') {
        const message = body.error || 'This dispute changed. Review the latest version before saving.'
        onMutationPending(message)
        setEditingId(null)
        setNoteEditingId(null)
        const invoiceRefresh = await reload()
        const summaryRefresh = await onChanged().catch(() => false)
        onMutationResult(invoiceRefresh && summaryRefresh, message)
        return
      }
      if (!response.ok || !body?.ok) throw new Error(body?.error || 'Could not save the dispute.')
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

  const openInvoices = invoices.filter((invoice) => invoice.invoiceState === 'open')
  const revisionEntries = (ids: string[]) => invoices
    .filter((invoice) => ids.includes(invoice.invoiceSourceId) && invoice.revision)
    .map((invoice) => ({ invoiceSourceId: invoice.invoiceSourceId, revision: invoice.revision }))

  return (
    <section aria-label={`Invoices for ${customerName}`} className="space-y-4 bg-gray-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-gray-900">Invoices for {customerName}</h3>
          <p className="text-xs text-gray-600">Disputes apply only to these invoice identities. Amounts below use invoice currency.</p>
        </div>
        <button type="button" className={actionClass} onClick={() => void reload()} disabled={loading || saving || disabled}>Refresh invoices</button>
      </div>
      {(error || loadError) && <p role="alert" className="text-sm text-red-700">{error || loadError}</p>}
      {loading ? <p className="text-sm text-gray-600">Loading invoices…</p> : invoices.length === 0 ? (
        <p className="text-sm text-gray-600">No current or previously disputed invoices are available for this customer.</p>
      ) : (
        <>
          {showBulkActions && openInvoices.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={actionClass} disabled={saving || disabled || selectedIds.length === 0}
                onClick={() => void mutate('bulk_full', { customerSourceId, invoiceSourceIds: selectedIds,
                  expectedRevisions: revisionEntries(selectedIds) }, `${selectedIds.length} invoice disputes saved.`)}>
                Dispute selected in full ({selectedIds.length})
              </button>
              <button type="button" className={actionClass} disabled={saving || disabled}
                onClick={() => void mutate('bulk_full', { customerSourceId,
                  expectedRevisions: revisionEntries(openInvoices.map((invoice) => invoice.invoiceSourceId)) },
                  'All currently open invoices disputed in full.')}>
                Dispute all current invoices in full
              </button>
            </div>
          )}
          <div className="space-y-3">
            {invoices.map((invoice) => (
              <div key={invoice.invoiceSourceId} id={`invoice-${invoice.invoiceSourceId}`} className="rounded-md border border-gray-200 bg-white p-4 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      {showBulkActions && invoice.invoiceState === 'open' && (
                        <input type="checkbox" aria-label={`Select invoice ${invoice.invoiceNumber || invoice.invoiceSourceId} for full dispute`}
                          checked={selectedIds.includes(invoice.invoiceSourceId)} disabled={saving || disabled}
                          onChange={(event) => setSelectedIds((current) => event.target.checked
                            ? [...current, invoice.invoiceSourceId]
                            : current.filter((id) => id !== invoice.invoiceSourceId))} />
                      )}
                      <p className="font-medium text-gray-900">{invoice.invoiceNumber || invoice.reference || invoice.invoiceSourceId}</p>
                    </div>
                    <p className="mt-1 text-xs text-gray-600">Issued {date(invoice.issueDate)} · Due {date(invoice.dueDate)} · {invoice.currencyCode || 'Currency unavailable'}</p>
                  </div>
                  <p className="font-medium text-gray-700">{status(invoice)}</p>
                </div>
                <div className="mt-3 grid gap-2 text-gray-700 sm:grid-cols-3">
                  <p>Accounting outstanding: <strong>{amount(invoice.currentAmountDueNative, invoice.currencyCode)}</strong></p>
                  <p>Effectively disputed: <strong>{amount(invoice.effectiveDisputedAmountNative, invoice.currencyCode)}</strong></p>
                  <p>To collect: <strong>{amount(invoice.collectibleAmountNative, invoice.currencyCode)}</strong></p>
                </div>
                {invoice.disputeId && (
                  <p className="mt-2 text-xs text-gray-600">Recorded dispute: {amount(invoice.recordedDisputedAmountNative, invoice.currencyCode)}{invoice.disputeMode === 'full' ? ' (full amount intent)' : ''}</p>
                )}
                {invoice.note && editingId !== invoice.invoiceSourceId && noteEditingId !== invoice.invoiceSourceId && <p className="mt-2 whitespace-pre-wrap text-gray-700">Note: {invoice.note}</p>}
                {invoice.needsReview && (
                  <p className="mt-3 rounded-md bg-amber-50 p-2 text-amber-900">Balance changed since this dispute was last reviewed. Update it or keep it as is.</p>
                )}
                {noteEditingId === invoice.invoiceSourceId ? (
                  <div className="mt-3 space-y-2 border-t border-gray-200 pt-3">
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
                  <div className="mt-3 space-y-3 border-t border-gray-200 pt-3">
                    <fieldset disabled={saving || disabled} className="flex flex-wrap gap-4">
                      <legend className="mb-1 font-medium">Disputed amount</legend>
                      <label className="flex items-center gap-2"><input type="radio" name={`mode-${invoice.invoiceSourceId}`} checked={mode === 'full'} onChange={() => setMode('full')} />Dispute full outstanding amount ({amount(invoice.currentAmountDueNative, invoice.currencyCode)})</label>
                      <label className="flex items-center gap-2"><input type="radio" name={`mode-${invoice.invoiceSourceId}`} checked={mode === 'partial'} onChange={() => setMode('partial')} />Dispute part</label>
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
                      }, 'Dispute resolved. Remaining debt is collectible again.')}>Resolve dispute</button>
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
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
