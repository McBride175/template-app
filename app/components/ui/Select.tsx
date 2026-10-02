import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { fieldStyles } from './fieldStyles'

export default function Select({ className, ...props }: ComponentProps<'select'>) {
  const dropdown = !props.multiple && (!props.size || props.size === 1)
  const control = <select className={fieldStyles(cn(
    dropdown && 'h-10 appearance-none pr-9', className
  ))} {...props} />

  // Native menus and keyboard behaviour remain browser-owned. The decorative
  // arrow lets the closed control share field geometry across browsers.
  if (!dropdown) return control
  return <div className="relative">
    {control}
    <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
      <path d="m6 9 6 6 6-6" />
    </svg>
  </div>
}
