import { cn } from '@/lib/utils'

export type ActionVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'
export type ActionSize = 'sm' | 'md' | 'lg'

const variants: Record<ActionVariant, string> = {
  primary: 'bg-action-primary text-on-action-primary hover:bg-action-primary-hover active:bg-action-primary-active',
  secondary: 'border border-border-strong bg-action-secondary text-on-action-secondary hover:bg-action-secondary-hover active:bg-action-secondary-active',
  ghost: 'text-text-secondary hover:bg-action-secondary-hover active:bg-action-secondary-active',
  destructive: 'bg-action-destructive text-on-action-destructive hover:bg-action-destructive-hover active:bg-action-destructive-active',
}

const sizes: Record<ActionSize, string> = {
  sm: 'text-sm px-3 py-1.5',
  md: 'text-sm px-4 py-2',
  lg: 'text-base px-6 py-3',
}

// Appearance only: anchors retain their href and native navigation semantics.
// Callers remain responsible for behaviour, including any disabled-link handling.
export function actionStyles({ variant = 'primary', size = 'md', className }: {
  variant?: ActionVariant
  size?: ActionSize
  className?: string
} = {}) {
  return cn(
    'inline-flex items-center justify-center rounded-control font-sans font-medium transition-colors cursor-pointer',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-page',
    'disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed',
    variants[variant], sizes[size], className
  )
}
