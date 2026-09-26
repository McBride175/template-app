import { cn } from '@/lib/utils'

// Native Input/select/textarea props own validation and label associations.
// Set aria-invalid="true" and aria-describedby on a control to present an error.
export function fieldStyles(className?: string) {
  return cn(
    'w-full px-3 py-2 text-sm font-sans rounded-control transition-colors',
    'bg-surface text-text-primary border border-border-strong placeholder:text-text-muted',
    'focus:outline-none focus:ring-2 focus:ring-focus focus:border-focus',
    'aria-invalid:border-feedback-error aria-invalid:focus:ring-feedback-error aria-invalid:focus:border-feedback-error',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    className
  )
}
