import { cn } from '@/lib/utils'

// Native Input/select/textarea props own validation and label associations.
// Set aria-invalid="true" and aria-describedby on a control to present an error.
export function fieldStyles(className?: string) {
  return cn(
    'w-full min-h-10 px-3 py-2 text-sm font-sans rounded-control transition-colors motion-reduce:transition-none',
    'bg-surface text-text-primary border border-border-strong placeholder:text-text-muted',
    'focus:outline-none focus:border-focus focus-visible:ring-2 focus-visible:ring-focus',
    'aria-invalid:border-feedback-error aria-invalid:focus:border-feedback-error aria-invalid:focus-visible:ring-feedback-error',
    'disabled:bg-field-disabled disabled:text-text-disabled disabled:border-border-default disabled:cursor-not-allowed',
    className
  )
}
