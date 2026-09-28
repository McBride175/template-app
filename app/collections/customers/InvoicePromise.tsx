'use client'

import { useId, useRef, useState } from 'react'
import type { InvoiceDisputeView } from '@/lib/collections/invoice-dispute-view'
import { compareDecimalValues, normalizeDecimalValue } from '@/lib/money/currency'
import { promiseDate, promiseEventText, promiseMoney, promiseOutcome, type PromiseView, type PromiseEventView } from '@/lib/collections/promise-presentation'
import { notifyPromiseActionabilityChanged } from '@/lib/collections/promise-refresh'

const inputClass = 'min-h-11 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900'
const buttonClass = 'min-h-11 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50'
type Body = { ok?: boolean; code?: string; error?: string; promise?: PromiseView; activePromise?: PromiseView | null; promises?: PromiseView[]; events?: PromiseEventView[] }
const errorMessage = (body: Body | null) => body?.code === 'conflict' || body?.code === 'not_found'
  ? 'This invoice or promise changed. The latest details have been loaded; review them before saving again.'
  : body?.code === 'temporarily_unavailable' ? 'Accounting details are not ready. Refresh accounting and try again.'
  : body?.code === 'invalid_input' ? 'Check the amount against the current balance. New promises need a date of today or later.'
  : body?.code === 'unauthorized' ? 'Your session has expired. Sign in again.'
  : body?.code === 'forbidden' ? 'This invoice is not available to your account.'
  : 'Could not save the promise. Try again with the same details.'

export default function InvoicePromise({ invoice, tenantId, onRefresh, disabled = false }: {
  invoice: InvoiceDisputeView; tenantId: string; onRefresh: (invoiceId: string) => Promise<boolean>; disabled?: boolean
}) {
  const id = useId()
  const [overlay, setOverlay] = useState<{ source: InvoiceDisputeView; promise: PromiseView | null } | null>(null)
  const [lastTerminal, setLastTerminal] = useState<PromiseView | null>(null)
  const current: PromiseView | null = overlay && overlay.source === invoice ? overlay.promise : invoice.activePromise ?? invoice.latestPromise ?? lastTerminal
  const active = current?.status === 'active' ? current : null
  const editSnapshot = useRef<PromiseView | null>(null)
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
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
  const eligible = invoice.invoiceState === 'open' && compareDecimalValues(invoice.currentAmountDueNative, '0') === 1
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
    if (refreshed) setMessage('Current invoice amounts refreshed.')
    return refreshed
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (pending.current || locked) return
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
    pending.current = true; setSaving(true); setError(null); setMessage(null)
    try {
      const response = await fetch('/api/collections/invoice-promises', { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...JSON.parse(intent), commandId: command.current.id }) })
      const body = await response.json().catch(() => null) as Body | null
      if (!response.ok || !body?.ok || !body.promise) {
        if (body?.code === 'conflict' || body?.code === 'not_found') {
          command.current = null; setEditing(false)
          const refreshed = await Promise.allSettled([context(), onRefresh(invoice.invoiceSourceId)])
          const failed = refreshed.some(result => result.status === 'rejected' || result.value === false)
          setRefreshNeeded(failed)
          setError(failed ? 'This invoice or promise changed. Refresh the latest details before trying again.' : errorMessage(body))
        } else setError(errorMessage(body))
        return
      }
      // A committed response is never presented as a failed save, even if refresh subsequently fails.
      command.current = null; setOverlay({ source: invoice, promise: body.promise }); setEditing(false)
      if (body.promise.status !== 'active') setLastTerminal(body.promise)
      setHistory(previous => [{ promise: body.promise!, events: null }, ...previous.filter(item => item.promise.id !== body.promise!.id)])
      actionRef.current?.focus()
      if (financial) {
        notifyPromiseActionabilityChanged(tenantId)
        const refreshed = await onRefresh(invoice.invoiceSourceId).catch(() => false)
        setRefreshNeeded(!refreshed)
        setMessage(refreshed ? (body.promise.status === 'active' ? 'Promise saved.' : promiseOutcome[body.promise.status])
          : 'Promise saved, but current invoice amounts could not be refreshed. Refresh the details before making another change.')
      } else setMessage('Promise note saved.')
    } catch {
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
  return <section aria-label="Invoice promise" className="mt-4 space-y-2 border-t border-gray-200 pt-3 text-sm">
    {active && <div>
      <p className="font-medium text-gray-900">{promiseMoney(active.promisedAmountNative, invoice.currencyCode)} promised by {promiseDate(active.promisedDate)} <span className="ml-2 text-xs font-normal text-gray-600">Active</span></p>
      {compareDecimalValues(active.qualifyingPaidAmountNative, '0') === 1 && <p className="mt-1 text-gray-600">{promiseMoney(active.qualifyingPaidAmountNative, invoice.currencyCode)} received against this promise</p>}
      {invoice.activePromisedCoverageAmountNative != null && normalizeDecimalValue(invoice.activePromisedCoverageAmountNative) !== normalizeDecimalValue(active.promisedAmountNative) && <p className="mt-1 text-gray-600">{promiseMoney(invoice.activePromisedCoverageAmountNative, invoice.currencyCode)} currently promised against outstanding debt</p>}
      {active.note && !editing && <p className="mt-1 whitespace-pre-wrap text-gray-600">{active.note}</p>}
    </div>}
    {current && !active && <p className="text-gray-600">{promiseOutcome[current.status]} · {promiseMoney(current.promisedAmountNative, current.currencyCode ?? invoice.currencyCode)} by {promiseDate(current.promisedDate)}</p>}
    {editing ? <form ref={formRef} onSubmit={save} noValidate aria-busy={saving} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 sm:max-w-xl">
        <div><label htmlFor={`${id}-amount`} className="mb-1 block font-medium">Promise amount ({invoice.currencyCode})</label>
          <input id={`${id}-amount`} className={`${inputClass} w-full`} inputMode="decimal" autoComplete="off" maxLength={100} value={amount} onChange={event => setAmount(event.target.value)} disabled={saving}
            aria-invalid={Boolean(fieldErrors.amount)} aria-describedby={fieldErrors.amount ? `${id}-amount-error` : undefined} />
          {fieldErrors.amount && <p id={`${id}-amount-error`} className="mt-1 text-red-700">{fieldErrors.amount}</p>}
        </div>
        {!cancellation && <div><label htmlFor={`${id}-date`} className="mb-1 block font-medium">Promised date</label>
          <input id={`${id}-date`} className={`${inputClass} w-full`} type="date" value={date} onChange={event => setDate(event.target.value)} disabled={saving}
            aria-invalid={Boolean(fieldErrors.date)} aria-describedby={fieldErrors.date ? `${id}-date-error` : undefined} />
          {fieldErrors.date && <p id={`${id}-date-error`} className="mt-1 text-red-700">{fieldErrors.date}</p>}
        </div>}
      </div>
      {!cancellation && <div className="max-w-xl"><label htmlFor={`${id}-note`} className="mb-1 block">Optional promise note</label>
        <textarea id={`${id}-note`} className={`${inputClass} w-full`} rows={2} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} disabled={saving}
          aria-invalid={Boolean(fieldErrors.note)} aria-describedby={fieldErrors.note ? `${id}-note-error` : undefined} />
        {fieldErrors.note && <p id={`${id}-note-error`} className="mt-1 text-red-700">{fieldErrors.note}</p>}
      </div>}
      <div className="flex flex-wrap gap-2"><button type="submit" className={`${buttonClass} bg-gray-900 text-white hover:bg-gray-800`} disabled={locked}>{saving ? 'Saving…' : cancellation ? 'Cancel promise' : 'Save promise'}</button>
        <button type="button" className={buttonClass} disabled={saving} onClick={() => { setEditing(false); actionRef.current?.focus() }}>Close</button></div>
    </form> : <div className="flex flex-wrap gap-2">
      {(active || eligible) && <button ref={actionRef} type="button" className={buttonClass} onClick={open} disabled={locked || Boolean(active && !active.revision)}>{active ? 'Edit promise' : current || history.length ? 'Record new promise' : 'Record promise'}</button>}
      <button type="button" className={buttonClass} onClick={() => void showHistory()} aria-expanded={historyOpen} aria-controls={`${id}-history`} disabled={saving || historyLoading}>Promise history</button>
    </div>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {message && <p role="status" aria-live="polite" className="text-gray-600">{message}</p>}
    {refreshNeeded && <button type="button" className={buttonClass} disabled={saving} onClick={() => void refreshSaved()}>Refresh invoice details</button>}
    {historyOpen && <div id={`${id}-history`} className="space-y-3 pt-2" aria-label="Promise history">
      {historyLoading ? <p role="status">Loading promise history…</p> : history.length === 0 && !historyError ? <p className="text-gray-500">No promises recorded.</p> : history.map(item => <div key={item.promise.id}>
        <p className="text-gray-700">{promiseMoney(item.promise.promisedAmountNative, item.promise.currencyCode ?? invoice.currencyCode)} by {promiseDate(item.promise.promisedDate)} · {promiseOutcome[item.promise.status]}</p>
        {item.promise.note && <p className="mt-1 whitespace-pre-wrap text-gray-600">{item.promise.note}</p>}
        {item.events === null ? <button type="button" className="min-h-11 text-gray-700 underline" disabled={eventLoading === item.promise.id} onClick={() => void loadEvents(item.promise.id)}>{eventLoading === item.promise.id ? 'Loading changes…' : 'Show changes'}</button>
          : <ol className="mt-2 space-y-2 border-l border-gray-200 pl-3">{[...item.events].sort((a, b) => BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1).map(event => <li key={event.id}>
            <p className="whitespace-pre-wrap text-gray-700">{promiseEventText(event, item.promise.currencyCode ?? invoice.currencyCode)}</p><p className="text-xs text-gray-500">Recorded {promiseDate(event.occurredAt)}</p>
          </li>)}</ol>}
        {item.events?.length === 100 && <p className="mt-1 text-xs text-gray-500">Showing the 100 most recent changes.</p>}
      </div>)}
      {history.length === 50 && <p className="text-xs text-gray-500">Showing the 50 most recent commitments.</p>}
      {historyError && <p role="alert" className="text-red-700">{historyError}</p>}
    </div>}
  </section>
}
