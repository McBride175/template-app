'use client'

import { useId, useState, type ReactNode } from 'react'
import Button from '@/app/components/ui/Button'

/** Mobile discovery disclosure only; controlled search/selection remain mounted. */
export default function CustomerSelectionPanel({ selected, children }: { selected: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false), id = useId()
  return <aside aria-label="Find and select customers" className="min-w-0 lg:border-r lg:border-border-default lg:pr-6">
    {selected && <Button variant="secondary" className="min-h-11 w-full justify-between lg:hidden" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      Change customer <span>{open ? 'Close' : 'Show'}</span>
    </Button>}
    <div id={id} className={`${selected && !open ? 'hidden' : 'mt-3 block'} lg:mt-0 lg:block`}>{children}</div>
  </aside>
}
