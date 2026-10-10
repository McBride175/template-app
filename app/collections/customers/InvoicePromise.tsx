'use client'

import InvoicePromisePanel from './InvoicePromisePanel'
import { useEffect, useId, useRef, useState } from 'react'
import type { InvoiceDisputeView } from '@/lib/collections/invoice-dispute-view'
import { compareDecimalValues, normalizeDecimalValue } from '@/lib/money/currency'
import { promiseOutcome, type PromiseView, type PromiseEventView } from '@/lib/collections/promise-presentation'
import type { FinancialMutationReconciliation } from '@/lib/collections/financial-mutation-reconciliation-server'
import { mountedFinancialQueueWindow, notifyPromiseActionabilityChanged } from '@/lib/collections/promise-refresh'

type Body = { ok?: boolean; code?: string; error?: string; promise?: PromiseView; activePromise?: PromiseView | null; promises?: PromiseView[]; events?: PromiseEventView[]; reconciliation?: FinancialMutationReconciliation }
const errorMessage = (body: Body | null) => body?.code === 'conflict' || body?.code === 'not_found'
  ? 'This invoice or promise changed. The latest details have been loaded; review them before saving again.'
  : body?.code === 'temporarily_unavailable' ? 'Accounting details are not ready. Refresh accounting and try again.'
  : body?.code === 'invalid_input' ? 'Check the amount against the current balance. New promises need a date of today or later.'
  : body?.code === 'unauthorized' ? 'Your session has expired. Sign in again.'
  : body?.code === 'forbidden' ? 'This invoice is not available to your account.'
  : 'Could not save the promise. Try again with the same details.'

export default function InvoicePromise({ invoice, tenantId, onRefresh, onReconciled, onMutationStarted, onReconciliationUnavailable, disabled = false, selectedPromise, allowCreate = true, protectUncertain = false, onInteractionChange, onCommitted }: {
  invoice: InvoiceDisputeView; tenantId: string; onRefresh: (invoiceId: string) => Promise<boolean>; disabled?: boolean
  onReconciled?: (result: FinancialMutationReconciliation, sequence?: number) => Promise<boolean>
  onMutationStarted?: () => number | void
  onReconciliationUnavailable?: () => void
  selectedPromise?: PromiseView // Historical commitment loaded from the authoritative invoice history.
  allowCreate?: boolean; protectUncertain?: boolean
  onInteractionChange?: (state: { editing: boolean; saving: boolean; uncertain: boolean }) => void
  onCommitted?: (promise: PromiseView) => Promise<boolean>
}) {
  const id = useId()
  const [overlay, setOverlay] = useState<{ source: InvoiceDisputeView; promise: PromiseView | null } | null>(null)
  const [lastTerminal, setLastTerminal] = useState<PromiseView | null>(null)
  const current: PromiseView | null = selectedPromise ?? (overlay && overlay.source === invoice ? overlay.promise : invoice.activePromise ?? invoice.latestPromise ?? lastTerminal)
  const active = !selectedPromise && current?.status === 'active' ? current : null
  const editSnapshot = useRef<PromiseView | null>(null)
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [listRefreshNeeded, setListRefreshNeeded] = useState(false)
  useEffect(() => { onInteractionChange?.({ editing, saving, uncertain }) }, [editing, saving, uncertain, onInteractionChange])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [refreshNeeded, setRefreshNeeded] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [history, setHistory] = useState<Array<{ promise: PromiseView; events: PromiseEventView[] | null }>>([])
  const [eventLoading, setEventLoading] = useState<string | null>(null)
  const command = useRef<{ intent: string; id: string } | null>(null)
  const pending = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  const actionRef = useRef<HTMLButtonElement>(null)
  const cancellation = Boolean(active) && (!amount.trim() || (/^\d+(?:\.\d+)?$/.test(amount.trim()) && normalizeDecimalValue(amount.trim()) === '0'))
  const eligible = allowCreate && !selectedPromise && invoice.invoiceState === 'open' && compareDecimalValues(invoice.currentAmountDueNative, '0') === 1
  const locked = disabled || saving || refreshNeeded

  function open() {
    editSnapshot.current = active
    setAmount(active?.promisedAmountNative ?? ''); setDate(active?.promisedDate ?? '')
    setNote(active?.note ?? ''); setFieldErrors({}); setError(null); setMessage(null); setEditing(true)
    queueMicrotask(() => formRef.current?.querySelector<HTMLInputElement>('input')?.focus())
  }
  async function context() {
    const params = new URLSearchParams({ tenantId, invoiceSourceId: invoice.invoiceSourceId, includeHistory: 'true' })
    const response = await fetch(`/api/collections/invoice-promises?${params}`, { credentials: 'include', cache: 'no-store' })
    const body = await response.json() as Body
    if (!response.ok || !body.ok || !Array.isArray(body.promises)) throw new Error('Could not load promise history.')
    const latest = body.activePromise ?? body.promises[0] ?? null
    if (latest && latest.status !== 'active') setLastTerminal(latest)
    setOverlay({ source: invoice, promise: latest })
    setHistory(body.promises.map(promise => ({ promise, events: null })))
    return body
  }
  async function refreshSaved() {
    const refreshed = await onRefresh(invoice.invoiceSourceId).catch(() => false)
    setRefreshNeeded(!refreshed)
    const listReady = !listRefreshNeeded || !current || !onCommitted || await onCommitted(current).catch(() => false)
    setListRefreshNeeded(!listReady); setRefreshNeeded(!refreshed || !listReady)
    if (refreshed && listReady) setMessage('Current invoice amounts refreshed.')
    return refreshed
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (pending.current || locked || selectedPromise) return
    if (editSnapshot.current?.id !== (active?.id ?? undefined) || editSnapshot.current?.revision !== active?.revision) {
      setError('This promise changed. Close the form and review the latest details before saving.'); return
    }
    const errors: Record<string, string> = {}
    const normalized = normalizeDecimalValue(amount.trim())
    if (!cancellation && (!/^\d+(?:\.\d+)?$/.test(amount.trim()) || compareDecimalValues(normalized, '0') !== 1)) errors.amount = 'Enter a positive promise amount.'
    if (!cancellation && !active && compareDecimalValues(normalized, invoice.currentAmountDueNative) === 1) errors.amount = 'The promise cannot exceed the current outstanding amount.'
    if (!cancellation && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(new Date(`${date}T00:00:00Z`).getTime()) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) errors.date = 'Choose a valid promised date.'
    if (!cancellation && note.length > 2000) errors.note = 'Use no more than 2,000 characters.'
    setFieldErrors(errors)
    if (Object.keys(errors).length) { setError('Check the highlighted fields.'); return }
    if (active && !cancellation && normalized === normalizeDecimalValue(active.promisedAmountNative) && date === active.promisedDate && note.trim() === (active.note ?? '').trim()) {
      setEditing(false); setMessage('No changes to save.'); actionRef.current?.focus(); return
    }
    const financial = !active || cancellation || normalized !== normalizeDecimalValue(active.promisedAmountNative) || date !== active.promisedDate
    const fields = active
      ? { operation: 'edit', promiseId: active.id, expectedRevision: active.revision,
        ...(cancellation ? { amount: amount.trim() } : financial ? { amount: amount.trim(), promisedDate: date, note } : { note }) }
      : { operation: 'create', invoiceSourceId: invoice.invoiceSourceId, amount: amount.trim(), promisedDate: date, note }
    const intent = JSON.stringify({ tenantId, ...fields })
    if (command.current?.intent !== intent) command.current = { intent, id: crypto.randomUUID() }
    const sequence = onMutationStarted?.()
    pending.current = true; setSaving(true); setError(null); setMessage(null)
    try {
      const response = await fetch('/api/collections/invoice-promises', { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...JSON.parse(intent), commandId: command.current.id,
          ...(onReconciled ? { reconcile: true, queue: mountedFinancialQueueWindow(tenantId) } : {}) }) })
      const body = await response.json().catch(() => null) as Body | null
      if (!response.ok || !body?.ok || !body.promise) {
        if (body?.code === 'conflict' || body?.code === 'not_found') {
          command.current = null; setUncertain(false); setEditing(false)
          const refreshed = await Promise.allSettled([context(), onRefresh(invoice.invoiceSourceId)])
          const failed = refreshed.some(result => result.status === 'rejected' || result.value === false)
          setRefreshNeeded(failed)
          setError(failed ? 'This invoice or promise changed. Refresh the latest details before trying again.' : errorMessage(body))
        } else { setError(errorMessage(body)); setUncertain(!body || (!body.code && response.status >= 500) || (response.ok && !body.promise)) }
        return
      }
      // A committed response is never presented as a failed save, even if refresh subsequently fails.
      command.current = null; setUncertain(false); setOverlay({ source: invoice, promise: body.promise }); setEditing(false)
      if (body.promise.status !== 'active') setLastTerminal(body.promise)
      setHistory(previous => [{ promise: body.promise!, events: null }, ...previous.filter(item => item.promise.id !== body.promise!.id)])
      actionRef.current?.focus()
      if (onReconciled && body.reconciliation) {
        const ready = await onReconciled(body.reconciliation, typeof sequence === 'number' ? sequence : undefined).catch(() => false)
        setRefreshNeeded(!ready)
        if (!ready) onReconciliationUnavailable?.()
        setMessage(ready ? (body.promise.status === 'active' ? 'Promise saved.' : promiseOutcome[body.promise.status])
          : 'Promise saved, but current amounts are not ready. Refresh the details before making another change.')
      } else if (financial) {
        notifyPromiseActionabilityChanged(tenantId)
        const refreshed = await onRefresh(invoice.invoiceSourceId).catch(() => false)
        setRefreshNeeded(!refreshed)
        setMessage(refreshed ? (body.promise.status === 'active' ? 'Promise saved.' : promiseOutcome[body.promise.status])
          : 'Promise saved, but current invoice amounts could not be refreshed. Refresh the details before making another change.')
      } else setMessage('Promise note saved.')
      if (onCommitted && !await onCommitted(body.promise).catch(() => false)) {
        setListRefreshNeeded(true); setRefreshNeeded(true)
        setMessage('Promise saved, but the worklist could not be refreshed. Retry the refresh before making another change.')
      }
    } catch {
      setUncertain(true)
      setError('The save response was not received. Retry with the same details to safely check the result.')
    } finally { pending.current = false; setSaving(false) }
  }
  async function showHistory() {
    if (historyOpen) { setHistoryOpen(false); return }
    setHistoryOpen(true); setHistoryLoading(true); setHistoryError(null)
    try {
      const latest = await context()
      const observed = latest.activePromise ?? latest.promises?.[0] ?? null
      const changed = observed?.status !== current?.status || observed?.promisedAmountNative !== current?.promisedAmountNative ||
        observed?.promisedDate !== current?.promisedDate || observed?.qualifyingPaidAmountNative !== current?.qualifyingPaidAmountNative
      if (changed && !await onRefresh(invoice.invoiceSourceId).catch(() => false)) {
        setRefreshNeeded(true); setMessage('Current invoice amounts could not be refreshed. Refresh the details before making a change.')
      }
    } catch { setHistoryError('Could not load promise history. Try opening it again.') }
    finally { setHistoryLoading(false) }
  }
  async function loadEvents(promiseId: string) {
    setEventLoading(promiseId); setHistoryError(null)
    try {
      const params = new URLSearchParams({ tenantId, promiseId })
      const response = await fetch(`/api/collections/invoice-promises?${params}`, { cache: 'no-store', credentials: 'include' })
      const body = await response.json() as Body
      if (!response.ok || !body.ok || !Array.isArray(body.events)) throw new Error()
      setHistory(previous => previous.map(item => item.promise.id === promiseId ? { ...item, events: body.events! } : item))
    } catch { setHistoryError('Could not load these promise changes. Try again.') }
    finally { setEventLoading(null) }
  }
  return <InvoicePromisePanel id={id} invoice={invoice} active={active} current={current} editing={editing}
    editCloseLabel={allowCreate ? 'Close' : 'Cancel edit'} showCancellation={!allowCreate && !selectedPromise} protectUncertain={protectUncertain && uncertain} cancellation={cancellation} eligible={eligible} locked={locked} saving={saving}
    amount={amount} date={date} note={note} setAmount={setAmount} setDate={setDate} setNote={setNote}
    fieldErrors={fieldErrors} error={error} message={message} refreshNeeded={refreshNeeded}
    historyOpen={historyOpen} historyLoading={historyLoading} historyError={historyError} eventLoading={eventLoading}
    history={history} formRef={formRef} actionRef={actionRef} open={open} save={save}
    close={() => { setEditing(false); actionRef.current?.focus() }} showHistory={showHistory} loadEvents={loadEvents} refreshSaved={refreshSaved} />
}
