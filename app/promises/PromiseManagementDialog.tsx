'use client'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import Button from '@/app/components/ui/Button'

/** One editing surface. Native modal focus containment and Escape handling on every viewport. */
export default function PromiseManagementDialog({ title, invoiceLabel, blocked, onClose, children }: {
  title: string; invoiceLabel: string; blocked: boolean; onClose: () => void; children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null), id = useId()
  useEffect(() => {
    const element = dialog.current!, origin = document.activeElement as HTMLElement | null
    const scroll = { x: window.scrollX, y: window.scrollY }, overflow = document.body.style.overflow
    element.showModal(); document.body.style.overflow = 'hidden'
    return () => {
      element.close(); document.body.style.overflow = overflow
      const destination = origin?.isConnected ? origin : document.querySelector<HTMLElement>('[data-promise-heading]')
      destination?.focus({ preventScroll: true }); window.scrollTo({ left: scroll.x, top: scroll.y, behavior: 'instant' })
    }
  }, [])
  useEffect(() => {
    if (!blocked && dialog.current && !dialog.current.contains(document.activeElement)) {
      dialog.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    }
  }, [blocked])
  return <dialog ref={dialog} aria-labelledby={id} onCancel={event => { event.preventDefault(); if (!blocked) onClose() }}
    className="m-auto max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-xl overflow-y-auto rounded-md border border-border-default bg-surface text-text-primary p-4 sm:p-6 backdrop:bg-black/40">
    <div className="mb-3 flex items-start justify-between gap-3"><div className="min-w-0"><h2 id={id} className="break-words text-lg font-semibold">{title}</h2><p className="break-all text-sm text-text-secondary">Invoice {invoiceLabel}</p></div>
      <Button variant="ghost" className="min-h-11 shrink-0" disabled={blocked} onClick={onClose} aria-label="Close promise management">Close</Button></div>
    {blocked && <p role="status" className="mb-3 text-sm text-text-secondary">Keep this panel open until the save is confirmed. An uncertain response can be retried safely with the same details.</p>}
    {children}
  </dialog>
}
