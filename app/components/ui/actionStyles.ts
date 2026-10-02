import { cn } from '@/lib/utils'

export type ActionVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'
export type ActionSize = 'sm' | 'md' | 'lg' | 'cta'

const variants: Record<ActionVariant, string> = {
  primary: 'bg-action-primary text-on-action-primary hover:bg-action-primary-hover active:bg-action-primary-active disabled:bg-action-disabled disabled:hover:bg-action-disabled',
  secondary: 'border border-border-strong bg-action-secondary text-on-action-secondary hover:bg-action-secondary-hover active:bg-action-secondary-active disabled:bg-action-disabled disabled:hover:bg-action-disabled disabled:border-border-default',
  ghost: 'text-on-action-ghost hover:bg-action-ghost-hover active:bg-action-ghost-active disabled:hover:bg-transparent',
  destructive: 'bg-action-destructive text-on-action-destructive hover:bg-action-destructive-hover active:bg-action-destructive-active disabled:bg-action-disabled disabled:hover:bg-action-disabled',
}

const sizes: Record<ActionSize, string> = {
  sm: 'min-h-8 px-3 py-1 text-sm',
  md: 'min-h-9 px-3.5 py-1.5 text-sm',
  lg: 'min-h-10 px-4 py-2 text-sm',
  cta: 'min-h-12 px-6 py-2.5 text-base',
}

// Appearance only: anchors retain their href and native navigation semantics.
// Callers remain responsible for behaviour, including any disabled-link handling.
export function actionStyles({ variant = 'primary', size = 'md', className }: {
  variant?: ActionVariant
  size?: ActionSize
  className?: string
} = {}) {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-control font-sans font-semibold transition-colors motion-reduce:transition-none cursor-pointer',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-page',
    'disabled:text-text-disabled disabled:cursor-not-allowed',
    variants[variant], sizes[size], className
  )
}
