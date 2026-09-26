import { cn } from '@/lib/utils'

export type FeedbackVariant = 'info' | 'success' | 'warning' | 'error'

const variants: Record<FeedbackVariant | 'neutral', string> = {
  neutral: 'bg-surface-subtle text-text-secondary border-border-default',
  info: 'bg-feedback-info-surface text-feedback-info border-feedback-info-border',
  success: 'bg-feedback-success-surface text-feedback-success border-feedback-success-border',
  warning: 'bg-feedback-warning-surface text-feedback-warning border-feedback-warning-border',
  error: 'bg-feedback-error-surface text-feedback-error border-feedback-error-border',
}

// Visual roles only; features decide how domain states map to these variants.
export function feedbackStyles(variant: FeedbackVariant | 'neutral', className?: string) {
  return cn(variants[variant], className)
}
