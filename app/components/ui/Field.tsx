import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface FieldControlProps {
  id: string
  required?: boolean
  'aria-describedby'?: string
  'aria-invalid'?: true
}

interface FieldProps extends Omit<HTMLAttributes<HTMLDivElement>, 'id' | 'children'> {
  id: string
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  describedBy?: string
  children: (props: FieldControlProps) => ReactNode
}

// Spread the callback props onto one labelable native control. Callers supply a
// unique control id and own validation, error announcements and submission state.
export default function Field({
  id, label, hint, error, required, describedBy, children, className, ...props
}: FieldProps) {
  const hasHint = Boolean(hint)
  const hasError = Boolean(error)
  const descriptionIds = [describedBy, hasHint && `${id}-hint`, hasError && `${id}-error`]
    .filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('space-y-1 font-sans', className)} {...props}>
      <label htmlFor={id} className="block text-sm font-medium text-text-primary">
        {label}
        {required && <span className="ml-1 text-text-muted">(required)</span>}
      </label>
      {children({
        id,
        required,
        'aria-describedby': descriptionIds,
        'aria-invalid': hasError ? true : undefined,
      })}
      {hasHint && <p id={`${id}-hint`} className="text-sm text-text-muted">{hint}</p>}
      {hasError && <p id={`${id}-error`} className="text-sm text-feedback-error">{error}</p>}
    </div>
  )
}
