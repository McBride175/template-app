import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface SpinnerProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  // Use null when adjacent text already announces loading.
  label?: string | null
}

export default function Spinner({ label = 'Loading', className, ...props }: SpinnerProps) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-hidden={label ? undefined : true}
      className={cn('inline-flex h-4 w-4 shrink-0 text-text-muted', className)}
      {...props}
    >
      <svg className="h-full w-full animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
        <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label && <span className="sr-only">{label}</span>}
    </span>
  )
}
