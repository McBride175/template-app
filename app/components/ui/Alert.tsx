import type { HTMLAttributes } from 'react'
import { feedbackStyles, type FeedbackVariant } from './feedbackStyles'

interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: FeedbackVariant
}

// Static/in-flow feedback. No notification state, domain logic or icon policy.
export default function Alert({ variant = 'info', role, className, ...props }: AlertProps) {
  return (
    <div
      role={role ?? (variant === 'error' ? 'alert' : 'status')}
      className={feedbackStyles(variant,
        `rounded-surface border p-3 font-sans text-sm leading-normal [&_p]:text-sm [&_p]:text-inherit ${className ?? ''}`
      )}
      {...props}
    />
  )
}
