import type { HTMLAttributes } from 'react'
import { feedbackStyles, type FeedbackVariant } from './feedbackStyles'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: FeedbackVariant | 'neutral'
}

export default function Badge({ variant = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={feedbackStyles(variant,
        `inline-flex items-center rounded-control border px-2 py-0.5 font-sans text-xs font-medium ${className ?? ''}`
      )}
      {...props}
    />
  )
}
