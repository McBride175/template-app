'use client'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import InvoicePromise from '@/app/collections/customers/InvoicePromise'
import Button from '@/app/components/ui/Button'
import Alert from '@/app/components/ui/Alert'
import Spinner from '@/app/components/ui/Spinner'
import { actionStyles } from '@/app/components/ui/actionStyles'
import type { InvoiceDisputeView } from '@/lib/collections/invoice-dispute-view'
import type { PromiseView } from '@/lib/collections/promise-presentation'
import { promiseCustomerHref, type PromiseWorklistRow } from '@/lib/collections/promise-worklist'
import PromiseManagementDialog from './PromiseManagementDialog'

type Context = { invoice: InvoiceDisputeView; historical?: PromiseView }
type Entry = { context: Context; expires: number; signature: string }
export type PromiseContextCache = Map<string, Entry>
export type PromiseInteraction = { editing: boolean; saving: boolean; uncertain: boolean }
const idle: PromiseInteraction = { editing: false, saving: false, uncertain: false }

/** The worklist DTO is never used to fabricate invoice/editor context. */
export default function PromiseManagement({ row, tenantId, returnHref, cache, onClose, onCommitted, onInteractionChange }: {
  row: PromiseWorklistRow; tenantId: string; returnHref: string; cache: PromiseContextCache
  onClose: () => void; onCommitted: (promise: PromiseView) => Promise<boolean>; onInteractionChange: (state: PromiseInteraction) => void
}) {
  const key = JSON.stringify([tenantId, row.customerSourceId, row.invoiceSourceId, row.id])
  const signature = JSON.stringify([row.status, row.promisedAmountNative, row.promisedDate, row.note, row.qualifyingPaidAmountNative])
  const [context, setContext] = useState<Context | null>(null), [error, setError] = useState<string | null>(null)
  const [interaction, setInteraction] = useState(idle)
  const pending = useRef<AbortController | null>(null), sequence = useRef(0)
  const mounted = useRef(true)
  const notify = useCallback((value: PromiseInteraction) => { setInteraction(value); onInteractionChange(value) }, [onInteractionChange])
  const load = useCallback(async (reuse = false) => {
    if (!mounted.current) return false
    const saved = cache.get(key)
    if (reuse && saved && saved.expires > Date.now() && saved.signature === signature) { setContext(saved.context); return true }
    pending.current?.abort()
    const controller = new AbortController(), version = ++sequence.current
    pending.current = controller; setError(null)
    try {
      const params = new URLSearchParams({ tenantId, customerSourceId: row.customerSourceId, invoiceSourceId: row.invoiceSourceId })
      const response = await fetch(`/api/collections/invoice-disputes?${params}`, { credentials: 'include', cache: 'no-store', signal: controller.signal })
      const body = await response.json()
      if (!response.ok || !body.ok || !Array.isArray(body.invoices)) throw new Error('Could not load current invoice details. Retry without leaving this list.')
      const invoice = body.invoices.find((value: InvoiceDisputeView) => value.invoiceSourceId === row.invoiceSourceId) as InvoiceDisputeView | undefined
      if (!invoice) throw new Error('This invoice is no longer available. The commitment remains in the worklist for investigation.')
      let selected = invoice.activePromise?.id === row.id ? invoice.activePromise : invoice.latestPromise?.id === row.id ? invoice.latestPromise : null
      if (!selected) {
        const history = await fetch(`/api/collections/invoice-promises?${new URLSearchParams({ tenantId, invoiceSourceId: row.invoiceSourceId, includeHistory: 'true' })}`, { credentials: 'include', cache: 'no-store', signal: controller.signal })
        const records = await history.json()
        if (!history.ok || !records.ok || !Array.isArray(records.promises)) throw new Error('Could not load this commitment. Retry to review its current terms.')
        selected = records.promises.find((value: PromiseView) => value.id === row.id) ?? null
      }
      if (!selected) throw new Error('This commitment is no longer available. Refresh the worklist to review current records.')
      if (controller.signal.aborted || version !== sequence.current || !mounted.current) return false
      // A superseded or terminal record must never expose a different active commitment's editor.
      const next = { invoice, ...(selected.status !== 'active' || invoice.activePromise?.id !== selected.id ? { historical: selected } : {}) }
      cache.set(key, { context: next, expires: Date.now() + 60_000, signature })
      while (cache.size > 4) cache.delete(cache.keys().next().value!)
      setContext(next); return true
    } catch (failure) {
      if (!controller.signal.aborted && version === sequence.current && mounted.current) setError(failure instanceof Error ? failure.message : 'Could not load invoice details.')
      return false
    }
  }, [cache, key, signature, tenantId, row.customerSourceId, row.invoiceSourceId, row.id])
  useEffect(() => { mounted.current = true; void load(true); return () => { mounted.current = false; pending.current?.abort() } }, [load])
  useEffect(() => () => onInteractionChange(idle), [onInteractionChange])
  useEffect(() => {
    if (!interaction.editing && !interaction.saving && !interaction.uncertain) return
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [interaction])
  const close = () => {
    if (interaction.saving || interaction.uncertain) return
    if (interaction.editing && !window.confirm('Discard unsaved promise changes?')) return
    onClose()
  }
  return <PromiseManagementDialog title={row.customerName ?? 'Customer commitment'} invoiceLabel={row.invoiceReference}
    blocked={interaction.saving || interaction.uncertain} onClose={close}>
    {error && <Alert variant="warning" role="alert">{error}{!context && <Button variant="secondary" className="mt-2 min-h-11" onClick={() => void load()}>Retry invoice details</Button>}</Alert>}
    {!context && !error && <p role="status" className="flex min-h-20 items-center gap-2 text-sm"><Spinner label={null} />Loading current commitment…</p>}
    {context && (['unavailable', 'invalid'].includes(context.invoice.invoiceState) || !context.invoice.currencyCode || context.invoice.currentAmountDueNative === null) && <Alert variant="warning">Current invoice accounting values are unavailable or uncertain. Recorded Promise terms are retained; missing evidence is not zero payment.</Alert>}
    {context?.invoice.invoiceState === 'settled' && <p className="mb-3 text-sm text-text-secondary">Invoice settled in accounting. The commitment retains its recorded Promise outcome.</p>}
    {context && <InvoicePromise invoice={context.invoice} tenantId={tenantId} selectedPromise={context.historical} allowCreate={false} protectUncertain
      onInteractionChange={notify} onRefresh={() => load()} onCommitted={async promise => { cache.clear(); return onCommitted(promise) }} />}
    <Link href={promiseCustomerHref(row, tenantId, returnHref)} onClick={event => {
      if (interaction.saving || interaction.uncertain || (interaction.editing && !window.confirm('Discard unsaved promise changes and view the invoice?'))) event.preventDefault()
    }} className={actionStyles({ variant: 'ghost', className: 'mt-3 min-h-11 px-0 underline' })}>View invoice in Customers</Link>
  </PromiseManagementDialog>
}
