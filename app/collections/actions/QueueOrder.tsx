'use client'

import Button from '@/app/components/ui/Button'

interface QueueOrderProps {
  rows: readonly { id: string; name: string; amount: string }[]
  index: number
  disabled: boolean
  onSelect: (index: number) => void
}

// A bounded view into supplied order, never a second ranking or workflow.
export default function QueueOrder({ rows, index, disabled, onSelect }: QueueOrderProps) {
  const start = Math.max(0, Math.min(index - 2, rows.length - 5))
  return <aside aria-label="Queue order" className="hidden min-w-0 border-l border-border-default pl-5 xl:block">
    <h2 className="text-sm font-semibold">Queue order</h2>
    <p className="mt-1 text-xs text-text-secondary">{rows.length} remaining · Showing {start + 1}–{Math.min(start + 5, rows.length)}</p>
    <ol start={start + 1} className="mt-4 space-y-1">
      {rows.slice(start, start + 5).map((row, offset) => {
        const position = start + offset
        return <li key={row.id}>
          <Button variant="ghost" aria-current={position === index ? 'true' : undefined}
            disabled={disabled} onClick={() => onSelect(position)}
            className={`min-h-16 w-full items-start justify-start gap-3 px-2 py-3 text-left font-normal ${position === index ? 'bg-selected text-on-selected' : ''}`}>
            <span className="pt-0.5 text-sm font-semibold tabular-nums">{position + 1}</span>
            <span className="min-w-0"><span className="block break-words text-sm font-semibold [overflow-wrap:anywhere]">{row.name}</span>
              <span className="mt-1 block break-words text-xs tabular-nums [overflow-wrap:anywhere]">{row.amount}</span></span>
          </Button>
        </li>
      })}
    </ol>
  </aside>
}
